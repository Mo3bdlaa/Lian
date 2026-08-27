// ==========================================================================
// WHAT SHE IS ALLOWED TO PROMISE.
//
// The product's design is that she speaks for the machinery. That is its best
// idea and its most dangerous one, because every seam between what she SAYS
// and what something else DOES is a place she can be made to lie — and she
// will do it warmly, in the first person, and nobody will notice.
//
// It has already happened once, and it was the worst possible instance:
//
//     "remind me to call the bank"  →  "I'll remind you."
//
// A `<todo>` with no date stored `due_on NULL`. That matched `due_on = $2`
// in no outreach query and no briefing block, so no reminder would ever have
// fired, on any day, forever. Every part was individually correct. The
// capture worked, the row was right, the chip was right, the Tasks screen
// showed it — and the one sentence the product exists to make true was false
// the first time somebody asked for it.
//
// So this file is the list, and tools/gates/promises.ts is the rule:
//
//   1. Every capability tag is CLASSIFIED — it either records something that
//      has already happened, or it commits to a future action. A tag added
//      without a classification fails the build.
//   2. Every commitment names the MECHANISM that performs it, and a marker
//      that proves the mechanism is still there. Deleting the scheduler
//      breaks the build rather than breaking a promise.
//   3. Every promise-shaped SENTENCE in the catalogue is classified the same
//      way. "I'll…" in her voice is a commitment; a new one has to say what
//      keeps it.
//
// The rule underneath all three: WHERE THE MECHANISM CANNOT, SHE MUST NOT SAY
// IT. A sentence with nothing behind it is removed, not documented.
// ==========================================================================

/** What performs a promise, and how to tell it is still there. */
export type Mechanism = {
  /** Repo-relative file that does the work. */
  readonly where: string;
  /** Text that must still be in it. Chosen to be the LOAD-BEARING line, so a
   *  refactor that keeps the file and drops the behaviour still fails. */
  readonly marker: RegExp;
};

export type Promise_ =
  /** Records something that already happened. Nothing is owed afterwards. */
  | { readonly kind: 'records'; readonly why: string }
  /** Commits to a future action, performed by these mechanisms. */
  | { readonly kind: 'commits'; readonly says: string; readonly by: readonly Mechanism[] };

/**
 * Every control tag the model may emit, classified.
 *
 * The gate reads the capability registry for the real list and fails if a tag
 * is here and not there, or there and not here — so this cannot drift into
 * being a description of what the tags used to be.
 */
export const TAG_PROMISES: Record<string, Promise_> = {
  spend: {
    kind: 'records',
    why: 'A transaction that already happened. The row IS the delivery; the Money screen shows it and the correction sheet changes it.',
  },
  note: { kind: 'records', why: 'Something written down. Nothing is owed after writing it down.' },
  health: { kind: 'records', why: 'A meal or a workout that already happened.' },
  moment: {
    kind: 'records',
    why: 'Something that already happened between them, written onto the story timeline. It records and '
      + 'promises nothing: there is no follow-up, no reminder and no outreach behind it, and the '
      + 'capability deliberately contributes NOTHING back to her context — feeding moments into the '
      + 'prompt would turn a record of what happened into a prompt to make more of them.',
  },
  inside_joke: {
    kind: 'records',
    why: 'A joke that has already recurred between them. Same as `moment`: the row IS the whole of it, and '
      + 'the story screen is where it is seen and removed.',
  },
  call_me: { kind: 'records', why: "The user's name, applied from the next turn onward by the prompt's identity block." },
  language: { kind: 'records', why: 'A setting, applied from the next turn onward.' },
  my_name: { kind: 'records', why: 'Her name, applied from the next turn onward.' },

  todo: {
    kind: 'commits',
    says: "I'll remind you.",
    by: [
      {
        // The scheduler, for a task that HAS a day.
        where: 'packages/capabilities/src/tasks/index.ts',
        marker: /proposeOutreach/,
      },
      {
        // And the briefing, for a task that does not — the half that was
        // missing, and the reason this file exists.
        where: 'apps/server/src/wiring.ts',
        marker: /task\.dueOn === null \|\| task\.dueOn < localDay/,
      },
      {
        where: 'apps/server/src/http.test.ts',
        marker: /a task with no day is still somewhere she will raise it/,
      },
    ],
  },
  habit: {
    kind: 'commits',
    says: 'I will bring this up on the days you said.',
    by: [
      {
        where: 'packages/capabilities/src/tasks/index.ts',
        // Not just "there is a recurrence": the day check is the promise.
        marker: /recursOn\(task\.recurrence, context\.localDay\)/,
      },
    ],
  },
};

