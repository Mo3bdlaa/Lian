// Onboarding.
//
// PRD §8: a conversation, not a setup form, whose emotional goal is "she
// remembers me".  Four things have to come out of it:
//
//   1. what to call the user
//   2. what language they want
//   3. something meaningful about them — which becomes the first memory
//   4. her name, which they give her
//
// The state below is DERIVED from what is known, not a step counter.  That
// difference is the product: someone who says "I'm Adam, and you can be Noor"
// in one sentence has answered two questions, and a wizard would ask both
// again.  Progress is a set of facts, and the next question is whichever one
// is still missing.
export type OnboardingFacts = {
  readonly userName: string | null;
  readonly languageChosen: boolean;
  /** The first thing she actually remembered about them. */
  readonly firstMemory: boolean;
  readonly assistantNamed: boolean;
  readonly notificationPrompted: boolean;
};

export type OnboardingStep =
  | 'greet'
  | 'learn_name'
  | 'learn_language'
  | 'learn_something'
  /** Asked only after the first remembered moment — see below. */
  | 'ask_notification_permission'
  | 'name_her'
  | 'done';

/**
 * The one ordering decision worth stating: the notification permission is
 * asked AFTER she has remembered something, never before.
 *
 * Asking first is asking a stranger for a key.  Asking after "I'll remember
 * that" has landed is asking someone who has just seen what the permission is
 * for — and PRD §18 counts notification opt-in as a success metric, which
 * makes the order a product decision rather than a UI preference.
 */
export function nextStep(facts: OnboardingFacts): OnboardingStep {
  if (facts.userName === null) return facts.firstMemory ? 'learn_name' : 'greet';
  if (!facts.languageChosen) return 'learn_language';
  if (!facts.firstMemory) return 'learn_something';
  if (!facts.notificationPrompted) return 'ask_notification_permission';
  if (!facts.assistantNamed) return 'name_her';
  return 'done';
}

export function isComplete(facts: OnboardingFacts): boolean {
  return nextStep(facts) === 'done';
}

/** What she is told to find out next, in the prompt.  One thing at a time:
 *  a message that asks three questions reads like a form with a friendlier
 *  font. */
export const STEP_INSTRUCTION: Readonly<Record<OnboardingStep, string>> = {
  greet:
    'This is the very first thing they will read from you. Introduce yourself as a secretary, more or less, say plainly what you keep, and ask what to call them. Nothing else.',
  learn_name: 'You still do not know what to call them. Ask, once, without making it a form.',
  learn_language:
    'Ask which language they would rather use, and mention you can switch any time. If they have already been writing in one, say you noticed and offer to keep to it.',
  learn_something:
    'Ask one open question about them — what their week looks like, what they are in the middle of. When they answer, say what you will remember from it, in your own words. That sentence is the whole point of this conversation.',
  ask_notification_permission:
    'You have just remembered something about them. Now say that you can reach them even when the app is closed — to follow up, to remind them, to check in when it matters — and that they can decide. Do not oversell it and do not ask twice.',
  name_her:
    'Ask what they would like to call you. If they say you should choose, choose one and say why; Lian is a good first suggestion. Do not present a list.',
  done: 'Onboarding is finished. Do not refer to it or ask any more setup questions.',
};
