// THE WEEKLY REPORT.
//
//   node tools/report/weekly.ts            # everything
//   node tools/report/weekly.ts retention  # just the cohorts
//   node tools/report/weekly.ts cost       # just the meters
//
// One place to look, once a week. It exists because two things this product
// says it cares about were being measured by nobody: retention, which is the
// stated success metric (PRD §18) and had queries nothing called, and cost,
// which is the thing most likely to kill it and was legible only in test
// output.
//
// WHY THIS IS A COMMAND AND NOT A SCREEN.
//
// A dashboard inside the app that reads across accounts is an admin data
// path, and this product does not have one — that instruction is standing.
// So the report is run from the repository against the database, by somebody
// who already has both, and it prints AGGREGATES ONLY: counts, totals and
// quantiles. No user id, no email, no message, no memory. `reporting.test.ts`
// asserts the queries it uses return nothing that identifies anyone, so this
// stays a measurement rather than becoming a back door by accretion.
//
// Every number is printed with the thing it depends on: a cohort with its
// definition, an assumption with the word ASSUMED, and a ceiling beside the
// meter it bounds.
import { events, economics, closeDb, databaseUrl } from '@lian/db';
import { limitsFor, DEFAULT_CURRENCY } from '@lian/domain';

const argument = process.argv[2] ?? 'all';
const WANT = { retention: argument === 'all' || argument === 'retention', cost: argument === 'all' || argument === 'cost' };

const money = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;
const bytes = (value: number): string =>
  value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB`
  : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB`
  : `${Math.round(value / 1024)} KB`;
const pad = (text: string, width: number): string => text.padEnd(width);

/** A rate, with its denominator, or a refusal when the denominator is too
 *  small to divide by honestly. */
function rate(part: number, whole: number): string {
  if (whole === 0) return '—';
  if (whole < events.MEANINGFUL_COHORT) return `${part}/${whole} (too few to rate)`;
  return `${part}/${whole}  ${((part / whole) * 100).toFixed(0)}%`;
}

