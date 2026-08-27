// Test support.  Every db test runs against a real Postgres — these
// constraints are database behaviour (triggers, unique indexes, CHECKs) and a
// mock would only prove the mock.
import { db, closeDb, type Sql } from './client.ts';
import { migrate } from './migrate.ts';
import * as accounts from './repositories/accounts.ts';
import type { AssistantScope, UserScope } from './scope.ts';

export const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';

let migrated = false;

/**
 * Migrate once per process, and say plainly when the database is not there.
 *
 * The plain saying matters more than it looks. A `before` hook that throws
 * cancels its suite rather than failing it, so node reports `pass 462,
 * fail 0, cancelled 100` — a summary that says nothing failed while a
 * hundred tests did not run. The exit code is still non-zero, so a build
 * catches it; a person reading the summary might not. Hence a message that
 * names the difference between "skipped" and "broken".
 */
export async function ready(): Promise<void> {
  if (migrated) return;
  try {
    await migrate(() => {});
  } catch (error) {
    const url = process.env['DATABASE_URL'] ?? '';
    throw new Error(
      `DATABASE_URL is set (${url.replace(/:[^:@/]*@/, ':***@')}) but Postgres could not be reached or migrated: `
      + `${(error as Error).message}. These tests are NOT skipped — they are broken, and node will report them `
      + `as 'cancelled' with a failure count of zero. Start Postgres (npm run db:up) or unset DATABASE_URL to skip them deliberately.`,
    );
  }
  migrated = true;
}

let counter = 0;
export async function freshUser(plan: 'free' | 'paid' = 'free', sql: Sql = db()): Promise<UserScope & { plan: 'free' | 'paid' }> {
  counter += 1;
  const user = await accounts.createUser(
    {
      email: `t${Date.now()}-${counter}@example.test`, passwordHash: 'x', timeZone: 'Asia/Dubai',
      consent: { isAdult: true, at: new Date(), version: 'test' },
    },
    sql,
  );
  if (plan === 'paid') await sql.query(`UPDATE users SET plan = 'paid' WHERE id = $1`, [user.id]);
  return { userId: user.id, plan };
}

export async function freshAssistant(scope: UserScope, name = 'Lian', sql: Sql = db()): Promise<AssistantScope> {
  const assistant = await accounts.createAssistant(scope, { name, gender: 'female' }, sql);
  return { userId: scope.userId, assistantId: assistant.id };
}

export async function done(): Promise<void> {
  await closeDb();
}
