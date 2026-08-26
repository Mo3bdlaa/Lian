// Voice notes from the user.
//
// Q14: transcription is server-side, and THE TRANSCRIPT IS THE MESSAGE BODY —
// the audio is an attachment.  That is not a storage preference, it is what
// makes the rest of the product work on a voice note:
//
//   - memory extraction reads message bodies (Q11 provenance points at a
//     message, and a memory whose source is an opaque audio blob cannot be
//     shown to anyone)
//   - search reads message bodies
//   - the rolling summary reads message bodies
//   - the model reads message bodies
//
// A voice note stored as audio alone is a message the product cannot think
// about.  So a failed transcription does not become a silent message: it is
// an error the turn can speak about.
export type TranscribePort = {
  transcribe(input: { audio: Uint8Array; contentType: string; languageHint: string | null }): Promise<{ text: string; language: string | null }>;
};

export type TranscribeUsagePort = {
  /** Voice is metered the same way synthesis is (LESSONS §12). */
  reserveSeconds(userId: string, month: string, ceiling: number, seconds: number): Promise<boolean>;
};

export type VoiceNoteInput = {
  readonly userId: string;
  readonly audio: Uint8Array;
  readonly contentType: string;
  readonly durationSeconds: number;
  readonly month: string;
  readonly secondsCeiling: number;
  /** 'en' | 'ar' from the user's language setting; the provider does better
   *  with a hint than with autodetect on short, code-switched clips. */
  readonly languageHint: string | null;
};

export type VoiceNoteResult =
  | { readonly status: 'transcribed'; readonly text: string; readonly language: string | null }
  | { readonly status: 'ceiling_reached' }
  /** UI-UX §20 has copy for this; the turn says it in her voice. */
  | { readonly status: 'failed'; readonly reason: string };

/** Longer than this is not a voice note, it is a recording. */
export const MAX_VOICE_NOTE_SECONDS = 300;

export async function transcribeVoiceNote(
  input: VoiceNoteInput,
  ports: { speech: TranscribePort; usage: TranscribeUsagePort },
): Promise<VoiceNoteResult> {
  if (input.durationSeconds > MAX_VOICE_NOTE_SECONDS) {
    return { status: 'failed', reason: 'that is longer than I can listen to in one go' };
  }
  if (input.audio.byteLength === 0) return { status: 'failed', reason: 'the recording was empty' };

  const granted = await ports.usage.reserveSeconds(input.userId, input.month, input.secondsCeiling, Math.ceil(input.durationSeconds));
  if (!granted) return { status: 'ceiling_reached' };

  let result: { text: string; language: string | null };
  try {
    result = await ports.speech.transcribe({ audio: input.audio, contentType: input.contentType, languageHint: input.languageHint });
  } catch (error) {
    return { status: 'failed', reason: (error as Error).message };
  }

  // An empty transcript is a failure, not an empty message.  Storing it would
  // put a message in the conversation that says nothing and that nothing
  // downstream can read.
  if (result.text.trim() === '') return { status: 'failed', reason: 'I could not make out anything in that' };

  return { status: 'transcribed', text: result.text.trim(), language: result.language };
}