/** The local day N days before today, UTC. Cohort days are user-local, so
 *  this is a window boundary rather than a cohort key. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const HISTORY_DAYS = 90;

async function retention(): Promise<void> {
  console.log('\n══ RETENTION ══════════════════════════════════════════════\n');
  console.log('  PRD §18 names D1/D7/D30 as the success metric. What those');
  console.log('  words mean here, exactly, because they mean four different');
  console.log('  things depending on who is saying them:\n');
  console.log('    cohort    accounts whose FIRST recorded event day is that day');
  console.log('    day       the USER\'s local day, never UTC\'s — someone in');
  console.log('              Dubai opening the app at 1am counts on their Tuesday');
  console.log('    returned  any event on EXACTLY day N after, not "within N days".');
  console.log('              The strict reading. The cumulative one flatters');
  console.log('              everything and mostly measures the window length.');
  console.log(`    shown     cohorts of ${events.MEANINGFUL_COHORT}+ from the last ${HISTORY_DAYS} days. A rate over`);
  console.log('              four people is a rounding error with a percent sign.\n');

  const found = await events.cohorts({ since: daysAgo(HISTORY_DAYS) });
  if (found.length === 0) {
    // The honest empty state: not "0%", which reads as a measurement.
    const anyone = await events.cohorts({ since: daysAgo(HISTORY_DAYS), minimumSize: 1 });
    console.log(anyone.length === 0
      ? '  No cohorts yet. Nothing has been measured, which is not the same as zero.'
      : `  ${anyone.length} cohort(s) in the window, none with ${events.MEANINGFUL_COHORT}+ accounts.`
        + `\n  Smallest denominator that would be reported: ${events.MEANINGFUL_COHORT}.`);
    if (anyone.length > 0) {
      console.log(`  Sizes so far: ${anyone.slice(0, 10).map((c) => `${c.cohortDay}=${c.size}`).join(', ')}`);
    }
    return;
  }

  console.log(`  ${pad('cohort', 12)}${pad('size', 7)}${pad('D1', 18)}${pad('D7', 18)}D30`);
  for (const cohort of found) {
    const curve = await events.retentionCurve(cohort.cohortDay);
    console.log(
      `  ${pad(curve.cohortDay, 12)}${pad(String(curve.cohort), 7)}`
      + `${pad(rate(curve.d1, curve.cohort), 18)}${pad(rate(curve.d7, curve.cohort), 18)}${rate(curve.d30, curve.cohort)}`,
    );
  }

  // A cohort younger than N days has not HAD its day N yet. Reporting 0 for
  // it would be a false negative that looks like a collapse.
  const today = new Date().toISOString().slice(0, 10);
  const immature = found.filter((cohort) => cohort.cohortDay > daysAgo(30));
  if (immature.length > 0) {
    console.log(`\n  ${immature.length} cohort(s) above are younger than 30 days: their D30 is not`);
    console.log('  low, it has not happened yet. Same for D7 within the last week.');
    console.log(`  (today is ${today})`);
  }

  const newest = found[0]!;
  const funnel = await events.onboardingFunnel(newest.cohortDay);
  console.log(`\n  Onboarding funnel — cohort ${newest.cohortDay}, ${newest.size} accounts`);
  console.log('  Counted per account, not per event: someone prompted three times is one person.\n');
  for (const step of ['account_created', 'message_sent', 'memory_saved', 'notification_permission_granted', 'installed_pwa', 'subscription_started'] as const) {
    console.log(`    ${pad(step, 34)}${rate(funnel[step] ?? 0, newest.size)}`);
  }
}

async function cost(): Promise<void> {
  console.log('\n══ COST ═══════════════════════════════════════════════════\n');

  const plans = await economics.planCounts();
  const accounts = plans.free + plans.paid;
  console.log(`  accounts       ${accounts}  (${plans.free} free, ${plans.paid} paid)`);
  if (accounts === 0) {
    console.log('\n  Nothing to measure yet.');
    return;
  }

  const month = new Date().toISOString().slice(0, 7);
  const spend = await economics.monthlySpendMicros(month);
  console.log(`  model spend    ${money(spend)} this month (${month}), everybody`);
  if (plans.paid > 0) {
    // The only ratio that decides whether this survives, and it is printed
    // with its assumption because the revenue side is a list price rather
    // than a measured receipt.
    const revenue = plans.paid * 9_000_000;
    console.log(`  against        ${money(revenue)} subscription revenue at list price`);
    console.log(`                 [ASSUMED $9/month × ${plans.paid} paid accounts — not read from Stripe]`);
    console.log(`  margin         ${money(revenue - spend)}`);
  }

  console.log('\n  Per-account pressure against the ceilings (LESSONS §12).');
  console.log('  nearCeiling is the number that moves first; atCeiling is the');
  console.log('  number of people who have already been told no.\n');

  const free = limitsFor('free');
  const paid = limitsFor('paid');
  const today = new Date().toISOString().slice(0, 10);

  const meters = [
    { kind: 'model_cost_micros', period: month, ceiling: free.modelCostPerMonth, label: 'model spend / month', show: money },
    { kind: 'messages', period: today, ceiling: free.messagesPerDay, label: 'messages / today', show: String },
    { kind: 'tts_chars', period: month, ceiling: paid.ttsCharsPerMonth, label: 'tts characters / month', show: String },
    { kind: 'stt_seconds', period: month, ceiling: paid.sttSecondsPerMonth, label: 'stt seconds / month', show: String },
    { kind: 'storage_bytes', period: 'held', ceiling: free.storageBytes, label: 'storage held', show: bytes },
  ] as const;

  console.log(`  ${pad('meter', 24)}${pad('using', 7)}${pad('median', 12)}${pad('p90', 12)}${pad('max', 12)}${pad('near', 6)}at`);
  for (const meter of meters) {
    const pressure = await economics.counterPressure({ kind: meter.kind, periodKey: meter.period, ceiling: meter.ceiling });
    console.log(
      `  ${pad(meter.label, 24)}${pad(String(pressure.accounts), 7)}`
      + `${pad(meter.show(pressure.median), 12)}${pad(meter.show(pressure.p90), 12)}${pad(meter.show(pressure.max), 12)}`
      + `${pad(String(pressure.nearCeiling), 6)}${pressure.atCeiling}`,
    );
  }
  console.log('');
  console.log(`  ceilings       model ${money(free.modelCostPerMonth)}/mo free · messages ${free.messagesPerDay}/day free`);
  console.log(`                 tts ${paid.ttsCharsPerMonth} chars/mo · stt ${paid.sttSecondsPerMonth} s/mo · storage ${bytes(free.storageBytes)} free, ${bytes(paid.storageBytes)} paid`);
  console.log(`  storage period 'held' — bytes do not reset monthly; the meter moves both ways`);
  console.log(`  currency       ${DEFAULT_CURRENCY} for captured money; costs above are USD`);
  console.log('');
  console.log('  What is NOT here: the actual invoice. These are OUR counters,');
  console.log('  charged from usage the provider reported per call. A divergence');
  console.log('  between this and a real bill is the thing to look for first.');
}

async function main(): Promise<void> {
  try {
    databaseUrl();
  } catch (error) {
    // The honest answer to "what did you measure": nothing, and why.
    console.error(`\ncannot report: ${(error as Error).message}\n`);
    process.exit(78);
  }
  console.log('\nLIAN — weekly report');
  console.log(`generated ${new Date().toISOString()}`);
  if (WANT.retention) await retention();
  if (WANT.cost) await cost();
  console.log('');
  await closeDb();
}

await main();
