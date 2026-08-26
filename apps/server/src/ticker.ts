// The external ticker.
//
//   node apps/server/src/ticker.ts
//
// Q16: the schedule is driven from OUTSIDE the web process. Two reasons, both
// learned rather than chosen: a serverless host has no long-lived process to
// run a loop in, and Vercel Hobby cron runs roughly twice a day, which is not
// a reminder system.
//
// So this is a tiny signed HTTP client — deployable as a container, a
// systemd timer, a Kubernetes CronJob, or anything else that can run a
// process. What it does not do is share a database connection with the
// server: the tick is a request like any other, rate limited and
// authenticated, and that is what makes it testable and replaceable.
import { signTick } from '@lian/jobs';

const INTERVAL_SECONDS = Number(process.env['LIAN_TICK_INTERVAL_SECONDS'] ?? '300');
/** Where the server is. Falls back to PORT so a local run with a non-default
 *  port does not silently tick nothing. */
const target = (process.env['LIAN_PUBLIC_URL'] ?? `http://localhost:${process.env['PORT'] ?? '8787'}`).replace(/\/$/, '');
const secret = process.env['LIAN_TICK_SECRET'] ?? '';

if (secret === '') {
  console.error('LIAN_TICK_SECRET is not set — the server would refuse every call');
  process.exit(78);
}

async function tickOnce(): Promise<void> {
  const body = JSON.stringify({ source: 'ticker' });
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const response = await fetch(`${target}/api/tick`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lian-timestamp': String(timestamp),
        'x-lian-signature': signTick(secret, timestamp, body),
      },
      body,
    });
    const text = await response.text();
    // One line per tick, with the report in it: this is the only place the
    // schedule is observable from outside.
    console.log(`${new Date().toISOString()} ${response.status} ${text.slice(0, 500)}`);
  } catch (error) {
    // A failed tick is not fatal — the next one picks up the same work,
    // because every job in the schedule is idempotent.
    console.error(`${new Date().toISOString()} tick failed: ${String(error)}`);
  }
}

console.log(`ticking ${target}/api/tick every ${INTERVAL_SECONDS}s`);
// A moment before the first one: started beside the server, the ticker is
// usually ready first, and a failed tick in the first line of the log reads
// like a broken deployment rather than a race.
await new Promise((resolve) => setTimeout(resolve, 2_000));
await tickOnce();
setInterval(() => { void tickOnce(); }, INTERVAL_SECONDS * 1000);
