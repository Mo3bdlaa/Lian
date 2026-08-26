// The TTS cache.
//
// LESSONS §8: audio generated in a non-persisting context must not be written
// to any cache, from any call site. This repository is the table's only
// writer, and packages/voice/src/speak.ts is this repository's only caller —
// tools/gates/voice-cache.ts fails the build if either stops being true.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';

export type CachedAudio = { storageKey: string };

export async function find(textHash: string, voiceId: string, sql: Sql = db()): Promise<CachedAudio | null> {
  const { rows } = await sql.query<{ storage_key: string }>(
    `SELECT storage_key FROM tts_cache WHERE text_hash = $1 AND voice_id = $2`,
    [textHash, voiceId],
  );
  return rows[0] === undefined ? null : { storageKey: rows[0].storage_key };
}

/** The single write. */
export async function put(
  input: { textHash: string; voiceId: string; storageKey: string; bytes: number },
  sql: Sql = db(),
): Promise<void> {
  await sql.query(
    `INSERT INTO tts_cache (text_hash, voice_id, storage_key, bytes)
     VALUES ($1, $2, $3, $4) ON CONFLICT (text_hash, voice_id) DO NOTHING`,
    [input.textHash, input.voiceId, input.storageKey, input.bytes],
  );
}
