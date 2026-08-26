// The turn, end to end, on both surfaces.
//
// The point of this file is LESSONS §1: chat and proactive are the SAME
// function, and the test asserts they assemble through the same path with
// only the surface differing.  In Noura they were two functions, and the
// second one fell back to defaults nobody saw.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, type TurnInput, type TurnPorts, type TurnSink } from './turn.ts';
import { fakePorts as fakePromptPorts } from '@lian/prompt/test-fakes';
import { fakePorts as fakeCapabilityPorts } from '@lian/capabilities/test-fakes';
import { costMicros, typicalTurnMicros, DEFAULT_MODEL, type Provider } from '@lian/llm';
import { limitsFor, monthlyMessageAllowance, type CaptureSummary } from '@lian/domain';

const NOW = new Date('2026-05-18T06:30:00.000Z');

/** A provider that replays a scripted response in awkward chunks. */
function fakeProvider(response: string, chunkSize = 7, usage = { inputTokens: 1_000, outputTokens: 100 }): Provider & { systems: string[] } {
  const systems: string[] = [];
  return {
    systems,
    id: 'fake',
    capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
    async stream(request, onDelta) {
      systems.push(request.system);
      for (let i = 0; i < response.length; i += chunkSize) onDelta(response.slice(i, i + chunkSize));
      return { usage, stopReason: 'end_turn' };
    },
  };
}

