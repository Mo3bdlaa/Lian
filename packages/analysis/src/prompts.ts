// ==========================================================================
// THE NON-VOICE PROMPT PATH.
//
// LESSONS §1, as restated: the constraint is not "one path", it is "no second
// path can construct a persona".  Everything that speaks in her voice goes
// through @lian/prompt.  Everything here READS TEXT AND RETURNS JSON — it
// extracts, classifies and titles, and a user never reads a word of it.
//
// Two conditions make that allowed, and both are enforced rather than
// promised:
//
//   1. This is the one clearly named place.  Every non-voice prompt in the
//      product is in this file.
//   2. tools/gates/analysis-path.ts fails the build if this package imports
//      @lian/prompt, mentions persona, canon or relationship, or produces a
//      string a user could mistake for her.
//
// If a prompt here ever needs her voice, it is on the wrong path — move it,
// do not soften the rule.
// ==========================================================================

/** Every prompt in this package, named, so the set is countable. */
export const ANALYSIS_PROMPTS = ['memory_extraction', 'canon_extraction', 'conversation_title'] as const;
export type AnalysisPrompt = (typeof ANALYSIS_PROMPTS)[number];

export const MEMORY_TYPES = ['fact', 'preference', 'topic', 'moment', 'person', 'emotional_state'] as const;

/**
 * Memory extraction.
 *
 * Deliberately narrow.  The failure mode of a memory system is not missing
 * things — it is remembering noise, then confidently repeating it.  So the
 * instructions are about what NOT to keep, and the model is told to return an
 * empty array when nothing qualifies, which is the common case.
 */
export const MEMORY_EXTRACTION_SYSTEM = `You extract durable facts from one exchange between a user and their assistant.

Return ONLY a JSON array. No prose, no code fence, no explanation. An empty array is correct and common.

Each element:
  {"type": <one of ${MEMORY_TYPES.join('|')}>, "statement": <one sentence, third person, about the USER>, "salience": <0.0-1.0>}

What qualifies:
- fact           something stable and true about their life: where they work, what they own, a recurring commitment
- preference     something they like, dislike, or choose repeatedly
- topic          something ongoing they will return to: a project, a decision, a worry
- moment         something that happened that they would want referred back to
- person         someone in their life, with the relationship
- emotional_state how they have been feeling, when it is more than passing

What does NOT qualify — return nothing for these:
- Anything the assistant said about itself.
- Anything already captured as a task, a transaction, a meal or a workout. Those are structured elsewhere.
- Small talk, pleasantries, one-off logistics ("I'll call you back later").
- Anything you inferred rather than were told. If it is a guess, leave it out.
- Anything about a third party that the user did not actually assert.
- Speculation about the future stated as fact.

Rules:
- statement must be understandable a year from now with no other context. "Their sister Dana lives in Cairo", not "she lives there".
- statement is about the user, in the third person, and never addresses them.
- salience: 0.9 for something that shapes many conversations, 0.5 for ordinary, 0.2 for barely worth keeping.
- Never invent a name, date, place or number that does not appear in the exchange.
- Prefer one good statement to three overlapping ones.`;

/**
 * Canon extraction — LESSONS §5.
 *
 * This one reads the ASSISTANT's side, not the user's: things she has said
 * about herself, which become binding on her.  It is still analysis — it
 * returns JSON about text — but the bar is deliberately higher than for
 * memory, because canon can never be contradicted and is never dropped.
 */
export const CANON_EXTRACTION_SYSTEM = `You extract statements an assistant made ABOUT ITSELF from its own message.

Return ONLY a JSON array. No prose, no code fence. An empty array is correct and common — most messages contain nothing.

Each element:
  {"category": <self|preference|history|boundary>, "statement": <one sentence, second person, addressed to the assistant>}

What qualifies — only a first-person claim the assistant made about itself:
- self        what it is like: "I find late nights easier for thinking"
- preference  something it likes or would choose: "I prefer to be told directly"
- history     something it says happened between it and the user: "We started talking in March"
- boundary    something it said it will not do

What does NOT qualify:
- Anything about the USER. That is memory, not canon.
- Anything it said it would DO for them. That is a task.
- Politeness and filler: "happy to help", "of course".
- Anything hedged: "I might", "I suppose". Canon is what it committed to.
- Anything it was clearly repeating back from the user.

Rules:
- statement is addressed TO the assistant, second person: "You do not drink coffee." It will be shown back to it as a binding fact.
- Extract only what was actually claimed. This is the one thing that can never be contradicted later, so a false positive is expensive.
- Prefer nothing to a maybe.`;

/** Titling a side conversation.  The cheapest possible non-voice prompt. */
export const CONVERSATION_TITLE_SYSTEM = `Give this conversation a title of at most five words.

Return ONLY the title. No quotes, no punctuation at the end, no explanation.
Describe the subject, not the people. "Apartment viewing in Marina", not "A chat about an apartment".`;
