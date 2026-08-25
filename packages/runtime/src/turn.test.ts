// The turn, end to end, on both surfaces.
//
// The point of this file is LESSONS §1: chat and proactive are the SAME
// function, and the test asserts they assemble through the same path with
// only the surface differing.  In Noura they were two functions, and the
// second one fell back to defaults nobody saw.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, type TurnInput, type TurnPorts, type TurnSink } from './turn.ts';
import { fakePorts as fakePromptPorts } from '../../prompt/src/test-fakes.ts';
import { fakePorts as fakeCapabilityPorts } from '../../capabilities/src/test-fakes.ts';
import type { Provider } from '@lian/llm';
import type { CaptureSummary } from '@lian/domain';

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

function collectingSink() {
  const chunks: string[] = [];
  const captures: CaptureSummary[] = [];
  const failures: string[] = [];
  const sink: TurnSink = {
    text: (delta) => chunks.push(delta),
    capture: (summary) => captures.push(summary),
    captureFailed: (reason) => failures.push(reason),
  };
  return { sink, chunks, captures, failures, get text() { return chunks.join(''); } };
}

function input(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    userId: 'u-1', assistantId: 'a-1', conversationId: 'c-1', surface: 'chat', plan: 'free',
    timeZone: 'Asia/Dubai', language: 'en', model: 'claude-opus-5', now: NOW,
    userMessage: 'I paid the gym 400 for the month.', clientId: null, replacingMessageId: null,
    ...overrides,
  };
}

const REPLY = 'Okay, logged AED 400 for the gym today.\n<spend>{"amount":400,"currency":"AED","category":"gym"}</spend>';

describe('the turn', () => {
  test('chat: streams clean text, captures, charges, records', async () => {
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider(REPLY), turn: fakeTurnPorts().turn };
    const collected = collectingSink();
    const store = fakeTurnPorts();
    const result = await runTurn(input(), { ...ports, turn: store.turn }, collected.sink);

    assert.equal(result.status, 'done');
    assert.ok(result.status === 'done');
    assert.equal(collected.text.trim(), 'Okay, logged AED 400 for the gym today.');
    assert.ok(!collected.text.includes('<spend'), 'a control tag must never reach the sink (LESSONS §3)');
    assert.equal(collected.captures.length, 1);
    assert.equal(collected.captures[0]!.line, 'AED 400 · gym · Today');
    // 1000 in + 100 out on Opus 5 = 5,000 + 2,500 micros
    assert.equal(result.costMicros, 7_500);
    assert.deepEqual(store.events, ['capture_created', 'message_sent']);
    assert.equal(store.answered, 1, 'a reply answers everything she was waiting on');
  });

  test('§1 chat and proactive assemble through the same path, differing only in surface', async () => {
    const chatProvider = fakeProvider('Morning.');
    const proactiveProvider = fakeProvider('You said the presentation was making you tense — thinking of you.');
    const shared = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts() };

    await runTurn(input(), { ...shared, provider: chatProvider, turn: fakeTurnPorts().turn }, collectingSink().sink);
    await runTurn(
      input({ surface: 'proactive', userMessage: null }),
      { ...shared, provider: proactiveProvider, turn: fakeTurnPorts().turn },
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
      provider: fakeProvider('hello', 7, { inputTokens: 0, outputTokens: 0 }),
    };
    for (let i = 0; i < 30; i++) await runTurn(input(), ports, collectingSink().sink);
    const result = await runTurn(input(), ports, collectingSink().sink);
    assert.equal(result.status, 'message_limit_reached');
    assert.equal(store.messages.filter((m) => m.role === 'user').length, 30, 'the refused message was never stored');
  });

  test('her daily reach-out has its own budget — PRD §11: she is not gone', async () => {
    const store = fakeTurnPorts();
    const ports: TurnPorts = {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), turn: store.turn,
      provider: fakeProvider('thinking of you', 7, { inputTokens: 0, outputTokens: 0 }),
    };
    // Spend the whole message allowance…
    for (let i = 0; i < 30; i++) await runTurn(input(), ports, collectingSink().sink);
    // …and she can still reach out once, because the budgets are separate.
    const reach = await runTurn(input({ surface: 'proactive', userMessage: null }), ports, collectingSink().sink);
    assert.equal(reach.status, 'done');
    const second = await runTurn(input({ surface: 'proactive', userMessage: null }), ports, collectingSink().sink);
    assert.equal(second.status, 'quiet', 'once a day on free');
  });

  test('§12 the per-user model cost ceiling stops the turn', async () => {
    const store = fakeTurnPorts();
    store.counters.set('model_cost_micros:2026-05', 150_000); // the free ceiling
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider('hello'), turn: store.turn };
    const result = await runTurn(input(), ports, collectingSink().sink);
    assert.equal(result.status, 'cost_ceiling_reached');
  });

  test('at list price the COST ceiling binds long before the message limit', async () => {
    // Not a bug in the code — a fact about the numbers, asserted so it cannot
    // be discovered from an invoice.  Free allows 30 messages/day and $0.15 of
    // model spend a month; one turn at the catalogue price is 7,500 micros, so
    // the money runs out after 20 messages — on the first day.
    const store = fakeTurnPorts();
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider('hello'), turn: store.turn };
    let turns = 0;
    for (let i = 0; i < 30; i++) {
      const result = await runTurn(input(), ports, collectingSink().sink);
      if (result.status !== 'done') break;
      turns++;
    }
    assert.equal(turns, 20, 'if this number changes, the plan economics changed with it');
    assert.equal((await runTurn(input(), ports, collectingSink().sink)).status, 'cost_ceiling_reached');
  });

  test('Q7 a regeneration voids the previous captures before writing new ones', async () => {
    const store = fakeTurnPorts();
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider(REPLY), turn: store.turn };
    await runTurn(input({ surface: 'regenerate', replacingMessageId: 'm-old' }), ports, collectingSink().sink);
    assert.equal(store.voided, 1, 'regenerating "logged AED 400" must not log AED 400 twice');
  });

  test('Q7 a malformed payload is refused and spoken about, not silently dropped', async () => {
    const store = fakeTurnPorts();
    const ports: TurnPorts = {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), turn: store.turn,
      provider: fakeProvider('Noted.<spend>{"amount":"a lot"}</spend>'),
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
    };
    await runTurn(input({ surface: 'incognito', conversationId: 'c-2' }), ports, collectingSink().sink);
    assert.deepEqual(store.credited, [], 'incognito writes nothing, so it earns nothing');

    const normal = fakeTurnPorts();
    await runTurn(input(), { ...ports, turn: normal.turn }, collectingSink().sink);
    assert.deepEqual(normal.credited, ['2026-05-18'], 'a real day counts once');
  });

  test('the assistant message stores clean text and the tags separately', async () => {
    const store = fakeTurnPorts();
    const ports: TurnPorts = { prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), provider: fakeProvider(REPLY), turn: store.turn };
    await runTurn(input(), ports, collectingSink().sink);
    const reply = store.messages.find((m) => m.role === 'assistant')!;
    assert.equal(reply.body, 'Okay, logged AED 400 for the gym today.');
    assert.equal(reply.tags.length, 1, 'tags are kept so a regenerate can void what they captured');
    assert.equal(reply.surface, 'chat');
  });
});
