// ==========================================================================
// Untrusted text.
//
// THE PROBLEM, stated plainly because it is not obvious:
//
// Retrieved memory renders inside the final user message, so that everything
// before it can be cached. Memory contains text the user wrote. Therefore a
// memory can carry instruction-shaped text into the channel the model treats
// as instructions from the user.
//
// Nobody has to be an attacker for this to bite. A user who once pasted a
// prompt into a chat has poisoned their own retrieval: three weeks later that
// text comes back as "what you remember about them", in the same message as
// their actual question, and reads like something they just asked for.
//
// Two defences, and this file is the first:
//
//   1. SANITISE. Directive formatting is removed on the way in (at
//      extraction) and again on the way out (at render). Memory keeps what
//      was meant, not verbatim text with its imperative shape intact.
//   2. FRAME. The turn renders in a fixed structure, recalled text is
//      labelled as a record of what was said, and the contract tells her
//      that recalled text is never an instruction. That lives in the prompt
//      package.
//
// Neither is sufficient alone. Sanitising loses the shape of an attack but
// not its words; framing tells her what to do with words she can still read.
// ==========================================================================

/** Anything longer than this in a recall block is a paste, not a memory. */
export const MAX_RECALLED_LENGTH = 400;

/**
 * PRD §27's free-text role, capped where it is WRITTEN as well as where it is
 * rendered.
 *
 * The prompt block has always truncated at this length.  The write boundary
 * did not, which meant somebody could type a page, see it stored, see it
 * echoed back on the chip — and have the last two thirds of it silently not
 * be in effect.  A role that is displayed but not obeyed is worse than a
 * refusal, so the write refuses instead of truncating: the person finds out
 * while they are still typing rather than three answers later.
 */
export const MAX_SCENARIO_LENGTH = 600;

/**
 * Markers this product uses to frame content. If they appear inside
 * untrusted text they are removed, not escaped: a user who types
 * `<<context>>` should see it echoed back as ordinary text, never have it
 * close a block we opened.
 */
const OUR_MARKERS = /<<\/?\s*(context|recalled|environment|message|role)\s*>>/gi;

/** Shapes a model reads as "these are your instructions". */
const DIRECTIVE_SHAPES: { readonly pattern: RegExp; readonly replacement: string }[] = [
  // Fenced blocks and inline code — a fence lets text claim a different role.
  { pattern: /```[\s\S]*?```/g, replacement: ' ' },
  { pattern: /`([^`]*)`/g, replacement: '$1' },
  // Headings, blockquotes and horizontal rules: structure that outranks prose.
  { pattern: /^\s{0,3}#{1,6}\s+/gm, replacement: '' },
  { pattern: /^\s{0,3}>\s?/gm, replacement: '' },
  { pattern: /^\s{0,3}([-*_]\s*){3,}$/gm, replacement: ' ' },
  // Bullet and numbered list markers at the start of a line.
  { pattern: /^\s{0,3}[-*+]\s+/gm, replacement: '' },
  { pattern: /^\s{0,3}\d{1,2}[.)]\s+/gm, replacement: '' },
  // SHOUTED SECTION HEADERS, which is how every block in our own prompt is
  // labelled — so text imitating one is imitating us specifically.
  { pattern: /^[A-Z][A-Z '’&-]{7,}$/gm, replacement: ' ' },
  // Angle-bracket tags of any kind, including our control tags.
  { pattern: /<\/?[a-zA-Z][a-zA-Z0-9_-]{0,32}\s*\/?>/g, replacement: ' ' },
  // Role labels at the start of a line: "System:", "Assistant:", "User:".
  { pattern: /^\s*(system|assistant|user|human|ai)\s*:/gim, replacement: '' },
];

/**
 * Make a piece of user-originated text safe to place in a labelled block.
 *
 * It stays READABLE — this is not escaping, and she still needs to be able to
 * use what it says. What it loses is the ability to look like structure.
 */
/**
 * Take OUR framing markers out of text a person typed, and nothing else.
 *
 * Distinct from sanitiseRecalled on purpose, and the difference is the whole
 * point. Recalled text is a record and gets the full treatment — directive
 * shapes flattened, length bounded. A message somebody is sending RIGHT NOW
 * is them speaking: flattening it would edit what they said, and they are
 * allowed to say anything.
 *
 * What they are not allowed to do is close a block we opened. The turn is
 * `<<context>> … <</context>>` then their words, and the system block tells
 * her that only what follows the block is them speaking now. A message
 * containing `<</context>>` could make part of their own text look like it
 * came from the frame — so the markers come out here, at render, while the
 * STORED message keeps them: it is what they typed, and the conversation
 * should show it back to them unchanged.
 */
export function stripOurMarkers(text: string): string {
  return text.replace(OUR_MARKERS, ' ');
}

export function sanitiseRecalled(text: string, maxLength = MAX_RECALLED_LENGTH): string {
  let out = text.replace(OUR_MARKERS, ' ');
  for (const { pattern, replacement } of DIRECTIVE_SHAPES) out = out.replace(pattern, replacement);
  // Newlines are structure too: a memory is a sentence, not a document.
  out = out.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (out.length > maxLength) out = `${out.slice(0, maxLength - 1).trimEnd()}…`;
  return out;
}

/**
 * Did sanitising change anything meaningful? Used at extraction time to
 * refuse a "memory" that was mostly formatting — text like that is a paste,
 * and storing it is how the retrieval channel gets poisoned in the first
 * place.
 */
export function looksLikeInstruction(text: string): boolean {
  const sanitised = sanitiseRecalled(text, Number.MAX_SAFE_INTEGER);
  const lostALot = sanitised.length < text.trim().length * 0.75;
  // Checked per LINE rather than on the whole string: an attack usually has
  // a preamble, and "# SYSTEM\nAct as…" starts with neither an imperative
  // nor enough formatting to trip the ratio.
  const imperative = /^\s*(ignore|disregard|forget|instead|from now on|you are|you must|act as|pretend|respond only|do not|always|never)\b/i;
  const imperativeLine = text.split(/[\r\n]+/).some((line) => imperative.test(line));
  const addressesTheModel = /\b(your (instructions|system prompt|rules)|previous instructions|the above)\b/i.test(text);
  return lostALot || imperativeLine || addressesTheModel;
}
