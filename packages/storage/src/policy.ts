// What may be stored, how large, and where it goes.
//
// Kept out of the HTTP layer on purpose: "an audio note may be ten megabytes"
// is a product rule, and the route should ask rather than decide.
export type AttachmentKind = 'image' | 'audio' | 'receipt';

/**
 * Per-object ceilings.
 *
 * ASSUMPTIONS, both of them sized against the thing rather than measured: a
 * photographed receipt from a phone camera is 2–5 MB, and a five-minute voice
 * note (MAX_VOICE_NOTE_SECONDS) in Opus at 32 kbit/s is about 1.2 MB. The
 * limits are roughly double each, so an unusual file is accepted and a
 * runaway one is not.
 */
export const MAX_ATTACHMENT_BYTES: Readonly<Record<AttachmentKind, number>> = {
  image: 8 * 1024 * 1024,
  receipt: 8 * 1024 * 1024,
  audio: 10 * 1024 * 1024,
};

/** Content types accepted per kind. A type not on this list is refused before
 *  a URL is signed — an upload URL is a capability, and it should only ever
 *  be issued for something the product can actually read. */
export const ACCEPTED: Readonly<Record<AttachmentKind, readonly string[]>> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  receipt: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  audio: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac'],
};

export function kindOf(value: string): AttachmentKind | null {
  return value === 'image' || value === 'audio' || value === 'receipt' ? value : null;
}

/**
 * The object key.
 *
 * User-prefixed so a bucket can be read by a human without a join, and
 * attachment-id-suffixed so nothing collides. The database still holds the
 * index — this shape is for the person looking at a bucket, not for deletion.
 */
export function attachmentKey(input: { userId: string; kind: AttachmentKind; attachmentId: string; extension: string }): string {
  return `u/${input.userId}/${input.kind}/${input.attachmentId}.${input.extension}`;
}
