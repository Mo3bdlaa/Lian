// Notes.
//
// UI-UX §29.2: "No 'create note' form as primary entry. New notes still
// originate from conversation."  So this capability, like the others, has one
// write path and it is a tag in her reply.
//
// The distinction from a task is the one the user actually makes: a task is
// something they will DO, a note is something they want KEPT. The prompt
// fragment says exactly that, because a model given both tags without the
// distinction will use whichever it saw last.
import type { Capability, CaptureOutcome, ExportSlice } from '@lian/domain';
import type { CapabilityPorts } from '../ports.ts';
import { line } from '../copy.ts';

type NotePayload = { body?: unknown; title?: unknown; topic?: unknown };

export const notesCapability: Capability<CapabilityPorts> = {
  id: 'notes',

  tags: [
    {
      name: 'note', payload: true,
      usage: '{"body":"the landlord said the lease renews in March","title":"Lease","topic":"apartment"} — something they want kept but will not DO. If they will do it, it is a todo instead.',
    },
  ],

  promptFragment(context) {
    return context.language === 'ar'
      ? 'الاحتفاظ بالحاجات اللي يهم تفضل مكتوبة — مش المهام، الحاجات اللي محتاجة تتحفظ.'
      : 'Keep things they want written down — not things to do, things to remember verbatim.';
  },

  async contextFragment(context, ports) {
    const recent = await ports.notes.recent(context.userId, 3);
    if (recent.length === 0) return null;
    const titles = recent.map((note) => note.title ?? note.body.slice(0, 40)).join('; ');
    return line(context.language, `Recent notes: ${titles}.`, `آخر الملاحظات: ${titles}.`);
  },

  async handle({ context, tag, messageId }, ports): Promise<CaptureOutcome> {
    const payload = (tag.payload ?? {}) as NotePayload;
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (body.length < 3) return { ok: false, reason: 'nothing to write down' };

    const note = await ports.notes.create(context.userId, {
      body,
      title: typeof payload.title === 'string' && payload.title.trim() !== '' ? payload.title.trim() : null,
      topic: typeof payload.topic === 'string' ? payload.topic : null,
      originMessageId: messageId, originAssistantId: context.assistantId,
    });

    return {
      ok: true, entityTable: 'notes', entityId: note.id,
      summary: {
        capability: 'notes', icon: 'i-note',
        line: note.title ?? (body.length > 48 ? `${body.slice(0, 47)}…` : body),
        correctionRoute: `/notes/${note.id}`,
      },
    };
  },

  async exportFor(userId, ports): Promise<ExportSlice[]> {
    return [{ name: 'notes', rows: await ports.notes.all(userId) }];
  },

  async purgeFor(userId, ports): Promise<void> {
    await ports.notes.purge(userId);
  },
};
