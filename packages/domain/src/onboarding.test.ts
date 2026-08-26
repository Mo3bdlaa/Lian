import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextStep, isComplete, STEP_INSTRUCTION, type OnboardingFacts } from './onboarding.ts';

const nothing: OnboardingFacts = {
  userName: null, languageChosen: false, firstMemory: false, assistantNamed: false, notificationPrompted: false,
};

describe('PRD §8 onboarding is state, not a step counter', () => {
  test('it opens by introducing herself and asking one thing', () => {
    assert.equal(nextStep(nothing), 'greet');
    assert.match(STEP_INSTRUCTION.greet, /secretary, more or less/);
    assert.match(STEP_INSTRUCTION.greet, /Nothing else\./, 'one question, or it is a form');
  });

  test('someone who answers two things at once is not asked twice', () => {
    // "I'm Adam, and you can be Noor" — a wizard would ask both again.
    const both = { ...nothing, userName: 'Adam', assistantNamed: true };
    assert.equal(nextStep(both), 'learn_language', 'it moves to what is actually still unknown');
  });

  test('the four things are learned in a sensible order when nothing is known', () => {
    let facts = nothing;
    const steps: string[] = [];
    const answer: Record<string, () => OnboardingFacts> = {
      greet: () => ({ ...facts, userName: 'Adam' }),
      learn_name: () => ({ ...facts, userName: 'Adam' }),
      learn_language: () => ({ ...facts, languageChosen: true }),
      learn_something: () => ({ ...facts, firstMemory: true }),
      ask_notification_permission: () => ({ ...facts, notificationPrompted: true }),
      name_her: () => ({ ...facts, assistantNamed: true }),
    };
    for (let i = 0; i < 8; i++) {
      const step = nextStep(facts);
      if (step === 'done') break;
      steps.push(step);
      facts = answer[step]!();
    }
    assert.deepEqual(steps, ['greet', 'learn_language', 'learn_something', 'ask_notification_permission', 'name_her']);
    assert.ok(isComplete(facts));
  });

  test('the notification prompt comes AFTER the first remembered moment', () => {
    // The ruling, and the reason: asking before she has remembered anything
    // is asking a stranger for a key.  PRD §18 counts opt-in as a success
    // metric, which makes the order a product decision.
    const beforeMemory = { ...nothing, userName: 'Adam', languageChosen: true };
    assert.equal(nextStep(beforeMemory), 'learn_something');
    assert.notEqual(nextStep(beforeMemory), 'ask_notification_permission');

    const afterMemory = { ...beforeMemory, firstMemory: true };
    assert.equal(nextStep(afterMemory), 'ask_notification_permission');
    assert.match(STEP_INSTRUCTION.ask_notification_permission, /You have just remembered something/);
  });

  test('the "something meaningful" step is the point of the conversation', () => {
    assert.match(STEP_INSTRUCTION.learn_something, /say what you will remember from it/);
    assert.match(STEP_INSTRUCTION.learn_something, /the whole point/, 'the emotional goal is "she remembers me"');
  });

  test('Q18: they always get to name her, and she chooses only if asked', () => {
    assert.match(STEP_INSTRUCTION.name_her, /Ask what they would like to call you/);
    assert.match(STEP_INSTRUCTION.name_her, /Lian is a good first suggestion/);
    assert.match(STEP_INSTRUCTION.name_her, /Do not present a list/, 'a list is a configuration wizard');
  });

  test('once done, she is told to stop asking', () => {
    const done = { userName: 'Adam', languageChosen: true, firstMemory: true, assistantNamed: true, notificationPrompted: true };
    assert.equal(nextStep(done), 'done');
    assert.match(STEP_INSTRUCTION.done, /Do not refer to it/);
  });

  test('a user who never chose a language is still asked, even long after', () => {
    // 'auto' is the onboarding DEFAULT (PRD §29), so it does not count as
    // having chosen — but everything else can be complete around it.
    const facts = { ...nothing, userName: 'Adam', firstMemory: true, assistantNamed: true, notificationPrompted: true };
    assert.equal(nextStep(facts), 'learn_language');
  });
});