/**
 * Sentences in the catalogue that commit to something, and what keeps them.
 *
 * A key here that no longer exists in the catalogue fails the gate, and a
 * catalogue string that READS like a commitment and is not listed fails it
 * too. Both directions, because a promise deleted from the list while the
 * sentence stays is exactly how this goes wrong quietly.
 */
export const COPY_PROMISES: Record<string, Promise_> = {
  // The first sentence anybody reads from her, and it commits to two things:
  // that she keeps what she is told, and that she brings it back. Both have
  // mechanisms; naming them here is what stops the opening becoming a
  // brochure sentence when one of them is refactored away.
  'greeting.first': {
    kind: 'commits',
    says: 'I keep track of what you tell me, and bring it back when it matters.',
    by: [
      { where: 'packages/analysis/src/extract.ts', marker: /export async function extractMemories/ },
      // "Brings it back" is retrieval into the turn, not storage.
      { where: 'packages/db/src/repositories/memories.ts', marker: /export async function retrieve/ },
    ],
  },
  // Removing a moment from the timeline promises that MEMORY is untouched.
  // That is a real commitment and a load-bearing one — somebody tidying their
  // story must not silently be making her forget them — and what keeps it is
  // that the delete is a single UPDATE against one table, with no cascade and
  // nothing else in the path.
  'story.remove_body': {
    kind: 'commits',
    says: 'What I remember about you is separate, and stays.',
    by: [
      {
        where: 'packages/db/src/repositories/story.ts',
        // The marker is the WHOLE statement, not the function name: a delete
        // that grew a second table, or that stopped being confined to
        // story_events, is exactly the drift that would make this sentence
        // false while the function still had the right name.
        marker: /UPDATE story_events SET deleted_at = now\(\)/,
      },
    ],
  },
  'memory.search': {
    kind: 'records',
    why: 'A field label on the memory screen. The search it labels is /api/memories?q=, which exists.',
  },
  'data.delete_memories': {
    kind: 'records',
    why: 'A label naming what an export slice contains. Not a promise about the future.',
  },
  'permission.pre_prompt': {
    kind: 'commits',
    says: 'I can reach you even when you have not opened the app.',
    by: [
      { where: 'packages/jobs/src/deliver.ts', marker: /export async function deliver/ },
      { where: 'packages/push/src/send.ts', marker: /RFC 8291|aes128gcm/ },
    ],
  },
  'permission.notifications': {
    kind: 'commits',
    says: 'I can reach you even when you have not opened the app.',
    by: [{ where: 'packages/jobs/src/deliver.ts', marker: /export async function deliver/ }],
  },
  'plan.proactive': {
    kind: 'commits',
    says: 'She reaches out when there is a reason to.',
    by: [{ where: 'packages/jobs/src/candidates.ts', marker: /proposeOutreach/ }],
  },
  'quiet.explanation': {
    kind: 'commits',
    says: 'I will keep things quiet during these hours.',
    by: [
      { where: 'packages/domain/src/outreach.ts', marker: /export function isQuiet/ },
      // The exception is part of the promise: quiet hours do NOT silence a
      // security message, and the copy says "unless something important".
      { where: 'packages/jobs/src/deliver.ts', marker: /quiet|isQuiet/ },
    ],
  },
  'memory.empty': {
    kind: 'commits',
    says: "As we talk, I'll remember what matters.",
    by: [{ where: 'packages/analysis/src/extract.ts', marker: /export async function extractMemories/ }],
  },
  'memory.delete_body': {
    kind: 'commits',
    says: "I'll remove it from everything I remember.",
    // The statement, restored. This was weakened to the function name because
    // the boundaries gate read a marker containing a query AS a query — twice
    // — and the cheap fix each time was a weaker marker. That trades a real
    // guarantee for a green gate: `forget` keeping its name says nothing about
    // whether it still removes anything. The gate now strips regex literals
    // before it looks for SQL, so the marker can be the thing it is about.
    by: [{
      where: 'packages/db/src/repositories/memories.ts',
      marker: /UPDATE memories SET deleted_at = now\(\)/,
    }],
  },
  'memory.capacity_near': {
    kind: 'commits',
    says: "I'll show you what I'm holding so you can decide.",
    by: [{ where: 'packages/runtime/src/memory.ts', marker: /activeMemoriesPerAssistant/ }],
  },
  'memory.capacity_full': {
    kind: 'commits',
    says: "I haven't forgotten our chat — I just won't keep new things.",
    by: [{ where: 'packages/runtime/src/memory.ts', marker: /pending/ }],
  },
  'memory.queue_full': {
    kind: 'commits',
    says: 'Nothing is being dropped quietly.',
    by: [{ where: 'packages/runtime/src/memory.ts', marker: /pending/ }],
  },
  'limit.reached': {
    kind: 'commits',
    says: "I'll still be here tomorrow, and I'll keep what we talked about.",
    by: [
      // "Tomorrow" is the USER's local day, not UTC — the promise is false by
      // up to twelve hours without that.
      { where: 'packages/runtime/src/turn.ts', marker: /localDayKey\(input\.now, input\.timeZone\)/ },
    ],
  },
  'error.offline': {
    kind: 'commits',
    says: "I'll catch up when I can.",
    by: [{ where: 'apps/web/src/main.ts', marker: /catch ?up|CATCH_UP|setInterval/ }],
  },
  'error.outage': {
    kind: 'commits',
    says: "I'll come back as soon as I can.",
    by: [{ where: 'apps/web/src/main.ts', marker: /outage|retry/ }],
  },
  'error.voice_fallback': {
    kind: 'commits',
    says: "I'll say it here instead.",
    by: [{ where: 'apps/web/src/main.ts', marker: /voice_fallback/ }],
  },
  'error.voice_not_on_plan': {
    kind: 'commits',
    says: "Tell me here and I'll pick it up the same way.",
    // The promise is that TYPING works — which it does, and always did.
    by: [{ where: 'packages/runtime/src/turn.ts', marker: /export async function runTurn/ }],
  },
  'capture.failed': {
    kind: 'commits',
    says: "Say the amount again and I'll get it right.",
    by: [{ where: 'packages/runtime/src/turn.ts', marker: /capture/ }],
  },
  'capture.failed_task': {
    kind: 'commits',
    says: "Say it once more and I'll hold onto it.",
    by: [{ where: 'packages/runtime/src/turn.ts', marker: /capture/ }],
  },
  'language.explanation': {
    kind: 'records',
    why: 'A setting, applied from the next turn. "You can change it" is a screen that exists.',
  },
  'scenario.optional': { kind: 'records', why: 'Describes a control on the screen it is written on.' },
  'threads.incognito_detail': {
    kind: 'commits',
    says: 'The whole thread goes when you close it.',
    by: [{ where: 'packages/db/src/repositories/conversations.ts', marker: /hardDeleteConversation/ }],
  },
  'album.empty': { kind: 'records', why: 'Describes where a photo will appear; the album screen is that place.' },
  'chat.empty': { kind: 'records', why: '"I am here when you are ready" is a statement about now.' },
  'health.empty': { kind: 'records', why: 'An invitation, not a commitment.' },
  'story.not_a_score': { kind: 'records', why: 'A statement about what closeness is not.' },
  'settings.reach': { kind: 'records', why: 'A section heading.' },
  'limit.back_tomorrow': { kind: 'records', why: 'A label on the free-limit state, covered by limit.reached.' },
  'permission.pre_prompt_detail': { kind: 'records', why: 'Describes the plan and the settings screen, both of which exist.' },
  'consent.under_age': { kind: 'records', why: 'A refusal, delivered immediately.' },
  'plan.after_cancel': {
    kind: 'commits',
    says: 'Everything stays as it is until then.',
    // The gate corrected this on its first run: I named webhook.ts, which
    // VERIFIES the event, and the thing that actually keeps the promise is
    // the parse in stripe.ts that carries the period end and the
    // cancel-at-period-end flag through. Pointing at the wrong file is
    // exactly the drift this list exists to catch, so it caught mine.
    by: [{ where: 'packages/billing/src/stripe.ts', marker: /cancel_at_period_end/ }],
  },
  // The legal documents describe the build rather than promising future
  // action, and four tests already assert they stay true to it.
  'legal.terms_account_b': { kind: 'records', why: 'Describes how accounts work today.' },
  'legal.terms_paid_b': { kind: 'records', why: 'Describes billing today.' },
  'legal.privacy_long_b': { kind: 'records', why: 'Describes retention today; privacy.test.ts asserts it stays true.' },
  'legal.privacy_security_b': { kind: 'records', why: 'Describes storage today.' },
  'legal.privacy_contact_b': { kind: 'records', why: 'Says plainly that there is NO support address, which is the opposite of a promise.' },
};
