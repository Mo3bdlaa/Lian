// ==========================================================================
// Control-tag stripping — LESSONS §3.
//
// "Strip them server-side, during streaming, with a tail buffer."
//
// This was fixed three times.  The first two attempts stripped on the client,
// so tags leaked into the visible message whenever the stream chunked
// mid-tag.  A tail buffer holds back the last N characters until they can be
// resolved as tag or text.
//
//   - Never strip on the client.  What crosses the wire is already clean.
//   - Never assume a tag arrives inside a single chunk.  A chunk boundary can
//     fall anywhere, including between the '<' and the '/' of a closing tag.
//   - The parser accepts only the tags the assembled prompt offered this
//     turn, so the contract and the parser cannot drift.
//
// Wire format is `<name>{json}</name>`, or `<name/>` for a tag with no
// payload.  JSON inside the tag rather than attributes: attribute escaping
// across a chunk boundary is the fragile version of this problem.
// ==========================================================================

export type TagSpec = {
  /** Bare name, no angle brackets: 'spend', 'todo', 'note'. */
  readonly name: string;
  /** Whether the tag carries a JSON payload. */
  readonly payload: boolean;
};

export type StreamEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tag'; readonly name: string; readonly index: number; readonly payload: unknown }
  /** A tag that arrived malformed.  Surfaced rather than swallowed, because a
   *  capture that silently did not happen is worse than one that reports. */
  | { readonly type: 'tag_error'; readonly name: string; readonly index: number; readonly raw: string; readonly reason: string };

type State = 'text' | 'maybe_open' | 'in_tag';

export class TagStream {
  readonly #specs: Map<string, TagSpec>;
  readonly #maxOpenLength: number;
  #state: State = 'text';
  #buffer = '';       // held-back text that may yet be part of a tag
  #tagName = '';
  #tagBody = '';
  #tagIndex = 0;

  constructor(specs: readonly TagSpec[]) {
    this.#specs = new Map(specs.map((s) => [s.name, s]));
    // The longest thing we might have to hold before deciding: `<name>`.
    this.#maxOpenLength = specs.reduce((max, s) => Math.max(max, s.name.length + 2), 1);
  }

  /** Feed one chunk.  Returns only what is safe to send, in feed order. */
  push(chunk: string): StreamEvent[] {
    const events: StreamEvent[] = [];
    let text = '';
    // Text is flushed immediately before any tag event, so a chunk carrying
    // "…logged it. <spend>{…}</spend> Anything else?" emits text, tag, text —
    // in that order, not all the prose first.
    const emitText = () => {
      if (text !== '') { events.push({ type: 'text', text }); text = ''; }
    };

    for (const char of chunk) {
      switch (this.#state) {
        case 'text': {
          if (char === '<') {
            this.#state = 'maybe_open';
            this.#buffer = '<';
          } else {
            text += char;
          }
          break;
        }

        case 'maybe_open': {
          this.#buffer += char;
          const inner = this.#buffer.slice(1);

          if (char === '>') {
            const selfClosing = inner.endsWith('/>');
            const name = selfClosing ? inner.slice(0, -2) : inner.slice(0, -1);
            const spec = this.#specs.get(name);
            if (spec === undefined) {
              // Not one of ours — it is prose.  '<' is a legal character.
              text += this.#buffer;
              this.#reset();
            } else if (selfClosing || !spec.payload) {
              emitText();
              events.push({ type: 'tag', name, index: this.#tagIndex++, payload: null });
              this.#reset();
            } else {
              this.#state = 'in_tag';
              this.#tagName = name;
              this.#tagBody = '';
              this.#buffer = '';
            }
            break;
          }

          // Still a possible tag opening?  Held back if any known name starts
          // this way.  This is the tail buffer: nothing here has been sent.
          if (!this.#couldOpen(inner)) {
            text += this.#buffer;
            this.#reset();
          }
          break;
        }

        case 'in_tag': {
          this.#tagBody += char;
          const closing = `</${this.#tagName}>`;
          if (this.#tagBody.endsWith(closing)) {
            const raw = this.#tagBody.slice(0, -closing.length);
            emitText();
            events.push(this.#finishTag(raw));
            this.#reset();
          }
          break;
        }
      }
    }

    emitText();
    return events;
  }

  /**
   * End of stream.  Anything still held back is resolved: partial prose is
   * emitted, a partial TAG is not.  A half-written `<spend>{"amount"` is
   * machine syntax, not something she said — leaking it is the exact failure
   * §3 describes.  It is reported as a tag_error so the turn can tell the
   * user the capture did not happen, rather than pretending it did.
   */
  flush(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.#state === 'maybe_open') {
      // '<' that never became a tag is ordinary text.
      events.push({ type: 'text', text: this.#buffer });
    } else if (this.#state === 'in_tag') {
      events.push({
        type: 'tag_error', name: this.#tagName, index: this.#tagIndex++,
        raw: this.#tagBody, reason: 'stream ended before the tag closed',
      });
    }
    this.#reset();
    return events;
  }

  #finishTag(raw: string): StreamEvent {
    const index = this.#tagIndex++;
    const name = this.#tagName;
    try {
      return { type: 'tag', name, index, payload: JSON.parse(raw.trim()) as unknown };
    } catch {
      return { type: 'tag_error', name, index, raw, reason: 'payload is not valid JSON' };
    }
  }

  #couldOpen(inner: string): boolean {
    const bare = inner.endsWith('/') ? inner.slice(0, -1) : inner;
    for (const name of this.#specs.keys()) if (name.startsWith(bare)) return true;
    return false;
  }

  #reset(): void {
    this.#state = 'text';
    this.#buffer = '';
    this.#tagName = '';
    this.#tagBody = '';
  }

  /** How many characters are currently held back — the tail buffer's depth. */
  get held(): number {
    return this.#state === 'text' ? 0 : this.#buffer.length + this.#tagBody.length;
  }

  get maxHold(): number {
    return this.#maxOpenLength;
  }
}

/** Convenience for non-streaming callers and for tests. */
export function parseAll(specs: readonly TagSpec[], chunks: readonly string[]): { text: string; events: StreamEvent[] } {
  const stream = new TagStream(specs);
  const events: StreamEvent[] = [];
  for (const chunk of chunks) events.push(...stream.push(chunk));
  events.push(...stream.flush());
  return { text: events.filter((e) => e.type === 'text').map((e) => e.text).join(''), events };
}
