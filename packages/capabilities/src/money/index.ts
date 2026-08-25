// Money.
//
// PRD §6.5: money in, money out, what's left; top categories; her
// observation; recent transactions.  No budgets, no bars, no pie charts, no
// red/green semantics, no add button — so this capability has exactly one
// write path too, and it is a tag in her reply or a photographed receipt.
import type { Capability, CaptureOutcome, ExportSlice } from '@lian/domain';
import type { CapabilityPorts } from '../ports.ts';
import { line } from '../copy.ts';

type SpendPayload = { amount?: unknown; currency?: unknown; category?: unknown; date?: unknown; note?: unknown; direction?: unknown };

/** Minor units.  Money is integers; a float here is a rounding bug later. */
function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

function formatMinor(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2).replace(/\.00$/, '')}`;
}

export const moneyCapability: Capability<CapabilityPorts> = {
  id: 'money',

  tags: [
    {
      name: 'spend', payload: true,
      usage: '{"amount":400,"currency":"AED","category":"gym","date":"2026-05-18"} — an amount they told you about. Use "direction":"in" for money they received.',
    },
  ],

  promptFragment(context) {
    return context.language === 'ar'
      ? 'تسجيل المصروف لما يتقال، أو من صورة إيصال.'
      : 'Note what they spend when they mention it, or from a receipt photo.';
  },

  async contextFragment(context, ports) {
    const month = context.localDay.slice(0, 7);
    const summary = await ports.money.monthSummary(context.userId, month);
    if (summary.inMinor === 0 && summary.outMinor === 0) return null;
    const currency = 'AED';
    return line(
      context.language,
      `This month: ${formatMinor(summary.inMinor, currency)} in, ${formatMinor(summary.outMinor, currency)} out.`,
      `الشهر ده: ${formatMinor(summary.inMinor, currency)} داخل، ${formatMinor(summary.outMinor, currency)} خارج.`,
    );
  },

  async handle({ context, tag, messageId }, ports): Promise<CaptureOutcome> {
    const payload = (tag.payload ?? {}) as SpendPayload;
    const amount = typeof payload.amount === 'number' ? payload.amount : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'no usable amount' };
    const currency = typeof payload.currency === 'string' && payload.currency.length === 3 ? payload.currency.toUpperCase() : 'AED';
    const occurredOn = typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : context.localDay;
    const direction = payload.direction === 'in' ? 'in' : 'out';

    const transaction = await ports.money.create(context.userId, {
      direction, amountMinor: toMinor(amount), currency,
      category: typeof payload.category === 'string' ? payload.category : null,
      occurredOn, note: typeof payload.note === 'string' ? payload.note : null,
      originMessageId: messageId, originAssistantId: context.assistantId,
    });

    const parts = [formatMinor(transaction.amountMinor, currency)];
    if (transaction.category !== null) parts.push(transaction.category);
    parts.push(occurredOn === context.localDay ? line(context.language, 'Today', 'النهاردة') : occurredOn);

    return {
      ok: true, entityTable: 'transactions', entityId: transaction.id,
      summary: { capability: 'money', icon: 'i-money', line: parts.join(' · '), correctionRoute: `/money/${transaction.id}` },
    };
  },

  async exportFor(userId, ports): Promise<ExportSlice[]> {
    return [{ name: 'transactions', rows: await ports.money.all(userId) }];
  },

  async purgeFor(userId, ports): Promise<void> {
    await ports.money.purge(userId);
  },
};
