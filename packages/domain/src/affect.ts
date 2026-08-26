// Affect signals.
//
// Q9: mood is RULE-DERIVED, never declared by the model.  That decision has a
// cost, and this file is the cost: without a model there is no sentiment
// analysis, so affect is estimated from what can be observed cheaply.
//
// This is a heuristic and says so.  It is a small bilingual lexicon over the
// user's recent messages, plus two structural signals that need no language
// at all — how much they have been talking, and whether they answer her.  It
// will be wrong about sarcasm, about "fine", and about anyone whose register
// it does not know.
//
// What makes that acceptable: the output is a MOOD, which changes the warmth
// of a phrase and the chroma of a palette. Nothing depends on it being right,
// and a generated mood phrase would be a second surface speaking in her voice
// with no test over it — which is a worse trade.  If this is replaced with a
// real classifier, replace it here: nothing else reads the lexicon.
export type AffectLexicon = { readonly heavy: readonly string[]; readonly light: readonly string[] };

export const LEXICON: Record<'en' | 'ar', AffectLexicon> = {
  en: {
    heavy: ['tired', 'exhausted', 'stressed', 'anxious', 'worried', 'sad', 'awful', 'terrible', 'overwhelmed',
      'sick', 'hurt', 'angry', 'lonely', 'struggling', 'heavy', 'rough', 'hard', 'cannot', "can't", 'failed', 'sorry'],
    light: ['good', 'great', 'happy', 'excited', 'lovely', 'better', 'glad', 'relieved', 'proud', 'thanks',
      'thank', 'finally', 'done', 'finished', 'love', 'nice', 'fun', 'easier', 'calm'],
  },
  ar: {
    heavy: ['تعبان', 'تعبانة', 'مرهق', 'قلقان', 'زعلان', 'وحش', 'صعب', 'تقيل', 'مضغوط', 'وحيد', 'مش قادر',
      'مش عارف', 'خايف', 'زهقان', 'حزين', 'مريض'],
    light: ['كويس', 'تمام', 'مبسوط', 'فرحان', 'أحسن', 'الحمد', 'خلصت', 'شكرا', 'شكراً', 'حلو', 'جميل', 'ارتحت', 'فخور'],
  },
};

/**
 * −1 (heavy) … 1 (light) from the user's recent messages.
 * Returns 0 when there is nothing to go on, which reads as neutral.
 */
export function affectFromMessages(messages: readonly string[], language: 'en' | 'ar'): number {
  if (messages.length === 0) return 0;
  const lexicon = LEXICON[language];
  let heavy = 0;
  let light = 0;
  for (const message of messages) {
    const text = message.toLowerCase();
    for (const word of lexicon.heavy) if (text.includes(word)) heavy += 1;
    for (const word of lexicon.light) if (text.includes(word)) light += 1;
  }
  const total = heavy + light;
  if (total === 0) return 0;
  return (light - heavy) / total;
}

/** Recent contact, normalised against a typical day, capped at 1. */
export const TYPICAL_MESSAGES_PER_DAY = 8;

export function activityFromCount(messagesLast24h: number): number {
  return Math.min(1, messagesLast24h / TYPICAL_MESSAGES_PER_DAY);
}
