// Moments and inside jokes — UI-UX §8, PRD §6.7.
//
// The story timeline lists three things and they come from two different
// places. Milestones are DERIVED: the day you started talking, the day a
// stage was reached, written by the nightly tick from facts the product is
// already sure of. These two are not derivable from anything —
//
//   "something that happened that you would want referred back to"
//
// is a judgement, and the only thing in this product that can make it is her.
// So they are control tags, and under LESSONS §21 a tag she can emit is a
// thing she can say she has done: `moment` and `inside_joke` are classified
// in TAG_PROMISES as recording, because that is exactly what they do — they
// write down something that already happened, and promise nothing about the
// future.
//
// THE HARD PART IS NOT THE TABLE, IT IS THE RESTRAINT. A model given a tag
// called `moment` will use it, and a timeline with an entry for every warm
// exchange is not a story, it is a log — and it devalues the entries that
// matter, which is the whole point of the screen. The prompt fragment below
// spends most of its words on when NOT to.
//
// What keeps that honest is not the wording, it is the shape: nothing here
// generates a moment, nothing schedules one, and there is no backfill. If she
// never emits the tag the timeline is milestones, which is what it was.
import type { Capability, CaptureOutcome, CaptureSummary, ExportSlice } from '@lian/domain';
import type { CapabilityPorts, StoryRecord } from '../ports.ts';
import { line } from '../copy.ts';

type StoryPayload = { title?: unknown; note?: unknown; type?: unknown };

/** Her sentence, so it is bounded the way the incognito role is: a title that
 *  is a paragraph is not a title, and the screen renders it as one line. */
const MAX_TITLE = 80;
const MAX_NOTE = 240;

function summaryOf(record: StoryRecord, language: 'en' | 'ar'): CaptureSummary {
  return {
    capability: 'story',
    icon: record.type === 'inside_joke' ? 'i-r-laugh' : 'i-heart',
    line: `${record.title.length > 52 ? `${record.title.slice(0, 51)}…` : record.title} · ${
      record.type === 'inside_joke'
        ? line(language, 'inside joke', 'نكتة بينا')
        : line(language, 'a moment', 'لحظة')
    }`,
    // Not a correction screen: a moment has nothing to correct, it has
    // somewhere to be seen and somewhere to be removed. Both are /story.
    correctionRoute: '/story',
  };
}

export const storyCapability: Capability<CapabilityPorts> = {
  id: 'story',

  tags: [
    {
      name: 'moment', payload: true,
      usage: '{"title":"the day they finally called the bank","note":"They had been putting it off for three weeks."} '
        + '— something that happened between you that is worth referring back to. RARE. Not a nice exchange, not a '
        + 'good conversation: a thing that happened.',
    },
    {
      name: 'inside_joke', payload: true,
      usage: '{"title":"the second alarm","note":"They set two alarms and sleep through both."} — a running joke '
        + 'the two of you now share. RARER. It has to have been repeated before it is one.',
    },
  ],

  /**
   * Most of this is about when not to.
   *
   * A tag she is offered is a tag she will reach for, and the failure mode
   * here is not a wrong entry — it is fifty right-ish ones, which is the same
   * as none. The threshold is stated as a test she can apply in the moment
   * ("would you refer back to this in a month") rather than as an adjective.
   */
  promptFragment(context) {
    return context.language === 'ar'
      ? 'لما يحصل حاجة بينكم تستاهل ترجعوا لها بعدين، سجلها لحظة. النكتة اللي بقت متكررة بينكم تسجلها نكتة. '
        + 'دول نادرين جداً — مش كل كلام حلو لحظة، ولا كل ضحكة نكتة. لو مش هتفتكرها بعد شهر، متسجلهاش.'
      : 'When something happens between you that you would genuinely refer back to in a month, record it as a moment. '
        + 'When a joke has recurred between you enough to be yours, record it as an inside joke. '
        + 'BOTH ARE RARE — most weeks have neither. A warm conversation is not a moment and a single funny line is '
        + 'not an inside joke; a timeline with an entry for every good exchange is worth nothing to them. '
        + 'Never record one on the first day, and never record one to fill a silence.';
  },

  /**
   * Null, always, and on purpose.
   *
   * Everything else in this list tells her where things stand — what is due,
   * what was spent. Feeding the moments back into her context would turn a
   * record of what happened into a prompt to make more of them, which is the
   * failure the fragment above spends its words avoiding. What she remembers
   * about somebody comes from memory; the story screen is for THEM.
   */
  async contextFragment() {
    return null;
  },

  async handle({ context, tag }, ports): Promise<CaptureOutcome> {
    const payload = (tag.payload ?? {}) as StoryPayload;
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (title === '') return { ok: false, reason: 'no title' };
    const note = typeof payload.note === 'string' && payload.note.trim() !== '' ? payload.note.trim() : null;
    // The tag NAME decides the type, never the payload. A model that writes
    // `{"type":"milestone"}` inside a <moment> would otherwise be able to put
    // a derived-looking row on the timeline, and the read side reads `derived`
    // off the dedupe key rather than off the type — but the filter does not.
    const type = tag.name === 'inside_joke' ? 'inside_joke' : 'moment';

    const record = await ports.story.add(context.userId, {
      type,
      title: title.slice(0, MAX_TITLE),
      body: note === null ? null : note.slice(0, MAX_NOTE),
      // The day it happened is today: a moment is recorded as it happens, in
      // the turn it happened in. There is no date in the payload because a
      // backdated moment is a moment somebody would have to have judged
      // earlier, and she was not there.
      occurredAt: new Date(`${context.localDay}T12:00:00Z`),
      originAssistantId: context.assistantId,
    });
    return { ok: true, entityTable: 'story_events', entityId: record.id, summary: summaryOf(record, context.language) };
  },

  async describe({ entityIds, context }, ports) {
    const records = await ports.story.byIds(context.userId, entityIds);
    return Object.fromEntries(records.map((record) => [record.id, summaryOf(record, context.language)]));
  },

  async exportFor(userId, ports): Promise<ExportSlice[]> {
    return [{ name: 'story', rows: await ports.story.all(userId) }];
  },

  async purgeFor(userId, ports) {
    await ports.story.purge(userId);
  },
};
