// Export and deletion — LESSONS §11.
//
// "The product is sold on ownership. Anything that contradicts it in code
// contradicts it in fact."  Two operations, and both are user-facing features
// rather than support requests (PRD §6.10):
//
//   exportEverything   every row that is theirs, in one machine-readable file
//   deleteEverything   all of it gone, for real
//
// The shape here is deliberate: both walk the capability REGISTRY rather than
// a list of tables, so a capability added next month is exported and deleted
// without either function being edited. A list is a promise that goes stale
// silently, and this is the promise that must not.
import { exportAll, purgeAll, type CapabilityPorts } from '@lian/capabilities';
import type { ExportSlice } from '@lian/domain';

export type OwnershipPorts = {
  /** Assistant-scoped data: memory, canon, conversations, story, reflections. */
  assistantSlices(userId: string): Promise<ExportSlice[]>;
  /** User-scoped data that no capability owns: the account, the profile,
   *  devices, subscriptions, attachments. */
  accountSlices(userId: string): Promise<ExportSlice[]>;
  /** Deletes the user row. Every scoped table cascades from it, which is why
   *  the schema uses ON DELETE CASCADE everywhere rather than soft flags. */
  deleteAccount(userId: string): Promise<void>;
  /** Storage objects — audio, images, receipts — which no cascade reaches. */
  deleteStoredFiles(userId: string): Promise<number>;
  recordEvent(input: { name: 'export_requested' | 'account_deleted'; userId: string; dayKey: string }): Promise<void>;
};

export type ExportArchive = {
  readonly exportedAt: string;
  readonly userId: string;
  /** What the export contains, named, so the Data screen can list it
   *  (UI-UX §17) without a second list to keep in sync. */
  readonly contents: readonly { readonly name: string; readonly rows: number }[];
  readonly slices: readonly ExportSlice[];
};

export async function exportEverything(
  input: { userId: string; localDay: string; now: Date },
  ports: OwnershipPorts & { capabilities: CapabilityPorts },
): Promise<ExportArchive> {
  const slices = [
    ...(await ports.accountSlices(input.userId)),
    ...(await ports.assistantSlices(input.userId)),
    // The registry, not a list.
    ...(await exportAll(input.userId, ports.capabilities)),
  ];
  await ports.recordEvent({ name: 'export_requested', userId: input.userId, dayKey: input.localDay });
  return {
    exportedAt: input.now.toISOString(),
    userId: input.userId,
    contents: slices.map((slice) => ({ name: slice.name, rows: slice.rows.length })),
    slices,
  };
}

/** The downloadable file (PRD §6.10). JSON because it is the format a person
 *  can actually open and a script can actually read; a proprietary archive
 *  would technically satisfy "machine-readable" and defeat the point. */
export function serializeArchive(archive: ExportArchive): string {
  return JSON.stringify(archive, null, 2);
}

export type DeletionReport = {
  readonly capabilitiesPurged: number;
  readonly filesDeleted: number;
  readonly accountDeleted: boolean;
};

/**
 * Delete everything.
 *
 * Order matters and is not arbitrary: capability rows first (they own their
 * own tables and may hold references), then stored files (nothing cascades to
 * object storage), then the account (which cascades through every scoped
 * table). Doing the account first would orphan the files with no user left to
 * find them by.
 */
export async function deleteEverything(
  input: { userId: string; localDay: string },
  ports: OwnershipPorts & { capabilities: CapabilityPorts },
): Promise<DeletionReport> {
  await purgeAll(input.userId, ports.capabilities);
  const filesDeleted = await ports.deleteStoredFiles(input.userId);

  // Recorded BEFORE the account row goes, because the event references it.
  await ports.recordEvent({ name: 'account_deleted', userId: input.userId, dayKey: input.localDay });
  await ports.deleteAccount(input.userId);

  return { capabilitiesPurged: 1, filesDeleted, accountDeleted: true };
}
