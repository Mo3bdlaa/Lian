// ==========================================================================
// THE ONLY PLACE AUDIO IS WRITTEN TO THE CACHE — LESSONS §8.
//
// "Audio generated in a non-persisting context must not be written to any
// cache, from any call site."
//
// Noura wrote TTS to cache from three places, not one.  Fixing the
// pre-generation path looked correct and delayed the write rather than
// preventing it — first playback still persisted the row.  The lesson ends:
// "when adding a 'don't persist this' rule, enumerate every write path before
// declaring it done."
//
// So there is one write path, and it is this function.  The cache port is
// imported nowhere else, and tools/gates/voice-cache.ts fails the build if it
// ever is.  Enumerating the write paths is a build step rather than a memory.
// ==========================================================================
import { createHash } from 'node:crypto';

export type VoiceCachePort = {
  find(textHash: string, voiceId: string): Promise<{ storageKey: string } | null>;
  /** Called from exactly one place in the product. */
  put(input: { textHash: string; voiceId: string; storageKey: string; bytes: number }): Promise<void>;
};

export type SynthesiserPort = {
  synthesise(input: { text: string; voiceId: string }): Promise<{ storageKey: string; bytes: number }>;
};

export type UsagePort = {
  /** LESSONS §12 applies to voice too: a paid model with no per-user ceiling
   *  is how these products die, and TTS is billed per character. */
  reserveCharacters(userId: string, month: string, ceiling: number, characters: number): Promise<boolean>;
};

export type SpeakInput = {
  readonly userId: string;
  readonly text: string;
  readonly voiceId: string;
  readonly month: string;
  readonly characterCeiling: number;
  /**
   * FALSE for anything produced in a non-persisting context: incognito, a
   * scenario role, a preview.  Not a hint — the write is inside the branch.
   */
  readonly persist: boolean;
};

export type SpeakResult =
  | { readonly status: 'ready'; readonly storageKey: string; readonly cached: boolean }
  | { readonly status: 'ceiling_reached' }
  /** UI-UX §20: "The voice note didn't work, so I'll say it here instead." */
  | { readonly status: 'failed'; readonly reason: string };

export function hashText(text: string): string {
  return createHash('sha256').update(text.trim()).digest('base64url');
}

export async function speak(
  input: SpeakInput,
  ports: { cache: VoiceCachePort; synthesiser: SynthesiserPort; usage: UsagePort },
): Promise<SpeakResult> {
  const textHash = hashText(input.text);

  // A READ from the cache is fine in any context — it persists nothing.  It is
  // the write that the rule is about.
  if (input.persist) {
    const hit = await ports.cache.find(textHash, input.voiceId);
    if (hit !== null) return { status: 'ready', storageKey: hit.storageKey, cached: true };
  }

  const granted = await ports.usage.reserveCharacters(input.userId, input.month, input.characterCeiling, input.text.length);
  if (!granted) return { status: 'ceiling_reached' };

  let generated: { storageKey: string; bytes: number };
  try {
    generated = await ports.synthesiser.synthesise({ text: input.text, voiceId: input.voiceId });
  } catch (error) {
    return { status: 'failed', reason: (error as Error).message };
  }

  // The single write.  Everything above it runs in both modes; only this is
  // conditional, and it is conditional here rather than at three call sites.
  if (input.persist) {
    await ports.cache.put({ textHash, voiceId: input.voiceId, storageKey: generated.storageKey, bytes: generated.bytes });
  }

  return { status: 'ready', storageKey: generated.storageKey, cached: false };
}
