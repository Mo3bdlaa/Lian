// LESSONS §10, as a test — including the two distinctions a naive rule
// collapses, which are the reason the first pass at this was wrong.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addressViolations, normaliseArabic, isFirstPersonVerb, SAFE_FORMS } from './arabic.ts';
import { CATALOG } from './catalog.ts';
import { t } from './index.ts';

describe('§10 second-person address to the user', () => {
  test('a masculine imperative to the user is caught', () => {
    // The real examples from DECISIONS §30's review of 652 strings.
    for (const bad of ['شوف بريدك', 'اكتب DELETE للتأكيد', 'ابحث في الذاكرة', 'اشترك دلوقتي']) {
      assert.ok(addressViolations(bad, 'user').length > 0, `not caught: ${bad}`);
    }
  });

  test('a feminine imperative to the USER is caught too — it assumes as much', () => {
    assert.ok(addressViolations('اكتبي رسالتك', 'user').length > 0);
  });

  test('the same feminine imperative addressed to HER is correct and passes', () => {
    // "The rule is about direction of address, not about the letters."  This
    // is the distinction the earlier pass missed: it treated the two
    // directions as one rule and deleted correct copy.
    for (const good of ['احفظيها', 'افتكري ده', 'فكّريني بالدفعة', 'اتصرفي كمُحاوِرة']) {
      assert.deepEqual(addressViolations(good, 'assistant'), [], `wrongly flagged: ${good}`);
    }
  });

  test('the verbal-noun rewrite passes where the imperative failed', () => {
    // DECISIONS §30's own rewrites, as before/after pairs.
    const rewrites: [string, string][] = [
      ['اكتبي رسالتك', 'كتابة رسالة'],
      ['ابحث في الذاكرة', 'البحث في الذاكرة'],
      ['اشترك', 'الاشتراك'],
      ['اكتب DELETE للتأكيد', 'كتابة DELETE للتأكيد'],
    ];
    for (const [before, after] of rewrites) {
      assert.ok(addressViolations(before, 'user').length > 0, `${before} should fail`);
      assert.deepEqual(addressViolations(after, 'user'), [], `${after} should pass`);
    }
  });

  test('past tense and possessives are SAFE and must not be flagged', () => {
    // "Avoiding them makes the copy stilted for no benefit."  A rule that
    // flags these produces worse Arabic, so this test protects the copy from
    // the gate as much as the other way round.
    for (const safe of SAFE_FORMS) assert.deepEqual(addressViolations(safe, 'user'), [], `wrongly flagged: ${safe}`);
    assert.deepEqual(addressViolations('قلت إن الأسبوع كان تقيل، وبريدك فيه رد', 'user'), []);
  });

  test('a predicate describing the user is caught', () => {
    assert.ok(addressViolations('حاسس بتوتر منه', 'user').length > 0);
    assert.deepEqual(addressViolations('توتر منه', 'user'), [], 'said about the thing instead');
  });

  test('a first-person verb is her voice, not address to the user', () => {
    // أفتح "I open" vs افتح "open" — unvocalised they differ by one hamza,
    // and every naive normaliser deletes it.  Deleting it flags her own
    // sentences as gendered address to the user, which is how a checker
    // starts producing worse copy than no checker.
    assert.ok(isFirstPersonVerb('أفتح'));
    assert.ok(!isFirstPersonVerb('افتح'));
    assert.deepEqual(addressViolations('أقدر أفتح الموضوع في وقته', 'user'), [], 'she is talking about herself');
    assert.ok(addressViolations('افتح الموضوع', 'user').length > 0, 'the imperative is still caught');
  });

  test('normalisation ignores diacritics and spelling variants', () => {
    assert.equal(normaliseArabic('اكتُبْ'), normaliseArabic('اكتب'));
    assert.ok(addressViolations('اكتُبْ رسالة', 'user').length > 0, 'diacritics must not hide a violation');
  });
});

describe('the catalogue', () => {
  test('every entry has both languages authored', () => {
    for (const [key, entry] of Object.entries(CATALOG)) {
      assert.ok(entry.en.trim().length > 0, `${key}: no English`);
      assert.ok(entry.ar.trim().length > 0, `${key}: no Arabic — not a later translation pass (§10)`);
      assert.ok(['user', 'assistant', 'none'].includes(entry.addressee), `${key}: no addressee declared`);
    }
  });

  test('no Arabic string addressed to the user assumes their gender', () => {
    for (const [key, entry] of Object.entries(CATALOG)) {
      assert.deepEqual(addressViolations(entry.ar, entry.addressee), [], `${key}: ${entry.ar}`);
    }
  });

  test('assistant gender selects between authored strings, never transforms one', () => {
    assert.equal(t('error.offline', 'ar', 'female'), 'أنا بعيدة شوية دلوقتي. هلحق كل حاجة أول ما أقدر.');
    assert.equal(t('error.offline', 'ar', 'male'), 'أنا بعيد شوية دلوقتي. هلحق كل حاجة أول ما أقدر.');
    // Where no masculine variant is authored, the feminine one is used
    // as-is rather than being mangled — and HANDOFF lists the gap.
    assert.equal(t('money.empty', 'ar', 'male'), CATALOG['money.empty'].ar);
  });

  test('English is unaffected by assistant gender', () => {
    assert.equal(t('limit.reached', 'en', 'male'), t('limit.reached', 'en', 'female'));
  });
});
