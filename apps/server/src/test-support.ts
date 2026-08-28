// One client address helper, for every test file that needs one.
//
// THERE WERE SIX COPIES OF THIS AND THAT IS WHY IT BROKE (LESSONS §22, in
// test support rather than in the product). Every one of them read
//
//     `10.${process.pid % 256}.${(n >> 8) % 256}.${n % 256}`
//
// which is unique per call and *almost* unique per process — `pid % 256`
// collides whenever two files in one run draw pids congruent mod 256, which
// is a one-in-256 coin flip per pair and therefore near-certain across a
// suite of this size. When it landed, the second file's first sign-up shared
// the first file's `auth:ip:` bucket, hit the ten-a-minute limit, and failed
// with a 429 three tests in — a failure that moves depending on what else ran.
//
// LESSONS §28 said "unique per call AND per process". The pid scheme was an
// approximation of the second half, and an approximation of uniqueness is not
// uniqueness.
import { randomBytes } from 'node:crypto';

/**
 * A client address no other call, file or run will produce.
 *
 * IPv6, and specifically a unique-local address (fc00::/7), for three
 * reasons:
 *
 *   1. **It cannot collide.** 112 bits of randomness per call, against a
 *      scheme that had eight bits of process identity. There is no birthday
 *      problem left to reason about.
 *   2. **It is not routable**, so `isRoutable` refuses it and no test address
 *      ever reaches a geo lookup — which is the honest thing for a fake
 *      address to be, and keeps `@lian/geo` out of tests that are not about it.
 *   3. **It exercises the v6 path**, which the old v4-only scheme never did.
 *      `clientIp` and the address parser both have to handle it, and a suite
 *      that only ever sends v4 is a suite that would not notice if they
 *      stopped.
 */
export function clientAddress(): string {
  const bytes = randomBytes(7).toString('hex');
  return `fd00:${bytes.slice(0, 4)}:${bytes.slice(4, 8)}:${bytes.slice(8, 12)}::${bytes.slice(12, 14)}`;
}
