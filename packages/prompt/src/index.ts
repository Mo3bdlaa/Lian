// The public surface of the prompt package is deliberately small: one
// function, its request and result types, and the enums a caller needs to
// name a surface.  Blocks, personas, zones and the renderer are internal —
// tools/gates/boundaries.ts refuses a deep import, so there is one way in.
export { assemblePrompt, type AssemblyRequest, type AssembledPrompt, type PromptSegment } from './assemble.ts';
export { SURFACES, SURFACE_CONFIG, type Surface } from './surfaces.ts';
export { BLOCK_VOLATILITY, cacheablePrefix, type Volatility } from './zones.ts';
export { MissingContextError, MissingPersonaError } from './errors.ts';
export type { PromptPorts } from './ports.ts';
export type {
  AssemblyContext, CapabilityContribution, MemoryContext, CanonContext,
  ProfileContext, ConversationContext, EarlierContext, OnboardingContext, RelationshipContext, EnvironmentContext,
  AttachmentContext,
  AssistantContext, UserContext,
} from './context.ts';
