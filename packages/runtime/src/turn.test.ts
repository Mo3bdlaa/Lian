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
import {
  turnCostMicros, typicalTurnMicros, blendedTurnMicros, modelEntry, DEFAULT_MODEL,
  CACHE_WRITE_TURN_SHARE, CACHE_WRITE_MULTIPLIER, CACHE_READ_MULTIPLIER, TYPICAL_CACHED_SHARE, TYPICAL_TURN,
  type Provider, type CompletionRequest,
} from '@lian/llm';
import { limitsFor, monthlyMessageAllowance, type CaptureSummary } from '@lian/domain';

const NOW = new Date('2026-05-18T06:30:00.000Z');

/** A provider that replays a scripted response in awkward chunks. */
function fakeProvider(
  response: string,
  chunkSize = 7,
  usage: { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number } = { inputTokens: 1_000, outputTokens: 100 },
): Provider & { systems: string[]; requests: CompletionRequest[] } {
  const systems: string[] = [];
  const requests: CompletionRequest[] = [];
  return {
    systems,
    requests,
    id: 'fake',
    capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
    async stream(request, onDelta) {
      requests.push(request);
      systems.push(request.system.map((segment) => segment.text).join('\n\n'));
      for (let i = 0; i < response.length; i += chunkSize) onDelta(response.slice(i, i + chunkSize));
      return {
        usage: { cacheWriteTokens: 0, cacheReadTokens: 0, ...usage },
        stopReason: 'end_turn',
      };
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
    timeZone: 'Asia/Dubai', language: 'en', assistantGender: 'female', model: DEFAULT_MODEL, now: NOW,
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
    assert.equal(result.costMicros, turnCostMicros(DEFAULT_MODEL, { inputTokens: 1_000, outputTokens: 100 }));
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
    // The persona and canon are identical — this is exactly what Noura got
    // wrong, and it is why the bug was invisible in chat.
    for (const marker of ['You are Lian', 'WHAT YOU HAVE SAID ABOUT YOURSELF']) {
      assert.ok(chatSystem.includes(marker), `chat lost ${marker}`);
      assert.ok(proactiveSystem.includes(marker), `proactive lost ${marker} — this is the Noura bug`);
    }
    assert.equal(
      chatSystem.slice(0, chatSystem.indexOf('WHAT TO DO NOW')),
      proactiveSystem.slice(0, proactiveSystem.indexOf('WHAT TO DO NOW')),
      'everything before the trailing directive must be byte-identical',
    );
    assert.match(proactiveSystem, /arrives on a lock screen/);

    // And what she remembers still reaches her — it moved into the turn, not
    // out of the prompt.  The split is about caching, not about content.
    const chatTurn = chatProvider.requests[0]!.messages.at(-1)!.content;
    const proactiveTurn = proactiveProvider.requests[0]!.messages.at(-1)!.content;
    for (const turn of [chatTurn, proactiveTurn]) {
      assert.match(turn, /WHAT YOU REMEMBER ABOUT THEM/);
      assert.match(turn, /<<context>>/);
    }
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
    // BLENDED, not the best case: a month contains first turns, which pay a
    // cache write and cost more than an uncached turn.  Sizing the ceiling
    // against the cache-read figure alone would be optimistic in exactly the
    // way the last mistake was.
    const perTurn = blendedTurnMicros(DEFAULT_MODEL);
    const monthly = perTurn * monthlyMessageAllowance('free');
    assert.ok(
      monthly <= limits.modelCostPerMonth,
      `a month of free messages (${monthly} micros) must fit the ceiling (${limits.modelCostPerMonth})`,
    );
    // Printed with the assumption attached, because this number has been
    // read as measured twice and it is not: the blend depends on how many
    // turns a session has, and nothing has measured that yet.
    // `node tools/report/economics.ts` prints the same arithmetic against
    // whatever real sessions exist.
    console.log(`      free tier: ${monthlyMessageAllowance('free')} turns × ${perTurn} micros = ${monthly} of ${limits.modelCostPerMonth} ceiling`);
    console.log(`      ASSUMED, not measured: ${(CACHE_WRITE_TURN_SHARE * 100).toFixed(0)}% of turns pay a cache write (≈${Math.round(1 / CACHE_WRITE_TURN_SHARE)}-turn sessions),`);
    console.log(`      a ${TYPICAL_TURN.inputTokens}/${TYPICAL_TURN.outputTokens}-token turn, and prices read on ${modelEntry(DEFAULT_MODEL).pricing.pricedOn}.`);
  });

  test('prompt caching: the saving is a measured number, not a claim', async () => {
    // ASSUMPTIONS, all three from catalogue.ts and stated there with their
    // source and date: cache writes cost 1.25x fresh input, reads 0.1x, and
    // ~60% of a typical turn's input is the stable prefix.  If any of them
    // moves, this test is where it shows up.
    const uncached = typicalTurnMicros(DEFAULT_MODEL, 'uncached');
    const firstTurn = typicalTurnMicros(DEFAULT_MODEL, 'cache-write');
    const everyTurnAfter = typicalTurnMicros(DEFAULT_MODEL, 'cache-read');

    // The first turn of a conversation costs MORE — writing the cache is
    // billed above fresh input.  A caching change that does not admit this
    // is being reported optimistically.
    assert.ok(firstTurn > uncached, `first turn ${firstTurn} should exceed uncached ${uncached}`);
    assert.ok(everyTurnAfter < uncached, 'every turn after it costs less');

    // The number that matters for the plan: how much of a turn caching
    // removes, once a conversation is going.
    const saving = 1 - everyTurnAfter / uncached;
    assert.ok(saving > 0.4 && saving < 0.7, `caching should remove 40-70% of a turn; measured ${(saving * 100).toFixed(1)}%`);

    // And it pays for the write within a couple of turns.
    const breakEven = Math.ceil((firstTurn - uncached) / (uncached - everyTurnAfter));
    assert.ok(breakEven <= 2, `the cache write should pay for itself within 2 turns; needs ${breakEven}`);

    // Both figures, printed, because a number in a test is worth more when
    // someone can read it without running a calculator.
    console.log(`      uncached ${uncached} micros/turn · cached ${everyTurnAfter} · first turn ${firstTurn} · saving ${(saving * 100).toFixed(1)}%`);
    console.log(`      ASSUMED: write ${CACHE_WRITE_MULTIPLIER}× input, read ${CACHE_READ_MULTIPLIER}×, ${(TYPICAL_CACHED_SHARE * 100).toFixed(0)}% of input cacheable — none of it observed in production.`);
  });

  test('the cache breakpoint is sent, and only at the end of the stable prefix', async () => {
    const provider = fakeProvider('Okay.');
    const store = fakeTurnPorts();
    await runTurn(input(), {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), turn: store.turn,
      provider, absorb: fakeAbsorb().fn,
    }, collectingSink().sink);

    const request = provider.requests[0]!;
    // The whole system block is cacheable, because nothing per-turn is left
    // in it.  That is what also makes the history after it cacheable.
    assert.equal(request.system.length, 1);
    assert.equal(request.system[0]!.cache, true);
    assert.ok(request.system[0]!.text.includes('You are Lian'), 'the persona is inside it');
    assert.ok(!request.system[0]!.text.includes('RIGHT NOW'), 'and per-turn context is not');
    assert.ok(!request.system[0]!.text.includes('WHAT YOU REMEMBER'), 'nor retrieved memory');

    // LESSONS §1: the directive ends the system block AND is repeated at the
    // very end of the turn, which is now genuinely the last thing read.
    assert.ok(request.system[0]!.text.trimEnd().endsWith('about the specific thing they said.'));
    const finalTurn = request.messages.at(-1)!.content;
    assert.ok(finalTurn.trimEnd().endsWith('about the specific thing they said.'), 'repeated last');
    assert.ok(finalTurn.indexOf('<<context>>') < finalTurn.indexOf('WHAT TO DO NOW'), 'context first, instruction last');
  });

  test('what the cache actually did is reported, never assumed', async () => {
    // A breakpoint under the provider's minimum prefix silently does not
    // cache.  A zero here is how that becomes visible.
    const store = fakeTurnPorts();
    const result = await runTurn(input(), {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), turn: store.turn,
      provider: fakeProvider('Okay.', 7, { inputTokens: 400, outputTokens: 100, cacheReadTokens: 1_600 }),
      absorb: fakeAbsorb().fn,
    }, collectingSink().sink);

    assert.ok(result.status === 'done');
    assert.deepEqual(result.cache, { written: 0, read: 1_600 });
    // And the charge reflects it: 1,600 cached tokens are billed at 0.1x.
    assert.equal(result.costMicros, turnCostMicros(DEFAULT_MODEL, { inputTokens: 400, outputTokens: 100, cacheReadTokens: 1_600 }));
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

// ── the free limit, end to end ──────────────────────────────────────────────
import { t } from '@lian/i18n';
import { messageBudget, APPROACHING_THRESHOLD } from '@lian/domain';

describe('the free limit is hers to explain, in both languages', () => {
  function spend(language: 'en' | 'ar', gender: 'female' | 'male' = 'female') {
    const store = fakeTurnPorts();
    const ports: TurnPorts = {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), turn: store.turn,
      provider: fakeProvider('Okay.', 7, { inputTokens: 0, outputTokens: 0 }), absorb: fakeAbsorb().fn,
    };
    return { store, ports, input: () => input({ language, assistantGender: gender }) };
  }

  test('at the limit she says it herself — no modal, no countdown, no upsell', async () => {
    const run = spend('en');
    for (let i = 0; i < limitsFor('free').messagesPerDay; i++) await runTurn(run.input(), run.ports, collectingSink().sink);
    const result = await runTurn(run.input(), run.ports, collectingSink().sink);

    assert.equal(result.status, 'message_limit_reached');
    assert.ok(result.status === 'message_limit_reached');
    assert.equal(result.line, t('limit.reached', 'en'));
    assert.match(result.line, /I'll still be here tomorrow/, 'PRD §11: she is not gone');
    assert.ok(!/upgrade|subscribe|plan/i.test(result.line), 'the upgrade action is secondary and lives elsewhere');
  });

  test('the same limit in Arabic, in her authored voice', async () => {
    const run = spend('ar');
    for (let i = 0; i < limitsFor('free').messagesPerDay; i++) await runTurn(run.input(), run.ports, collectingSink().sink);
    const result = await runTurn(run.input(), run.ports, collectingSink().sink);
    assert.ok(result.status === 'message_limit_reached');
    assert.equal(result.line, t('limit.reached', 'ar'));
    assert.ok(/[؀-ۿ]/.test(result.line), 'authored Arabic, not a translated English string');
  });

  test('the cost ceiling wears the same face to the user, and a different one in the log', async () => {
    // "Our costs ran over" is true and none of their business.  The statuses
    // differ so we can tell them apart; the line does not.
    const store = fakeTurnPorts();
    store.counters.set('model_cost_micros:2026-05', limitsFor('free').modelCostPerMonth);
    const result = await runTurn(input(), {
      prompt: fakePromptPorts(), capabilities: fakeCapabilityPorts(), turn: store.turn,
      provider: fakeProvider('hello'), absorb: fakeAbsorb().fn,
    }, collectingSink().sink);
    assert.equal(result.status, 'cost_ceiling_reached');
    assert.ok(result.status === 'cost_ceiling_reached');
    assert.equal(result.line, t('limit.reached', 'en'));
  });

  test('the approaching state is quiet, and late', async () => {
    // PRD §11 bans a countdown, so this is a state the prompt mentions once
    // rather than a number on screen.
    const budget = messageBudget('free', limitsFor('free').messagesPerDay - APPROACHING_THRESHOLD);
    assert.equal(budget.state, 'approaching');
    assert.equal(messageBudget('free', 0).state, 'ok');
    assert.match(t('limit.approaching', 'en'), /only got a few messages left/);
    assert.ok(!/\d/.test(t('limit.approaching', 'en')), 'no number — a count is a countdown');
    assert.ok(!/\d|[٠-٩]/.test(t('limit.approaching', 'ar')));
  });

  test('her reach-out survives the message limit, on its own budget', async () => {
    const run = spend('en');
    for (let i = 0; i < limitsFor('free').messagesPerDay; i++) await runTurn(run.input(), run.ports, collectingSink().sink);
    assert.equal((await runTurn(run.input(), run.ports, collectingSink().sink)).status, 'message_limit_reached');

    const reach = await runTurn(
      { ...run.input(), surface: 'proactive', userMessage: null },
      run.ports,
      collectingSink().sink,
    );
    assert.equal(reach.status, 'done', 'PRD §11 says she is not gone — a shared budget would make that false');
  });
});
