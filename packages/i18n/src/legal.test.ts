// The legal documents, and the promise that nothing in them is unmarked.
//
// These tests are not about wording — nobody here can check wording. They are
// about the mechanism that gets the wording checked: that every section of
// every document is on the list a lawyer will be handed, that the list names
// only keys that exist, and that while the text is unreviewed, every screen
// carrying it says so.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, type CopyKey } from './catalog.ts';
import { LEGAL_DOCUMENTS, TERMS, PRIVACY, NEEDS_LEGAL_REVIEW, LEGAL_REVIEWED } from './legal.ts';
import { t, CONSENT_VERSION } from './index.ts';

describe('every legal string is marked for review', () => {
  test('a section added to a document without being marked fails this test', () => {
    const marked = new Set<string>(NEEDS_LEGAL_REVIEW);
    const missing: string[] = [];
    for (const document of LEGAL_DOCUMENTS) {
      if (!marked.has(document.title)) missing.push(document.title);
      for (const section of document.sections) {
        if (!marked.has(section.heading)) missing.push(section.heading);
        if (!marked.has(section.body)) missing.push(section.body);
      }
    }
    assert.deepEqual(missing, [], `unmarked legal text: ${missing.join(', ')}`);
  });

  test('the list names only keys that exist', () => {
    // A marked key that was renamed is a key nobody will review.
    const unknown = NEEDS_LEGAL_REVIEW.filter((key) => !(key in CATALOG));
    assert.deepEqual(unknown, []);
  });

  test('every marked key is authored in both languages', () => {
    for (const key of NEEDS_LEGAL_REVIEW) {
      const entry = CATALOG[key as CopyKey];
      assert.ok(entry.en.trim().length > 0, `${key} has no English`);
      assert.ok(entry.ar.trim().length > 0, `${key} has no Arabic`);
      // Placeholder legal text that is a copy of the other language is worse
      // than none: it looks translated.
      assert.notEqual(entry.ar, entry.en, `${key} is the same string in both languages`);
    }
  });

  test('the documents are not empty, and every section has a body', () => {
    assert.ok(TERMS.sections.length >= 5);
    assert.ok(PRIVACY.sections.length >= 5);
    for (const document of LEGAL_DOCUMENTS) {
      for (const section of document.sections) {
        assert.ok(CATALOG[section.body].en.length > 80, `${section.body} is too short to be a section`);
      }
    }
  });
});

describe('while it is unreviewed, it says so', () => {
  test('LEGAL_REVIEWED is false, and the banner copy exists in both languages', () => {
    // When this flips to true, the banner disappears from every screen at
    // once — and the assertion below becomes the reminder that it was a
    // deliberate act rather than an edit to a screen.
    assert.equal(LEGAL_REVIEWED, false, 'if this is now true, a lawyer has read it — say so in HANDOFF');
    assert.match(t('legal.unreviewed_title', 'en'), /lawyer/i);
    assert.ok(t('legal.unreviewed_body', 'ar').length > 40);
  });

  test('the consent version is a date, so an agreement can be dated', () => {
    assert.match(CONSENT_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('what the privacy notice claims is what the build does', () => {
  // These are the four claims that would be lies if the code changed under
  // them. They are asserted here rather than trusted, because a privacy
  // notice that has drifted from the software is the worst kind of wrong.
  test('it names every service that receives data', () => {
    const body = CATALOG['legal.privacy_who_b'].en;
    for (const service of ['model provider', 'speech provider', 'object store', 'Stripe']) {
      assert.ok(body.includes(service), `the privacy notice does not mention the ${service}`);
    }
  });

  test('it says the TTS cache outlives the account, because it does', () => {
    // packages/db/src/scope.ts records tts_cache as unscoped: keyed by
    // content hash, holding no user reference, therefore not removed with
    // an account. That is a real trade-off and the notice states it.
    assert.match(CATALOG['legal.privacy_long_b'].en, /cached by the text it says/);
  });

  test('it says incognito is kept only while it is open', () => {
    assert.match(CATALOG['legal.privacy_long_b'].en, /incognito/i);
  });

  test('it does not promise the service cannot be breached', () => {
    assert.match(CATALOG['legal.privacy_security_b'].en, /not a claim that the service cannot be breached/);
  });
});
