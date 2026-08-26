// Parsing what a model returns when it was asked for JSON.
//
// Q17: no tool-calling is assumed, so structured output arrives as text and
// has to survive a model that wrapped it in a code fence, prefixed it with
// "Here is the JSON:", or returned a single object where an array was asked
// for.  A parser that throws on any of those turns a recoverable turn into a
// lost one.
//
// It is tolerant about SHAPE and strict about CONTENT: anything that does not
// validate is dropped with a reason, never coerced into something plausible.
export type ParseResult<T> = { readonly values: T[]; readonly rejected: { readonly raw: unknown; readonly reason: string }[] };

/** Pull the first JSON array or object out of a model's text. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const attempts = [trimmed];

  const firstArray = trimmed.indexOf('[');
  const lastArray = trimmed.lastIndexOf(']');
  if (firstArray !== -1 && lastArray > firstArray) attempts.push(trimmed.slice(firstArray, lastArray + 1));

  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject !== -1 && lastObject > firstObject) attempts.push(trimmed.slice(firstObject, lastObject + 1));

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

/** Validate each element, keeping what passes and recording what did not. */
export function parseArray<T>(text: string, validate: (value: unknown) => T | string): ParseResult<T> {
  const parsed = extractJson(text);
  if (parsed === null) return { values: [], rejected: [{ raw: text.slice(0, 120), reason: 'no JSON found' }] };

  // A model asked for an array sometimes returns the single element.
  const elements = Array.isArray(parsed) ? parsed : [parsed];
  const values: T[] = [];
  const rejected: { raw: unknown; reason: string }[] = [];

  for (const element of elements) {
    const result = validate(element);
    if (typeof result === 'string') rejected.push({ raw: element, reason: result });
    else values.push(result);
  }
  return { values, rejected };
}
