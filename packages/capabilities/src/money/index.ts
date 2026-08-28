// Money.
//
// PRD §6.5: money in, money out, what's left; top categories; her
// observation; recent transactions.  No budgets, no bars, no pie charts, no
// red/green semantics, no add button — so this capability has exactly one
// write path too, and it is a tag in her reply or a photographed receipt.
import { DEFAULT_CURRENCY } from '@lian/domain';
import type { Capability, CaptureOutcome, ExportSlice } from '@lian/domain';
import type { CapabilityPorts } from '../ports.ts';
import { line } from '../copy.ts';
import { relativeDay, formatMoney } from '@lian/i18n';

type SpendPayload = { amount?: unknown; currency?: unknown; category?: unknown; date?: unknown; note?: unknown; direction?: unknown };

/** Minor units.  Money is integers; a float here is a rounding bug later. */
function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * An amount for the MODEL, in the environment block — not for a person.
 *
 * Fixed representation on purpose, the same way the day key and the local
 * hour are: it is read by the thing that writes her reply, and a Latin-digit
 * `AED 400` is what that reads most reliably. The reader-facing amount is
 * `formatMoney` from @lian/i18n, and there is exactly one of those.
 */
function forTheModel(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2).replace(/\.00$/, '')}`;
}

type TransactionLike = { id: string; amountMinor: number; currency: string; category: string | null; occurredOn: string };

/**
 * The day, as a person reads it.
 *
 * `Today`, `Yesterday`, or a date — and the DATE comes from @lian/i18n, which
 * is the one place that formats for a reader. This function used to render
 * the raw column for anything not today, so a chip read `2026-08-24` three
 * lines under a separator saying "25 August". The words stay here because
 * they are copy; the formatting does not, because it was the second copy of
 * something the client already had.
 */
function dayLabel(occurredOn: string, localDay: string, language: 'en' | 'ar'): string {
  const when = relativeDay(occurredOn, localDay, language);
  if ('date' in when) return when.date;
  return when.key === 'today'
    ? line(language, 'Today', 'النهاردة')
    : line(language, 'Yesterday', 'إمبارح');
}

function summaryOf(transaction: TransactionLike, language: 'en' | 'ar', localDay: string) {
  // Through @lian/i18n, like every other amount a person reads. This was
  // `AED 400` in Latin digits INSIDE AN ARABIC CHIP — three lines under a
  // bubble that said ٤٠٠ درهم and beside a date in Eastern numerals — because
  // the chip had its own formatter. Found by looking at the Arabic
  // screenshot; invisible to the formatting gate, which watched for a second
  // `Intl` call and this one used none.
  const parts = [formatMoney(transaction.amountMinor, transaction.currency, language)];
  if (transaction.category !== null) parts.push(transaction.category);
  parts.push(dayLabel(transaction.occurredOn, localDay, language));
  return { capability: 'money', icon: 'i-money', line: parts.join(' · '), correctionRoute: `/money/${transaction.id}` };
}

/**
 * One observation in her voice (UI-UX §7, PRD §6.5), from what is there.
 *
 * The same instrument as the health week's `observe()` and for the same
 * reason: **arithmetic, or nothing**. A model asked to comment on somebody's
 * spending will produce a sentence that sounds insightful and is not checkable
 * — and this screen already carries their real money, where a confident wrong
 * sentence is worse than a blank space. Every branch here is a statement about
 * rows that exist, and each one is true by construction.
 *
 * It is also what makes the screen photographable and free: no call, no
 * latency, and the same figures produce the same sentence every time.
 *
 * NULL IS A REAL ANSWER, and the common one early. Three transactions is the
 * floor because two points are not a pattern — the health week draws its line
 * at two workouts for the same reason, and saying nothing is what she does
 * when there is nothing to say.
 *
 * THE FLOOR IS ON THE INFERENCES, NOT ON THE ARITHMETIC. "Most of what went
 * out was rent" is a claim about a pattern and needs points to stand on.
 * "Nothing has come in yet" is not a claim about anything — it is a statement
 * that a column is empty, it is true with ONE transaction, and it is the only
 * line on that screen that explains why the big number is negative.
 *
 * Gating it behind three transactions meant the explanation was missing on
 * exactly the days the number is most alarming: somebody's first two. Found
 * by using the product on day one, where AED 6,900 out and nothing in
 * rendered as a bare negative with nothing underneath it.
 */
export function observe(
  summary: { inMinor: number; outMinor: number; leftMinor: number; topCategories: readonly { category: string; totalMinor: number }[] },
  transactionsThisMonth: number,
  currency: string,
  language: 'en' | 'ar',
): string | null {
  // Nothing in yet. FIRST, and ABOVE THE FLOOR, because it is the one that
  // explains the rest of the screen: without it, "what's left" is a negative
  // number with no account of why, which is what the headline was already
  // changed to avoid. See the note above on why this branch is not gated.
  if (summary.inMinor === 0 && summary.outMinor > 0) {
    return line(
      language,
      'Nothing has come in this month yet, so this is only what has gone out.',
      'لسه مفيش حاجة داخلة الشهر ده، فده اللي خرج بس.',
    );
  }

  // Everything below this line is an INFERENCE and needs points to stand on.
  if (transactionsThisMonth < 3) return null;

  // One category carrying most of the month. The share is the observation —
  // the amount is already on the screen above it, twice.
  const top = summary.topCategories[0];
  if (top !== undefined && summary.outMinor > 0 && top.totalMinor * 2 >= summary.outMinor) {
    return line(
      language,
      `Most of what went out this month was ${top.category}.`,
      `أغلب اللي خرج الشهر ده كان ${top.category}.`,
    );
  }

  // Kept more than half of what came in. Only when something came in, or the
  // ratio is a division by nothing dressed up as a finding.
  if (summary.inMinor > 0 && summary.leftMinor * 2 >= summary.inMinor) {
    return line(
      language,
      `You have kept more than half of what came in — ${formatMoney(summary.leftMinor, currency, language)} of it.`,
      `احتفظت بأكتر من نص اللي دخل — ${formatMoney(summary.leftMinor, currency, language)} منه.`,
    );
  }

  // Out is ahead of in. Stated as the arithmetic, never as advice: PRD §6.5
  // has no budgets and no warnings, and "you are overspending" is both.
  if (summary.inMinor > 0 && summary.outMinor > summary.inMinor) {
    return line(
      language,
      'More has gone out than came in this month.',
      'اللي خرج الشهر ده أكتر من اللي دخل.',
    );
  }

  return null;
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
    const currency = DEFAULT_CURRENCY;
    return line(
      context.language,
      `This month: ${forTheModel(summary.inMinor, currency)} in, ${forTheModel(summary.outMinor, currency)} out.`,
      `الشهر ده: ${forTheModel(summary.inMinor, currency)} داخل، ${forTheModel(summary.outMinor, currency)} خارج.`,
    );
  },

  async handle({ context, tag, messageId }, ports): Promise<CaptureOutcome> {
    const payload = (tag.payload ?? {}) as SpendPayload;
    const amount = typeof payload.amount === 'number' ? payload.amount : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'no usable amount' };
    const currency = typeof payload.currency === 'string' && payload.currency.length === 3 ? payload.currency.toUpperCase() : DEFAULT_CURRENCY;
    const occurredOn = typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : context.localDay;
    const direction = payload.direction === 'in' ? 'in' : 'out';

    const transaction = await ports.money.create(context.userId, {
      direction, amountMinor: toMinor(amount), currency,
      category: typeof payload.category === 'string' ? payload.category : null,
      occurredOn, note: typeof payload.note === 'string' ? payload.note : null,
      originMessageId: messageId, originAssistantId: context.assistantId,
    });

    return {
      ok: true, entityTable: 'transactions', entityId: transaction.id,
      summary: summaryOf(transaction, context.language, context.localDay),
    };
  },

  async describe({ entityIds, context }, ports) {
    const rows = await ports.money.byIds(context.userId, entityIds);
    // Read back in the language they are reading NOW: "Today" is a word, and
    // a row captured in Arabic and reopened in English should not say النهاردة.
    return Object.fromEntries(rows.map((row) => [row.id, summaryOf(row, context.language, context.localDay)]));
  },

  async exportFor(userId, ports): Promise<ExportSlice[]> {
    return [{ name: 'transactions', rows: await ports.money.all(userId) }];
  },

  async purgeFor(userId, ports): Promise<void> {
    await ports.money.purge(userId);
  },
};
