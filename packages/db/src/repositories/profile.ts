// The user's own notes about themselves (UI-UX §12).
//
// Distinct from memory on purpose: profile is user-authored, memory is
// assistant-captured.  The prompt keeps them in separate blocks for the same
// reason — "what they say about themselves" and "what you remember about
// them" are different kinds of claim.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { UserScope } from '../scope.ts';

export type ProfileSection = 'about' | 'should_know' | 'notes';
export type ProfileNote = { id: string; section: ProfileSection; body: string };

export async function list(scope: UserScope, sql: Sql = db()): Promise<ProfileNote[]> {
  const { rows } = await sql.query<{ id: string; section: ProfileSection; body: string }>(
    `SELECT id, section, body FROM profile_notes WHERE user_id = $1 ORDER BY section`,
    [scope.userId],
  );
  return rows;
}

export async function upsert(scope: UserScope, section: ProfileSection, body: string, sql: Sql = db()): Promise<void> {
  await sql.query(
    `INSERT INTO profile_notes (user_id, section, body) VALUES ($1, $2, $3)`,
    [scope.userId, section, body],
  );
}

export async function purge(scope: UserScope, sql: Sql = db()): Promise<void> {
  await sql.query(`DELETE FROM profile_notes WHERE user_id = $1`, [scope.userId]);
}
