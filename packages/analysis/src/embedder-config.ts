// Choosing an embedder — deliberately not a default.
//
// This is the highest reversal-cost decision in the codebase: the width is
// baked into a vector column, and changing model or width means re-embedding
// every memory every user has. So it is configuration that must be stated,
// not a value that quietly appears.
//
// THE CHOICE, and why:
//
//   model      text-embedding-3-large, truncated to 1024 dimensions
//   width      1024
//
//   - Multilingual. Arabic is a first-class language here, not a fallback,
//     and an embedder that treats it as one is the whole reason retrieval
//     will work for half the intended users.
//   - The width is a CHOICE. This family supports truncating the output
//     dimension natively (the leading dimensions carry the most signal), so
//     1024 is a decision about storage and index size rather than whatever
//     the model happened to emit. A 3072-wide column costs three times the
//     storage and index for retrieval over a few thousand short sentences.
//   - It shares a vendor and a key with the speech provider already chosen,
//     which is one fewer secret to rotate and one fewer account to lose.
//
// ASSUMPTION worth stating: at ~$0.13 per million tokens (read 2026-06-24,
// same source as the model prices in @lian/llm), a memory statement of ~20
// tokens costs ~0.0000026 — about 3 micros per 1000 memories. Embedding cost
// is not a line item at this scale; it is listed so nobody has to wonder.
import { deterministicEmbedder, httpEmbedder, EMBEDDING_DIMENSIONS, type Embedder } from './embed.ts';

export type EmbedderChoice = {
  readonly model: string;
  readonly dimensions: number;
  readonly url: string;
};

/** The models this schema's vector width is compatible with. Adding one is a
 *  decision about whether its vectors can share an index with the others —
 *  they cannot, so a change here means a backfill. */
export const EMBEDDER_CATALOGUE: Readonly<Record<string, EmbedderChoice>> = {
  'text-embedding-3-large': {
    model: 'text-embedding-3-large',
    dimensions: 1024, // truncated from 3072; supported natively
    url: 'https://api.openai.com/v1/embeddings',
  },
  'text-embedding-3-small': {
    model: 'text-embedding-3-small',
    dimensions: 1024, // truncated from 1536
    url: 'https://api.openai.com/v1/embeddings',
  },
};

export const CHOSEN_EMBEDDER = 'text-embedding-3-large';

export type EmbedderEnv = {
  readonly model?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly url?: string | undefined;
  /** Set in production. Without a real embedder configured, this throws
   *  rather than falling back — a product whose retrieval silently is not
   *  semantic looks like it works and fails exactly where it earns its
   *  place: the same thing said differently. */
  readonly requireReal: boolean;
};

export class EmbedderNotConfiguredError extends Error {
  constructor() {
    super(
      'no embedder configured. Set LIAN_EMBEDDER_MODEL and LIAN_EMBEDDER_API_KEY. ' +
        'The development embedder is deterministic and NOT semantic: retrieval with it matches text that repeats, ' +
        'and misses the same thing said differently — which is the only case semantic retrieval is for.',
    );
    this.name = 'EmbedderNotConfiguredError';
  }
}

export function resolveEmbedder(env: EmbedderEnv): { embedder: Embedder; real: boolean; note: string } {
  const model = env.model ?? '';
  const apiKey = env.apiKey ?? '';

  if (model === '' || apiKey === '') {
    if (env.requireReal) throw new EmbedderNotConfiguredError();
    return {
      embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS),
      real: false,
      note: 'development embedder — deterministic, not semantic; retrieval will match repeated text and miss paraphrase',
    };
  }

  const choice = EMBEDDER_CATALOGUE[model];
  if (choice === undefined) {
    throw new Error(
      `unknown embedder '${model}'. Known: ${Object.keys(EMBEDDER_CATALOGUE).join(', ')}. ` +
        'Adding one means deciding whether its vectors can share an index with the existing ones — they cannot, so it means a backfill.',
    );
  }
  if (choice.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedder '${model}' produces ${choice.dimensions} dimensions but the vector column is ${EMBEDDING_DIMENSIONS}. ` +
        'These must match: a mismatched width is not a degraded search, it is a failed insert.',
    );
  }

  return {
    embedder: httpEmbedder({
      id: model, url: env.url ?? choice.url, apiKey,
      model: choice.model, dimensions: choice.dimensions,
    }),
    real: true,
    note: `${model} at ${choice.dimensions} dimensions`,
  };
}
