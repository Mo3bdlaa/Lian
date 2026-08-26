// Test support.  Every db test runs against a real Postgres — these
// constraints are database behaviour (triggers, unique indexes, CHECKs) and a
// mock would only prove the mock.
import { db, closeDb, type Sql } from './client.ts';
import { migrate } from './migrate.ts';
import * as accounts from './repositories/accounts.ts';
import type { AssistantScope, UserScope } from './scope.ts';

export const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';

let migrated = false;
export async function ready(): Promise<void> {
  if (!migrated) {
    await migrate(() => {});
    migrated = true;
  }
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
