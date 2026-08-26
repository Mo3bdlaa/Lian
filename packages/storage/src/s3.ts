// The S3-compatible store.
//
// Every request is a presigned URL and a fetch. There is no XML parsing, no
// multipart, and no SDK: what this product stores is a photograph or a voice
// note, both of them small and both of them written once.
import { presign, type S3Config } from './sign.ts';
import type { ObjectStore, StoredObject } from './store.ts';

export type S3Options = S3Config & {
  readonly now?: () => Date;
  readonly fetcher?: typeof fetch;
};

/** How long a signed URL lives.
 *
 *  ASSUMPTION, stated because it is a security parameter: fifteen minutes for
 *  an upload (a photo on a slow connection) and five for a download (long
 *  enough to render, short enough that a URL in a log or a screenshot is not
 *  a lasting key). */
export const UPLOAD_URL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_SECONDS = 5 * 60;

export function s3Store(options: S3Options): ObjectStore {
  const now = options.now ?? (() => new Date());
  const call = options.fetcher ?? fetch;

  const url = (method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', key: string, expiresIn: number, extra: { filename?: string; contentType?: string } = {}): string =>
    presign(options, {
      method, key, expiresIn, now: now(),
      ...(extra.filename === undefined ? {} : { responseContentDisposition: `attachment; filename="${extra.filename.replace(/["\\]/g, '')}"` }),
      ...(extra.contentType === undefined ? {} : { responseContentType: extra.contentType }),
    });

  return {
    id: 's3',

    async presignPut({ key, contentType, expiresIn }) {
      return {
        url: url('PUT', key, expiresIn),
        method: 'PUT',
        // Sent by the browser, and NOT signed: signing it would force the
        // client to send exactly this string, and browsers add charset
        // parameters of their own.
        headers: { 'content-type': contentType },
      };
    },

    async presignGet({ key, expiresIn, filename, contentType }) {
      return url('GET', key, expiresIn, { ...(filename === undefined ? {} : { filename }), ...(contentType === undefined ? {} : { contentType }) });
    },

    async put({ key, bytes, contentType }) {
      const response = await call(url('PUT', key, UPLOAD_URL_SECONDS), {
        method: 'PUT', body: bytes, headers: { 'content-type': contentType },
      });
      if (!response.ok) throw new Error(`storage refused the write: ${response.status}`);
    },

    async get(key): Promise<StoredObject | null> {
      const response = await call(url('GET', key, DOWNLOAD_URL_SECONDS));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`storage refused the read: ${response.status}`);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      };
    },

    async head(key) {
      const response = await call(url('HEAD', key, DOWNLOAD_URL_SECONDS), { method: 'HEAD' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`storage refused the head: ${response.status}`);
      return {
        bytes: Number(response.headers.get('content-length') ?? '0'),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      };
    },

    async remove(keys) {
      let removed = 0;
      for (const key of keys) {
        const response = await call(url('DELETE', key, DOWNLOAD_URL_SECONDS), { method: 'DELETE' });
        // S3 returns 204 for a delete whether or not the object was there.
        // A 404 is equally fine: the object is gone, which is the point.
        if (response.ok || response.status === 404) removed += 1;
        else throw new Error(`storage refused the delete: ${response.status}`);
      }
      return removed;
    },
  };
}
