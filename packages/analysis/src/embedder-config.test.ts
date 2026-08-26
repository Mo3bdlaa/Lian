import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmbedder, EmbedderNotConfiguredError, EMBEDDER_CATALOGUE, CHOSEN_EMBEDDER } from './embedder-config.ts';
import { EMBEDDING_DIMENSIONS, deterministicEmbedder } from './embed.ts';

describe('the embedder is chosen, not defaulted', () => {
  test('production refuses to start without one', () => {
    // A product whose retrieval silently is not semantic looks like it works
    // and fails exactly where semantic retrieval earns its place.
    assert.throws(() => resolveEmbedder({ requireReal: true }), EmbedderNotConfiguredError);
    assert.throws(() => resolveEmbedder({ model: CHOSEN_EMBEDDER, requireReal: true }), EmbedderNotConfiguredError);
    assert.throws(() => resolveEmbedder({ apiKey: 'k', requireReal: true }), EmbedderNotConfiguredError);
  });

  test('the error says what the development embedder actually does', () => {
    // The failure mode is specific, so the message is too: it matches
    // repeated text and misses paraphrase.
    const error = new EmbedderNotConfiguredError();
    assert.match(error.message, /NOT semantic/);
    assert.match(error.message, /the same thing said differently/);
  });

  test('development falls back loudly, and the row says so', async () => {
    const resolved = resolveEmbedder({ requireReal: false });
    assert.equal(resolved.real, false);
    assert.match(resolved.note, /not semantic/);
    assert.match(resolved.embedder.id, /not-semantic/, 'every row it writes carries the warning');
  });

  test('a configured embedder is real, and named', () => {
    const resolved = resolveEmbedder({ model: CHOSEN_EMBEDDER, apiKey: 'k', requireReal: true });
    assert.equal(resolved.real, true);
    assert.equal(resolved.embedder.id, CHOSEN_EMBEDDER);
    assert.equal(resolved.embedder.dimensions, EMBEDDING_DIMENSIONS);
  });

  test('an unknown model is an error naming the consequence', () => {
    assert.throws(
      () => resolveEmbedder({ model: 'some-other-embedder', apiKey: 'k', requireReal: true }),
      /it means a backfill/,
    );
  });

  test('every catalogued model matches the column width', () => {
    // A mismatched width is not a degraded search, it is a failed insert —
    // and the width is the highest reversal-cost decision here.
    for (const [name, choice] of Object.entries(EMBEDDER_CATALOGUE)) {
      assert.equal(choice.dimensions, EMBEDDING_DIMENSIONS, `${name} would not fit the vector column`);
    }
    assert.ok(CHOSEN_EMBEDDER in EMBEDDER_CATALOGUE);
  });

  test('the development embedder is honest about what it is', async () => {
    // It matches text that repeats…
    const embedder = deterministicEmbedder();
    const [a, b] = await embedder.embed(['the lease renews in March', 'the lease renews in March']);
    assert.deepEqual(a, b);
    // …and this is the case it cannot do, which is why production requires a
    // real one: the same fact said differently.
    const [x, y] = await embedder.embed(['their sister lives in Cairo', 'Dana is based in Egypt']);
    const cosine = x!.reduce((sum, value, i) => sum + value * y![i]!, 0);
    assert.ok(cosine < 0.2, `paraphrase should NOT match on a lexical embedder; got ${cosine.toFixed(3)}`);
  });
});
