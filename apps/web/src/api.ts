// The API client.
//
// Three things it owns, because every caller would otherwise get them
// slightly wrong: an idempotency key on every write (the server refuses a
// write without one), the session cookie, and reading the chat stream.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** A key per attempt, stable across retries of THAT attempt — which is what
 *  makes a retry replay the first answer instead of paying twice. */
export function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: 'bad_response', message: text.slice(0, 200) };
  }
}

async function request(method: string, path: string, body?: unknown, key?: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = key ?? newKey();
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await parse(response);
  if (!response.ok) {
    const error = payload as { error?: string; message?: string };
    throw new ApiError(response.status, error.error ?? 'error', error.message ?? 'something went wrong');
  }
  return payload;
}

export const get = <T>(path: string): Promise<T> => request('GET', path) as Promise<T>;
export const post = <T>(path: string, body?: unknown, key?: string): Promise<T> => request('POST', path, body, key) as Promise<T>;
export const patch = <T>(path: string, body?: unknown, key?: string): Promise<T> => request('PATCH', path, body, key) as Promise<T>;
export const remove = <T>(path: string, key?: string): Promise<T> => request('DELETE', path, undefined, key) as Promise<T>;

export type StreamEvent = { event: string; data: Record<string, unknown> };

/**
 * Read a server-sent event stream to its end, calling back per event.
 *
 * Written against the byte stream rather than EventSource because the turn is
 * a POST: EventSource can only GET, and the message has to travel in a body.
 */
export async function stream(
  path: string,
  body: unknown,
  key: string,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!response.ok || response.body === null) {
    const payload = (await parse(response)) as { error?: string; message?: string };
    throw new ApiError(response.status, payload.error ?? 'error', payload.message ?? 'something went wrong');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events are separated by a blank line; a partial event stays in the
    // buffer until the rest of it arrives.
    let split = buffer.indexOf('\n\n');
    while (split !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = parseEvent(chunk);
      if (event !== null) onEvent(event);
      split = buffer.indexOf('\n\n');
    }
  }
}

export function parseEvent(chunk: string): StreamEvent | null {
  let name = 'message';
  const data: string[] = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event: ')) name = line.slice(7).trim();
    else if (line.startsWith('data: ')) data.push(line.slice(6));
  }
  if (data.length === 0) return null;
  try {
    return { event: name, data: JSON.parse(data.join('\n')) as Record<string, unknown> };
  } catch {
    return null;
  }
}
