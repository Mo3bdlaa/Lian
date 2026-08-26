// Embeddings.
//
// Text in, vector out — non-voice by definition, so it lives on this path.
// The port is provider-agnostic (Q17); two implementations ship.
import { createHash } from 'node:crypto';

/** Must match the vector column width in migration 0003. */
export const EMBEDDING_DIMENSIONS = 1024;

export type Embedder = {
  /** Recorded on every row, because switching embedders without noticing
   *  mixes two vector spaces in one index and retrieval quietly degrades
   *  rather than failing. */
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
};

function normalise(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  return length === 0 ? vector : vector.map((value) => value / length);
}

/**
 * A deterministic embedder for development and tests.
 *
 * IT IS NOT SEMANTIC.  It hashes token trigrams into a fixed space, so
 * identical text matches itself and similar text sometimes lands nearby by
 * accident.  It exists so the retrieval path — the SQL, the index, the
 * ordering, the dimension — can be exercised end to end without a network
 * call or an API key, and so a test asserting "the right memory came back"
 * is asserting the plumbing rather than a provider's quality.
 *
 * Never ship it as the production embedder.  `id` says so out loud, and it is
 * written to every row it touches.
 */
export function deterministicEmbedder(dimensions = EMBEDDING_DIMENSIONS): Embedder {
  return {
    id: 'deterministic-dev-not-semantic',
    dimensions,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Array<number>(dimensions).fill(0);
        const tokens = text.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        for (let i = 0; i < tokens.length; i++) {
          // unigrams and bigrams, so word order carries a little weight
          const grams = [tokens[i]!, i > 0 ? `${tokens[i - 1]!} ${tokens[i]!}` : null].filter((g): g is string => g !== null);
          for (const gram of grams) {
            const digest = createHash('sha256').update(gram).digest();
            for (let b = 0; b < 8; b++) {
              const slot = ((digest[b * 2]! << 8) | digest[b * 2 + 1]!) % dimensions;
              vector[slot] = vector[slot]! + (digest[b * 2 + 1]! % 2 === 0 ? 1 : -1);
            }
          }
        }
        return normalise(vector);
      });
    },
  };
}

/**
 * A real embedder over HTTP.  Untested against the live service — no key was
 * available — so treat the first call as unverified.  The shape is the common
 * one: POST a list of inputs, receive a list of vectors in order.
 */
export function httpEmbedder(config: {
  id: string;
  url: string;
  apiKey: string;
  model: string;
  dimensions?: number;
}): Embedder {
  const dimensions = config.dimensions ?? EMBEDDING_DIMENSIONS;
  return {
    id: config.id,
    dimensions,
    async embed(texts) {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, input: texts, output_dimension: dimensions }),
      });
      if (!response.ok) throw new Error(`embedder ${config.id} returned ${response.status}`);
      const body = (await response.json()) as { data?: { embedding?: number[] }[] };
      const vectors = (body.data ?? []).map((row) => row.embedding ?? []);
      if (vectors.length !== texts.length) throw new Error(`embedder ${config.id} returned ${vectors.length} vectors for ${texts.length} inputs`);
      for (const vector of vectors) {
        if (vector.length !== dimensions) throw new Error(`embedder ${config.id} returned ${vector.length} dimensions, expected ${dimensions}`);
      }
      return vectors;
    },
  };
}

/** Postgres vector literal.  pgvector accepts '[1,2,3]'. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value.toFixed(6) : '0')).join(',')}]`;
}
