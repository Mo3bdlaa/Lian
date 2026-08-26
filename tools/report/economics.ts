// The economics report.
//
//   node tools/report/economics.ts
//
// Prints the free tier's cost arithmetic with every assumption named beside
// the number that depends on it, and — where there is data — the measured
// value next to the assumed one.
//
// This exists because the free-tier number has been wrong twice, both times
// by an assumption that read like a measurement.
import {
  DEFAULT_MODEL, TYPICAL_TURN, CACHE_WRITE_TURN_SHARE, CACHE_WRITE_MULTIPLIER,
  CACHE_READ_MULTIPLIER, TYPICAL_CACHED_SHARE, MIN_CACHEABLE_TOKENS,
  blendedTurnMicros, typicalTurnMicros, modelEntry,
} from '@lian/llm';
import { limitsFor, monthlyMessageAllowance } from '@lian/domain';
import { economics, closeDb, databaseUrl } from '@lian/db';

const money = (micros: number): string => `$${(micros / 1_000_000).toFixed(4)}`;

const { pricing } = modelEntry(DEFAULT_MODEL);
const uncached = typicalTurnMicros(DEFAULT_MODEL, 'uncached');
const write = typicalTurnMicros(DEFAULT_MODEL, 'cache-write');
const read = typicalTurnMicros(DEFAULT_MODEL, 'cache-read');

console.log(`\nLIAN — the free tier, and what it rests on\n`);
console.log(`model            ${DEFAULT_MODEL}`);
console.log(`prices           $${pricing.inputPerMillionMicros / 1_000_000}/M in, $${pricing.outputPerMillionMicros / 1_000_000}/M out   [read ${pricing.pricedOn}]`);
console.log(`typical turn     ${TYPICAL_TURN.inputTokens} in / ${TYPICAL_TURN.outputTokens} out          [ASSUMED — no traffic measured]`);
console.log(`cacheable share  ${(TYPICAL_CACHED_SHARE * 100).toFixed(0)}% of input                 [measured off the golden prompt; ~4 chars/token]`);
console.log(`cache multipliers write ${CACHE_WRITE_MULTIPLIER}× · read ${CACHE_READ_MULTIPLIER}×   [ASSUMED — provider docs, ${pricing.pricedOn}]`);
console.log(`cache minimum    ${MIN_CACHEABLE_TOKENS} tokens             [ASSUMED — provider docs; below it a breakpoint does nothing]`);
console.log('');
console.log(`per turn         uncached ${money(uncached)} · first turn ${money(write)} · cached ${money(read)}`);

async function main(): Promise<void> {
  let measured: Awaited<ReturnType<typeof economics.turnsPerSession>> | null = null;
  try {
    // Throws when DATABASE_URL is unset, which is the honest answer to
    // "what did you measure": nothing.
    databaseUrl();
    measured = await economics.turnsPerSession();
  } catch (error) {
    console.log(`\n(no measurement: ${(error as Error).message})`);
  }

  const assumedShare = CACHE_WRITE_TURN_SHARE;
  console.log('');
  console.log(`cache-write share`);
  console.log(`  ASSUMED        ${(assumedShare * 100).toFixed(0)}% of turns — i.e. sessions of about ${Math.round(1 / assumedShare)} turns`);
  if (measured === null || measured.sessions === 0) {
    console.log(`  MEASURED       nothing yet. No sessions recorded, so the line above is a`);
    console.log(`                 guess and the cost below inherits it.`);
  } else {
    console.log(`  MEASURED       ${(measured.cacheWriteShare * 100).toFixed(1)}% — ${measured.sessions} sessions, ${measured.turns} turns,`);
    console.log(`                 mean ${measured.mean.toFixed(1)} · median ${measured.median} · p90 ${measured.p90} turns per session`);
    console.log(`                 [session = a gap of more than ${measured.gapMinutes} minutes; longer than the`);
    console.log(`                  provider's cache TTL, so this UNDER-states the write share]`);
    const drift = measured.cacheWriteShare / assumedShare;
    if (drift > 1.25 || drift < 0.8) {
      console.log(`  ⚠ the assumption is off by ${drift > 1 ? '+' : ''}${((drift - 1) * 100).toFixed(0)}% — update CACHE_WRITE_TURN_SHARE in packages/llm/src/catalogue.ts`);
    }
  }

  const perTurn = blendedTurnMicros(DEFAULT_MODEL);
  const turns = monthlyMessageAllowance('free');
  const monthly = perTurn * turns;
  const ceiling = limitsFor('free').modelCostPerMonth;
  console.log('');
  console.log(`free tier`);
  console.log(`  ${turns} turns/month × ${money(perTurn)} blended = ${money(monthly)}`);
  console.log(`  ceiling ${money(ceiling)} — ${((monthly / ceiling) * 100).toFixed(0)}% used`);
  console.log(`  subscription $9/month funds ${(9_000_000 / monthly).toFixed(1)} free users`);
  console.log(`  [the last line assumes every free user spends their whole allowance;`);
  console.log(`   nobody does, so it is a floor — and it is a floor on an ASSUMPTION]`);
  console.log('');

  await closeDb();
}

await main();
