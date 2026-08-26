// ==========================================================================
// The Arabic address rule — LESSONS §10.
//
// "Any second-person verb encodes the user's gender. Prefer verbal nouns for
// imperatives and first person from her side. Where direct address is
// unavoidable, author both forms."
//
// And the distinction a naive rule collapses:
//
//   - Past-tense second person and possessives are SAFE unvocalised — the
//     letters are identical for both genders.  Avoiding them makes the copy
//     stilted for no benefit.  So قلت، عليك، بريدك، يمكنك are fine.
//   - Feminine forms ADDRESSED TO HER are correct and must stay.  The rule is
//     about DIRECTION OF ADDRESS, not about the letters.
//
// That second point is why every catalogue entry declares its addressee.  A
// checker that only looked at the words would delete احفظيها ("save it",
// said to Lian) which is right, while missing تسيبها ("you leave it", said to
// the user) which is wrong.
//
// This is a denylist of the forms that actually occurred, not a morphological
// analyser.  It catches the classes DECISIONS §30 found in a real review of
// 652 strings; a new form has to be added here when it appears.  A gate that
// is honest about being a denylist is more useful than one that claims to be
// a parser.
// ==========================================================================

/**
 * A word beginning with a hamza-carrying alif (أ) is first person present —
 * أفتح "I open", أقول "I say".  The imperative is a bare alif: افتح "open".
 * Unvocalised they differ by exactly that hamza, so normalising it away —
 * which every naive Arabic normaliser does — destroys the one distinction
 * this checker exists to make, and flags her own voice as address to the
 * user.  Checked before normalisation, deliberately.
 */
export function isFirstPersonVerb(rawWord: string): boolean {
  return /^[وفبل]?أ/u.test(rawWord);
}

/** Diacritics, tatweel and the Arabic-Indic digits, removed before matching. */
export function normaliseArabic(text: string): string {
  return text
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/** Second-person IMPERATIVES — the form DECISIONS §30 rewrote as verbal nouns. */
const IMPERATIVES_MASCULINE = [
  'شوف', 'اكتب', 'ابدا', 'اشترك', 'التقط', 'ابحث', 'اشرح', 'قول', 'قوللي', 'خليني', 'خلي',
  'سيب', 'افتح', 'احفظ', 'فكر', 'فكرني', 'جرب', 'اضغط', 'اختار', 'حدد', 'اتصل', 'ادخل',
  'سجل', 'راجع', 'امسح', 'احذف', 'شارك', 'فعل', 'ارجع', 'كمل', 'جهز', 'اطلب', 'افتكر', 'اسمح',
];
const IMPERATIVES_FEMININE = [
  'شوفي', 'اكتبي', 'ابدئي', 'قولي', 'قوليلي', 'افتحي', 'احفظي', 'فكري', 'فكريني', 'جربي',
  'اتصرفي', 'تساعديني', 'افتكري', 'اسمحي', 'خليني', 'راجعي', 'سجلي', 'اطلبي',
];

/** Present/future second person, and predicates that describe the user. */
const PRESENT_AND_PREDICATES = [
  'بتشوف', 'بتكتب', 'هتشوف', 'هتلاقي', 'هتقرا', 'تقدر', 'تحب', 'تسيبها', 'تخلصها', 'تعمل',
  'عايز', 'عايزه', 'محتاج', 'محتاجه', 'حاسس', 'حاسه', 'قادر', 'قادره', 'صاحي', 'صاحيه',
  'مبسوط', 'مبسوطه', 'متوتر', 'متوتره', 'جاهز', 'جاهزه',
];

/**
 * Forms that LOOK second person and are not a problem: past tense, pronouns
 * and possessives, whose letters are identical for both genders unvocalised.
 * Listed explicitly so nobody "fixes" them into stilted copy later.
 */
export const SAFE_FORMS = ['قلت', 'انت', 'عليك', 'بريدك', 'يمكنك', 'حبيت', 'غيرت', 'اتمتها', 'لك', 'معك', 'عندك'];

export type Addressee = 'user' | 'assistant' | 'none';

export type AddressViolation = { readonly word: string; readonly why: string };

/**
 * Check one Arabic string for second-person address that would encode the
 * USER's gender.  `addressee` decides which direction is being checked:
 * feminine imperatives are correct when she is the one being addressed.
 */
export function addressViolations(text: string, addressee: Addressee): AddressViolation[] {
  if (addressee !== 'user') return [];
  // Split the RAW text so the initial hamza survives to isFirstPersonVerb,
  // then normalise each word for matching.
  const rawWords = text.split(/[^؀-ۿ]+/u).filter(Boolean);
  const violations: AddressViolation[] = [];
  const safe = new Set(SAFE_FORMS.map(normaliseArabic));
  const masculine = new Set(IMPERATIVES_MASCULINE.map(normaliseArabic));
  const feminine = new Set(IMPERATIVES_FEMININE.map(normaliseArabic));
  const present = new Set(PRESENT_AND_PREDICATES.map(normaliseArabic));

  for (const rawWord of rawWords) {
    // Her own voice is never address to the user.
    if (isFirstPersonVerb(rawWord)) continue;
    const word = normaliseArabic(rawWord);
    const bare = word.replace(/^(و|ف|ب|ل)/, '');
    if (safe.has(word) || safe.has(bare)) continue;
    if (masculine.has(word) || masculine.has(bare)) {
      violations.push({ word, why: 'imperative addressed to the user assumes he is male — use a verbal noun (اكتب → كتابة)' });
    } else if (feminine.has(word) || feminine.has(bare)) {
      violations.push({ word, why: 'imperative addressed to the user assumes she is female — use a verbal noun, and keep feminine forms only when speaking TO Lian' });
    } else if (present.has(word) || present.has(bare)) {
      violations.push({ word, why: 'second-person verb or predicate encodes the user\'s gender — say it about the thing instead (حاسس بتوتر → توتر منه)' });
    }
  }
  return violations;
}
