// The API key pool's state — LESSONS §12.
//
// "API key pools must rotate and cool down on 429, 403 and 401."  @lian/llm
// has held the rotation logic, tested, since the first run, and the table has
// existed since migration 0002.  Nothing joined them: `KeyPool` was
// constructed nowhere outside its own test, and `apps/server/src/app.ts`
// read `config.modelApiKeys[0]` — so an operator who set ANTHROPIC_API_KEY_2
// had a second key validated at startup, carried through config, and never
// used.  When the first key rate-limited, she stopped answering.
//
// THE KEY ITSELF IS NEVER STORED.  A row holds the NAME of the environment
// variable ("ANTHROPIC_API_KEY_2"), its cooldown, and how many times in a row
// it has failed.  A database is not a place secrets accumulate, and a
// database that held them would make every backup a secret too.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';

export type KeyState = { ref: string; cooldownUntil: Date | null; consecutiveFails: number };
type Row = { key_ref: string; cooldown_until: Date | null; consecutive_fails: number };

// db-scoping:allow-unscoped — provider state, with no user in it. The pool is
// process-wide by definition: which key answers a call has nothing to do with
// whose call it is, and scoping it per user would make one person's 429
// somebody else's problem to discover again.
export async function list(provider: string, sql: Sql = db()): Promise<KeyState[]> {
  const { rows } = await sql.query<Row>(
    `SELECT key_ref, cooldown_until, consecutive_fails FROM api_key_pool
     WHERE provider = $1 ORDER BY key_ref`,
    [provider],
  );
  return rows.map((row) => ({
    ref: row.key_ref, cooldownUntil: row.cooldown_until, consecutiveFails: row.consecutive_fails,
  }));
}

/**
 * Declare which refs exist, at startup.
 *
 * Idempotent, and it does NOT reset a cooldown: a process that restarts while
 * a key is cooling down must not put that key straight back into rotation,
 * or a crash loop becomes a way to ignore a 429. Refs that have gone away are
 * removed, so a key withdrawn from the environment stops being offered.
 */
// db-scoping:allow-unscoped — provider state, with no user in it.
export async function register(provider: string, refs: readonly string[], sql: Sql = db()): Promise<void> {
  if (refs.length === 0) {
    await sql.query(`DELETE FROM api_key_pool WHERE provider = $1`, [provider]);
    return;
  }
  await sql.query(
    `INSERT INTO api_key_pool (provider, key_ref)
     SELECT $1, unnest($2::text[])
     ON CONFLICT (provider, key_ref) DO NOTHING`,
    [provider, refs],
  );
  await sql.query(
    `DELETE FROM api_key_pool WHERE provider = $1 AND key_ref <> ALL($2::text[])`,
    [provider, refs],
  );
}

/** Out of rotation until `until`, with the count that decides the next one. */
// db-scoping:allow-unscoped — provider state, with no user in it.
export async function penalise(
  provider: string, ref: string, statusCode: number, until: Date, sql: Sql = db(),
): Promise<void> {
  await sql.query(
    `UPDATE api_key_pool
     SET cooldown_until = $4, last_status_code = $3, consecutive_fails = consecutive_fails + 1, updated_at = now()
     WHERE provider = $1 AND key_ref = $2`,
    [provider, ref, statusCode, until],
  );
}

/** A call succeeded: the streak is over. */
// db-scoping:allow-unscoped — provider state, with no user in it.
export async function clear(provider: string, ref: string, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE api_key_pool SET cooldown_until = NULL, consecutive_fails = 0, updated_at = now()
     WHERE provider = $1 AND key_ref = $2 AND (cooldown_until IS NOT NULL OR consecutive_fails > 0)`,
    [provider, ref],
  );
}
