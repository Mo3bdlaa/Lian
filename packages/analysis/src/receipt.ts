// Reading a photographed receipt.
//
// The path, end to end, and why it has this shape:
//
//   photo → object storage → THIS FUNCTION → five validated fields →
//   one line WE composed → her turn → she emits <spend> → money capability
//
// The image never touches the channel she speaks in.  That is LESSONS §1a
// ("channels are trust boundaries") applied to the most untrusted input in
// the product: a photograph of a piece of paper, which anyone can write
// anything on.  A model that is shown that picture on the voice path would be
// reading attacker-controlled text with her persona loaded.  Here, the only
// thing that can get out is a number, a currency, a date, a shop name and one
// word from a closed list — everything else has no field to travel in.
//
// Capture still happens through her <spend> tag, so there is exactly one
// write path into money (the money capability's own rule), and a receipt she
// misread is corrected the same way any other capture is.
import { RECEIPT_READING_SYSTEM } from './prompts.ts';
import { extractJson } from './json.ts';
import { sanitiseRecalled, looksLikeInstruction } from '@lian/domain';
import type { AnalysisModel } from './extract.ts';

export type ReceiptReading = {
  readonly amountMinor: number;
  readonly currency: string;
  /** YYYY-MM-DD, or null when the receipt did not print one. */
  readonly occurredOn: string | null;
  readonly merchant: string | null;
  readonly category: ReceiptCategory | null;
};

/**
 * The closed vocabulary.
 *
 * Deliberately closed rather than free text: a category is the one field
 * where arbitrary words off the photograph could otherwise reach her, and
 * "groceries" is worth exactly as much as whatever the model would have
 * written instead.
 */
export const RECEIPT_CATEGORIES = [
  'groceries', 'fuel', 'pharmacy', 'restaurant', 'transport', 'clothing', 'home', 'other',
] as const;
export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

/**
 * The largest total that is read as a total.
 *
 * ASSUMPTION: 100,000.00 in the receipt's own currency. Chosen because the
 * common failure is a misread — a barcode, a loyalty number or a phone
 * number parsed as an amount — and those land orders of magnitude above a
 * shop receipt. It is not a spending limit and nothing enforces it elsewhere;
 * a genuine purchase above it is captured by telling her the number instead.
 */
export const MAX_RECEIPT_MINOR = 100_000 * 100;

/**
 * How far back a printed date may be.
 *
 * ASSUMPTION: 5 years. A receipt older than that is a misread year far more
 * often than it is a real purchase someone is only now capturing; the cost of
 * being wrong is that they say the date instead.
 */
const MAX_RECEIPT_AGE_DAYS = 5 * 365;

const MAX_MERCHANT_LENGTH = 60;

export type ReceiptImage = { readonly contentType: string; readonly base64: string };

/** Why nothing was read, when nothing was. Reported so the UI can say
 *  something specific rather than "that didn't work". */
export type ReceiptFailure =
  | 'no_vision'      // the configured model cannot be shown a picture
  | 'not_a_receipt'  // it looked, and this is not one
  | 'unreadable';    // it looked, and could not get a total off it

export type ReceiptResult =
  | { readonly ok: true; readonly reading: ReceiptReading; readonly usage: { inputTokens: number; outputTokens: number } }
  | { readonly ok: false; readonly reason: ReceiptFailure; readonly usage: { inputTokens: number; outputTokens: number } };

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

function validCategory(value: unknown): ReceiptCategory | null {
  if (typeof value !== 'string') return null;
  const word = value.trim().toLowerCase();
  return (RECEIPT_CATEGORIES as readonly string[]).includes(word) ? (word as ReceiptCategory) : null;
}

function validMerchant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > MAX_MERCHANT_LENGTH) return null;
  // The one free-text field, and it comes off a photograph — so it is held to
  // the same bar as anything else that will be rendered back into a prompt.
  if (looksLikeInstruction(trimmed)) return null;
  const clean = sanitiseRecalled(trimmed, MAX_MERCHANT_LENGTH);
  return clean.length < 2 ? null : clean;
}

function validDate(value: unknown, today: string): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const printed = Date.parse(`${value}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(printed) || Number.isNaN(now)) return null;
  // A receipt cannot be from the future, and a date far in the past is a
  // misread year rather than a purchase.
  if (printed > now) return null;
  if ((now - printed) / 86_400_000 > MAX_RECEIPT_AGE_DAYS) return null;
  return value;
}

/** Minor units. Money is integers everywhere; a float here is a rounding bug
 *  three screens later. */
function toMinor(total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const minor = Math.round(total * 100);
  return minor <= 0 || minor > MAX_RECEIPT_MINOR ? null : minor;
}

/**
 * Read one receipt.
 *
 * Returns a failure rather than throwing, and never a partial reading: a
 * total and a currency are the two fields the money capability cannot work
 * without, so anything less is 'unreadable' and she asks instead of guessing.
 */
export async function readReceipt(
  input: { readonly image: ReceiptImage; readonly today: string; readonly fallbackCurrency: string },
  model: AnalysisModel,
): Promise<ReceiptResult> {
  if (model.completeWithImage === undefined) return { ok: false, reason: 'no_vision', usage: NO_USAGE };

  const { text, usage } = await model.completeWithImage({
    system: RECEIPT_READING_SYSTEM,
    user: 'Read this receipt.',
    image: input.image,
    maxOutputTokens: 200,
  });

  const parsed = extractJson(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'unreadable', usage };
  }
  const record = parsed as Record<string, unknown>;

  const total = record['total'];
  // The prompt returns {"total": null} for a picture that is not a receipt —
  // an explicit answer, distinguished from a total it could not make out.
  if (total === null) return { ok: false, reason: 'not_a_receipt', usage };
  if (typeof total !== 'number') return { ok: false, reason: 'unreadable', usage };

  const amountMinor = toMinor(total);
  if (amountMinor === null) return { ok: false, reason: 'unreadable', usage };

  const rawCurrency = record['currency'];
  const currency =
    typeof rawCurrency === 'string' && /^[A-Za-z]{3}$/.test(rawCurrency.trim())
      ? rawCurrency.trim().toUpperCase()
      : input.fallbackCurrency.toUpperCase();

  return {
    ok: true,
    usage,
    reading: {
      amountMinor,
      currency,
      occurredOn: validDate(record['date'], input.today),
      merchant: validMerchant(record['merchant']),
      category: validCategory(record['category']),
    },
  };
}

/**
 * The reading, as the one sentence she is shown.
 *
 * Composed HERE, out of validated fields, rather than anywhere the model's
 * own words could be substituted for it. This string is the entire surface
 * the photograph gets: five values in a sentence we wrote.
 */
export function describeReading(reading: ReceiptReading): string {
  const amount = `${reading.currency} ${(reading.amountMinor / 100).toFixed(2).replace(/\.00$/, '')}`;
  const parts = [amount];
  if (reading.merchant !== null) parts.push(`at ${reading.merchant}`);
  if (reading.occurredOn !== null) parts.push(`on ${reading.occurredOn}`);
  if (reading.category !== null) parts.push(`(${reading.category})`);
  return parts.join(' ');
}
