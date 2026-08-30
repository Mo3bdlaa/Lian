// The object store, as a port.
//
// Two implementations ship: one that speaks to an S3-compatible service, and
// one that keeps bytes in a Map. The second is not a mock — it is what a
// developer runs, and what every test runs, so the product does not need a
// bucket to be worked on.
//
// What the port deliberately does NOT have: a list operation. The database is
// the index of what exists (attachments rows carry the key), so deleting an
// account deletes objects by key rather than by walking a prefix and hoping.
// LESSONS §11: deletion is real, and "real" cannot depend on a listing that
// may be eventually consistent.
export type StoredObject = { readonly bytes: Uint8Array; readonly contentType: string };

export type ObjectStore = {
  readonly id: string;
  /** A URL the browser can PUT to directly. The bytes never touch the app. */
  presignPut(input: { key: string; contentType: string; expiresIn: number }): Promise<{ url: string; method: 'PUT'; headers: Record<string, string> }>;
  /** A URL the browser can GET from directly, short-lived. */
  presignGet(input: { key: string; expiresIn: number; filename?: string; contentType?: string }): Promise<string>;
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<{ bytes: number; contentType: string } | null>;
  /** Returns how many were actually removed. */
  remove(keys: readonly string[]): Promise<number>;
};

/** In-process. Development, tests, and any deployment that has not been given
 *  a bucket — where it is honest rather than convenient: the objects live as
 *  long as the process does, and the config says so at boot. */
export function memoryStore(options: { baseUrl?: string } = {}): ObjectStore & { size(): number; list(prefix: string): Promise<string[]> } {
  const objects = new Map<string, StoredObject>();
  const base = options.baseUrl ?? 'memory://objects';
  return {
    id: 'memory',
    size: () => objects.size,
    // BEYOND the port, like `size()`, and for the same reason the port has no
    // `list`: the database is the index of what exists. Backups are the one
    // thing with no database row — they have to survive the database — so
    // they list, and the s3 store grows the same method. Nothing else uses it.
    async list(prefix: string) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    async presignPut({ key }) {
      return { url: `${base}/${encodeURIComponent(key)}`, method: 'PUT', headers: {} };
    },
    async presignGet({ key }) {
      return `${base}/${encodeURIComponent(key)}`;
    },
    async put({ key, bytes, contentType }) {
      objects.set(key, { bytes, contentType });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async head(key) {
      const object = objects.get(key);
      return object === undefined ? null : { bytes: object.bytes.byteLength, contentType: object.contentType };
    },
    async remove(keys) {
      let removed = 0;
      for (const key of keys) if (objects.delete(key)) removed += 1;
      return removed;
    },
  };
}