function fakeTurnPorts() {
  const messages: { id: string; role: string; body: string; surface: string | null; tags: unknown[] }[] = [];
  const counters = new Map<string, number>();
  const claimed = new Set<string>();
  const events: string[] = [];
  const credited: string[] = [];
  let answered = 0;
  let voided = 0;
  let n = 0;

  const turn: TurnPorts['turn'] = {
    async appendMessage(input) {
      const message = { id: `m${++n}`, role: input.role, body: input.body, surface: input.surface, tags: input.tags };
      messages.push(message);
      return { id: message.id };
    },
    async history() { return messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.body })); },
    async claimCapture(input) {
      const key = `${input.messageId}:${input.tagIndex}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    async voidCaptures() { voided++; return []; },
    async reserve(_userId, kind, periodKey, ceiling, by) {
      const key = `${kind}:${periodKey}`;
      const value = counters.get(key) ?? 0;
      if (value + by > ceiling) return false;
      counters.set(key, value + by);
      return true;
    },
    async hasHeadroom(_userId, kind, periodKey, ceiling) {
      return (counters.get(`${kind}:${periodKey}`) ?? 0) < ceiling;
    },
    async charge(_userId, kind, periodKey, micros) { counters.set(`${kind}:${periodKey}`, (counters.get(`${kind}:${periodKey}`) ?? 0) + micros); },
    async markOutreachAnswered() { answered++; },
    async creditQualifyingDay(_assistantId, localDay) { credited.push(localDay); },
    async userMessagesOnDay() { return 3; },
    async recordEvent(input) { events.push(input.name); },
  };
  return { turn, messages, counters, events, credited, claimedKeys: claimed, get answered() { return answered; }, get voided() { return voided; } };
}

function fakeAbsorb(result = { kept: 1, queued: 0, refused: 0 }) {
  const calls: { assistantMessage: string; userMessageId: string | null }[] = [];
  const fn = async (input: Parameters<TurnPorts['absorb']>[0]) => {
    calls.push({ assistantMessage: input.exchange.assistantMessage, userMessageId: input.exchange.userMessageId });
    return result;
  };
  return { fn, calls };
}

function collectingSink() {
  const chunks: string[] = [];
  const captures: CaptureSummary[] = [];
  const failures: string[] = [];
  const queueFull: string[] = [];
  const sink: TurnSink = {
    text: (delta) => chunks.push(delta),
    capture: (summary) => captures.push(summary),
    captureFailed: (reason) => failures.push(reason),
    memoryQueueFull: (language) => queueFull.push(language),
  };
  return { sink, chunks, captures, failures, queueFull, get text() { return chunks.join(''); } };
}

function input(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    userId: 'u-1', assistantId: 'a-1', conversationId: 'c-1', surface: 'chat', plan: 'free',
    timeZone: 'Asia/Dubai', language: 'en', model: DEFAULT_MODEL, now: NOW,
    userMessage: 'I paid the gym 400 for the month.', clientId: null, replacingMessageId: null,
    ...overrides,
  };
}

const REPLY = 'Okay, logged AED 400 for the gym today.\n<spend>{"amount":400,"currency":"AED","category":"gym"}</spend>';

describe('the turn', () => {
  test('chat: streams clean text, captures, charges, records', async () => {
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider(REPLY), turn: fakeTurnPorts().turn, absorb: fakeAbsorb().fn };
    const collected = collectingSink();
    const store = fakeTurnPorts();
    const result = await runTurn(input(), { ...ports, turn: store.turn, absorb: fakeAbsorb().fn }, collected.sink);

    assert.equal(result.status, 'done');
    assert.ok(result.status === 'done');
    assert.equal(collected.text.trim(), 'Okay, logged AED 400 for the gym today.');
    assert.ok(!collected.text.includes('<spend'), 'a control tag must never reach the sink (LESSONS §3)');
    assert.equal(collected.captures.length, 1);
    assert.equal(collected.captures[0]!.line, 'AED 400 · gym · Today');
    assert.equal(result.costMicros, costMicros(DEFAULT_MODEL, { inputTokens: 1_000, outputTokens: 100 }));
    assert.deepEqual(store.events, ['capture_created', 'message_sent']);
    assert.equal(store.answered, 1, 'a reply answers everything she was waiting on');
  });

  test('§1 chat and proactive assemble through the same path, differing only in surface', async () => {
    const chatProvider = fakeProvider('Morning.');
    const proactiveProvider = fakeProvider('You said the presentation was making you tense — thinking of you.');
    const shared = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts() };

    await runTurn(input(), { ...shared, provider: chatProvider, turn: fakeTurnPorts().turn, absorb: fakeAbsorb().fn }, collectingSink().sink);
    await runTurn(
      input({ surface: 'proactive', userMessage: null }),
      { ...shared, provider: proactiveProvider, turn: fakeTurnPorts().turn, absorb: fakeAbsorb().fn },
      collectingSink().sink,
    );

    const chatSystem = chatProvider.systems[0]!;
    const proactiveSystem = proactiveProvider.systems[0]!;
    // The persona, canon and memory blocks are identical — this is exactly
    // what Noura got wrong, and it is why the bug was invisible in chat.
    for (const marker of ['You are Lian', 'WHAT YOU HAVE SAID ABOUT YOURSELF', 'WHAT YOU REMEMBER ABOUT THEM']) {
      assert.ok(chatSystem.includes(marker), `chat lost ${marker}`);
      assert.ok(proactiveSystem.includes(marker), `proactive lost ${marker} — this is the Noura bug`);
    }
    assert.equal(
      chatSystem.slice(0, chatSystem.indexOf('WHAT TO DO NOW')),
      proactiveSystem.slice(0, proactiveSystem.indexOf('WHAT TO DO NOW')),
      'everything before the trailing directive must be byte-identical',
    );
    assert.match(proactiveSystem, /arrives on a lock screen/);
  });

  test('the free message limit stops the turn, and a refusal costs nothing', async () => {
    const store = fakeTurnPorts();
    // A free provider, so the cost ceiling is not the binding constraint —
    // see the test below, which is about exactly that collision.
    const ports: TurnPorts = {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), turn: store.turn,
      provider: fakeProvider('hello', 7, { inputTokens: 0, outputTokens: 0 }), absorb: fakeAbsorb().fn,
    };
    const limit = limitsFor('free').messagesPerDay;
    for (let i = 0; i < limit; i++) await runTurn(input(), ports, collectingSink().sink);
    const result = await runTurn(input(), ports, collectingSink().sink);
    assert.equal(result.status, 'message_limit_reached');
    assert.equal(store.messages.filter((m) => m.role === 'user').length, limit, 'the refused message was never stored');
  });

  test('her daily reach-out has its own budget — PRD §11: she is not gone', async () => {
    const store = fakeTurnPorts();
    const ports: TurnPorts = {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), turn: store.turn,
      provider: fakeProvider('thinking of you', 7, { inputTokens: 0, outputTokens: 0 }),
      absorb: fakeAbsorb().fn,
    };
    // Spend the whole message allowance…
    for (let i = 0; i < limitsFor('free').messagesPerDay; i++) await runTurn(input(), ports, collectingSink().sink);
    // …and she can still reach out once, because the budgets are separate.
    const reach = await runTurn(input({ surface: 'proactive', userMessage: null }), ports, collectingSink().sink);
    assert.equal(reach.status, 'done');
    const second = await runTurn(input({ surface: 'proactive', userMessage: null }), ports, collectingSink().sink);
    assert.equal(second.status, 'quiet', 'once a day on free');
  });

  test('§12 the per-user model cost ceiling stops the turn', async () => {
    const store = fakeTurnPorts();
    store.counters.set('model_cost_micros:2026-05', limitsFor('free').modelCostPerMonth);
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider('hello'), turn: store.turn, absorb: fakeAbsorb().fn };
    const result = await runTurn(input(), ports, collectingSink().sink);
    assert.equal(result.status, 'cost_ceiling_reached');
  });

  test('the message limit and the cost ceiling agree — a free user meets only the named one', async () => {
    // Last night this test recorded a collision: the money ran out after 20
    // messages while the copy promised 30, so the user would have met a limit
    // the product never named.  The ruling was to move the message limit to
    // 20 rather than downgrade the first session's model.
    //
    // This asserts they still agree.  If either number moves — a model swap,
    // a price change, a new limit — this fails, and the fix is to move the
    // other one, never to delete the test.
    const limits = limitsFor('free');
    const store = fakeTurnPorts();
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider('hello'), turn: store.turn, absorb: fakeAbsorb().fn };

    let delivered = 0;
    let lastStatus = '';
    for (let i = 0; i < limits.messagesPerDay + 5; i++) {
      const result = await runTurn(input(), ports, collectingSink().sink);
      lastStatus = result.status;
      if (result.status !== 'done') break;
      delivered++;
    }

    assert.equal(delivered, limits.messagesPerDay, 'the money must last as long as the messages do');
    assert.equal(lastStatus, 'message_limit_reached', 'the limit a free user meets is the one the copy names');

    // The same fact as arithmetic, over a MONTH — which is the period the
    // ceiling is denominated in.  Getting that wrong is how the collision
    // was mis-stated the first time.
    const perTurn = typicalTurnMicros(DEFAULT_MODEL, true);
    const monthly = perTurn * monthlyMessageAllowance('free');
    assert.ok(
      monthly <= limits.modelCostPerMonth,
      `a month of free messages (${monthly} micros) must fit the ceiling (${limits.modelCostPerMonth})`,
    );
  });

  test('Q7 a regeneration voids the previous captures before writing new ones', async () => {
    const store = fakeTurnPorts();
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider(REPLY), turn: store.turn, absorb: fakeAbsorb().fn };
    await runTurn(input({ surface: 'regenerate', replacingMessageId: 'm-old' }), ports, collectingSink().sink);
    assert.equal(store.voided, 1, 'regenerating "logged AED 400" must not log AED 400 twice');
  });

  test('Q7 a malformed payload is refused and spoken about, not silently dropped', async () => {
    const store = fakeTurnPorts();
    const ports: TurnPorts = {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), turn: store.turn,
      provider: fakeProvider('Noted.<spend>{"amount":"a lot"}</spend>'), absorb: fakeAbsorb().fn,
    };
    const collected = collectingSink();
    const result = await runTurn(input(), ports, collected.sink);
    assert.equal(result.status, 'done');
    assert.equal(collected.captures.length, 0);
    assert.deepEqual(collected.failures, ['no usable amount'], 'she has already said "noted" — the turn owes an answer');
  });

  test('Q12 an incognito turn earns no qualifying day', async () => {
    const store = fakeTurnPorts();
    const ports: TurnPorts = {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider('Understood.'), turn: store.turn,
      absorb: fakeAbsorb().fn,
    };
    await runTurn(input({ surface: 'incognito', conversationId: 'c-2' }), ports, collectingSink().sink);
    assert.deepEqual(store.credited, [], 'incognito writes nothing, so it earns nothing');

    const normal = fakeTurnPorts();
    await runTurn(input(), { ...ports, turn: normal.turn, absorb: fakeAbsorb().fn }, collectingSink().sink);
    assert.deepEqual(normal.credited, ['2026-05-18'], 'a real day counts once');
  });

  test('the assistant message stores clean text and the tags separately', async () => {
    const store = fakeTurnPorts();
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider(REPLY), turn: store.turn, absorb: fakeAbsorb().fn };
    await runTurn(input(), ports, collectingSink().sink);
    const reply = store.messages.find((m) => m.role === 'assistant')!;
    assert.equal(reply.body, 'Okay, logged AED 400 for the gym today.');
    assert.equal(reply.tags.length, 1, 'tags are kept so a regenerate can void what they captured');
    assert.equal(reply.surface, 'chat');
  });
});
