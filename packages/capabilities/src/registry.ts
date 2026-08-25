// The registry.
//
// This array is the ONLY place a capability is named outside its own
// directory.  Five consumers iterate it: prompt assembly, the turn handler,
// the jobs runner, data export and deletion (LESSONS §13 and §11).
//
// Adding a capability is: one directory, one import, one line here.
import type { Capability, CapabilityContext, CapabilityTag, ExportSlice, OutreachCandidate } from '@lian/domain';
import type { CapabilityPorts } from './ports.ts';
import { tasksCapability } from './tasks/index.ts';
import { moneyCapability } from './money/index.ts';

export const REGISTRY: readonly Capability<CapabilityPorts>[] = [tasksCapability, moneyCapability];

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
    out.push({
      id: capability.id,
      ability,
      state: await capability.contextFragment(context, ports),
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
