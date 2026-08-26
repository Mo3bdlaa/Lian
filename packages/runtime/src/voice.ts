// Speaking, wired.
//
// The one thing this file exists to get right is LESSONS §8's `persist` flag,
// and the way it gets it right is by DERIVING it rather than accepting it:
// a caller cannot pass `persist: true` for an incognito conversation, because
// callers do not pass it at all.
import { speak, type SpeakInput, type SpeakResult, type SynthesiserPort, type VoiceCachePort, type UsagePort } from '@lian/voice';
import { limitsFor, type Plan } from '@lian/domain';

export type SpeakForTurnInput = {
  readonly userId: string;
  readonly text: string;
  readonly voiceId: string;
  readonly plan: Plan;
  readonly month: string;
  /** From the conversation row, not from a parameter. 'ephemeral' is
   *  incognito, and incognito audio is never cached (LESSONS §8, Q12). */
  readonly retention: 'persist' | 'ephemeral';
};

export type SpeakForTurnResult = SpeakResult | { readonly status: 'not_on_this_plan' };

export async function speakForTurn(
  input: SpeakForTurnInput,
  ports: { cache: VoiceCachePort; synthesiser: SynthesiserPort; usage: UsagePort },
): Promise<SpeakForTurnResult> {
  const limits = limitsFor(input.plan);
  // PRD §10: voice is paid-only. Checked before anything is generated, so a
  // free user never costs a synthesis call.
  if (!limits.voice) return { status: 'not_on_this_plan' };

  const request: SpeakInput = {
    userId: input.userId,
    text: input.text,
    voiceId: input.voiceId,
    month: input.month,
    characterCeiling: limits.ttsCharsPerMonth,
    // Derived, never passed in.
    persist: input.retention === 'persist',
  };
  return speak(request, ports);
}
