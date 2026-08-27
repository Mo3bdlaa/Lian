// The registry.
//
// This array is the ONLY place a capability is named outside its own
// directory.  Six consumers iterate it: prompt assembly, the turn handler,
// the jobs runner, data export, deletion (LESSONS §13 and §11) and the
// screens, which read captured rows back through describe().
//
// Adding a capability is: one directory, one import, one line here.
import { sanitiseRecalled, type Capability, type CapabilityContext, type CaptureSummary, type CapabilityTag, type ExportSlice, type OutreachCandidate } from '@lian/domain';
import type { CapabilityPorts } from './ports.ts';
import { tasksCapability } from './tasks/index.ts';
import { moneyCapability } from './money/index.ts';
import { notesCapability } from './notes/index.ts';
import { healthCapability } from './health/index.ts';
import { storyCapability } from './story/index.ts';
import { identityCapability } from './identity/index.ts';

// Adding a capability is a directory and a line.  These two were the line.
export const REGISTRY: readonly Capability<CapabilityPorts>[] = [
  tasksCapability, moneyCapability, notesCapability, healthCapability, storyCapability, identityCapability,
];

export function capabilityById(id: string): Capability<CapabilityPorts> | undefined {
  return REGISTRY.find((capability) => capability.id === id);
}

/** Which capability owns a given control tag.  Built from the registry, so a
 *  tag the prompt never offered has no owner and cannot be dispatched. */
export function ownerOfTag(tagName: string): Capability<CapabilityPorts> | undefined {
  return REGISTRY.find((capability) => capability.tags.some((tag) => tag.name === tagName));
}

export function allTags(): readonly CapabilityTag[] {
  return REGISTRY.flatMap((capability) => capability.tags);
}

// ── consumer 1: prompt assembly ───────────────────────────────────────────
export async function contributions(
  context: CapabilityContext,
  ports: CapabilityPorts,
): Promise<{ id: string; ability: string; state: string | null; tags: { name: string; usage: string }[] }[]> {
  const out = [];
  for (const capability of REGISTRY) {
    const ability = capability.promptFragment(context);
    if (ability === null) continue;
    // A capability's state line is built from user-entered titles and notes
    // ("Due today: <whatever they called it>"), and it renders in the turn.
    // Same channel, same treatment.
    const state = await capability.contextFragment(context, ports);
    out.push({
      id: capability.id,
      ability,
      state: state === null ? null : sanitiseRecalled(state, 600),
      // Tag names reach the prompt with their brackets; the parser is given
      // the bare names.  Same list, one source.
      tags: capability.tags.map((tag) => ({ name: `<${tag.name}>`, usage: tag.usage })),
    });
  }
  return out;
}

/** What the TagStream should accept this turn — the same list, unbracketed. */
export function tagSpecs(): { name: string; payload: boolean }[] {
  return allTags().map((tag) => ({ name: tag.name, payload: tag.payload }));
}

// ── consumer 3: the jobs runner ───────────────────────────────────────────
export async function outreachCandidates(context: CapabilityContext, ports: CapabilityPorts): Promise<OutreachCandidate[]> {
  const candidates: OutreachCandidate[] = [];
  for (const capability of REGISTRY) {
    if (capability.proposeOutreach === undefined) continue;
    candidates.push(...(await capability.proposeOutreach(context, ports)));
  }
  return candidates;
}

// ── consumer 4: data export (LESSONS §11) ─────────────────────────────────
export async function exportAll(userId: string, ports: CapabilityPorts): Promise<ExportSlice[]> {
  const slices: ExportSlice[] = [];
  for (const capability of REGISTRY) slices.push(...(await capability.exportFor(userId, ports)));
  return slices;
}

// ── consumer 5: deletion (LESSONS §11) ────────────────────────────────────
export async function purgeAll(userId: string, ports: CapabilityPorts): Promise<void> {
  for (const capability of REGISTRY) await capability.purgeFor(userId, ports);
}

// ── consumer 6: the screens ───────────────────────────────────────────────
/**
 * Turn captured rows back into the line UI-UX §4 shows.
 *
 * Grouped by capability and batched, so a window of sixty messages costs one
 * query per capability rather than one per capture. The caller passes what
 * the captures table recorded; the capability decides how it reads.
 *
 * A capture whose row was corrected away is absent from the result rather
 * than rendered as an empty chip — the correction removed it, and the chat
 * should say the same thing the screen does.
 */
export async function describeCaptures(
  captures: readonly { capability: string; entityId: string }[],
  context: CapabilityContext,
  ports: CapabilityPorts,
): Promise<Record<string, CaptureSummary>> {
  const byCapability = new Map<string, string[]>();
  for (const capture of captures) {
    const ids = byCapability.get(capture.capability) ?? [];
    ids.push(capture.entityId);
    byCapability.set(capture.capability, ids);
  }
  const described: Record<string, CaptureSummary> = {};
  for (const [id, entityIds] of byCapability) {
    const capability = capabilityById(id);
    if (capability === undefined) continue;
    Object.assign(described, await capability.describe({ entityIds, context }, ports));
  }
  return described;
}
