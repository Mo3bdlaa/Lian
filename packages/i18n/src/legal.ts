// The two legal documents, as structure.
//
// The TEXT is in catalog.ts, because that is where the Arabic address gate
// can see it and where every other string in the product lives. What is here
// is which keys make up which document, in what order — and, more
// importantly, WHICH KEYS NEED A LAWYER.
//
// That last part is the point of this file. "Somebody should look at the
// legal text before launch" is the kind of thing that is true, obvious, and
// forgotten. So it is a list, the documents are built from it, and
// legal.test.ts fails the build if a section is added to a document without
// being on it. The marking cannot drift from the text, because the text is
// assembled from the marking.
import type { CopyKey } from './catalog.ts';

export type LegalSection = { readonly heading: CopyKey; readonly body: CopyKey };
export type LegalDocument = {
  readonly id: 'terms' | 'privacy';
  readonly title: CopyKey;
  readonly sections: readonly LegalSection[];
};

export const TERMS: LegalDocument = {
  id: 'terms',
  title: 'legal.terms_title',
  sections: [
    { heading: 'legal.terms_what_h', body: 'legal.terms_what_b' },
    { heading: 'legal.terms_account_h', body: 'legal.terms_account_b' },
    { heading: 'legal.terms_use_h', body: 'legal.terms_use_b' },
    { heading: 'legal.terms_paid_h', body: 'legal.terms_paid_b' },
    { heading: 'legal.terms_ending_h', body: 'legal.terms_ending_b' },
    { heading: 'legal.terms_warranty_h', body: 'legal.terms_warranty_b' },
    { heading: 'legal.terms_changes_h', body: 'legal.terms_changes_b' },
  ],
};

export const PRIVACY: LegalDocument = {
  id: 'privacy',
  title: 'legal.privacy_title',
  sections: [
    { heading: 'legal.privacy_what_h', body: 'legal.privacy_what_b' },
    { heading: 'legal.privacy_why_h', body: 'legal.privacy_why_b' },
    { heading: 'legal.privacy_who_h', body: 'legal.privacy_who_b' },
    { heading: 'legal.privacy_long_h', body: 'legal.privacy_long_b' },
    { heading: 'legal.privacy_rights_h', body: 'legal.privacy_rights_b' },
    { heading: 'legal.privacy_children_h', body: 'legal.privacy_children_b' },
    { heading: 'legal.privacy_security_h', body: 'legal.privacy_security_b' },
    { heading: 'legal.privacy_contact_h', body: 'legal.privacy_contact_b' },
  ],
};

export const LEGAL_DOCUMENTS = [TERMS, PRIVACY] as const;

/**
 * EVERY STRING IN THIS PRODUCT THAT NEEDS A LAWYER.
 *
 * Not a hint, not a TODO comment: the list a reviewer is handed, and the list
 * the documents are built against. If a section is added to TERMS or PRIVACY
 * and its keys are not here, `legal.test.ts` fails.
 *
 * It includes the consent screen's own summary as well as the two documents,
 * because the consent screen is where somebody agrees — a summary that is
 * wrong about what the documents say is the most expensive string of the lot.
 */
export const NEEDS_LEGAL_REVIEW: readonly CopyKey[] = [
  // The consent gate itself.
  'consent.title', 'consent.adult', 'consent.terms', 'consent.required',
  'consent.age_question', 'consent.age_yes', 'consent.age_no', 'consent.under_age',
  'consent.what_we_keep', 'consent.what_we_keep_body',
  'consent.who_sees', 'consent.who_sees_body',
  'consent.your_control', 'consent.your_control_body',

  // Terms.
  'legal.terms_title',
  'legal.terms_what_h', 'legal.terms_what_b',
  'legal.terms_account_h', 'legal.terms_account_b',
  'legal.terms_use_h', 'legal.terms_use_b',
  'legal.terms_paid_h', 'legal.terms_paid_b',
  'legal.terms_ending_h', 'legal.terms_ending_b',
  'legal.terms_warranty_h', 'legal.terms_warranty_b',
  'legal.terms_changes_h', 'legal.terms_changes_b',

  // Privacy.
  'legal.privacy_title',
  'legal.privacy_what_h', 'legal.privacy_what_b',
  'legal.privacy_why_h', 'legal.privacy_why_b',
  'legal.privacy_who_h', 'legal.privacy_who_b',
  'legal.privacy_long_h', 'legal.privacy_long_b',
  'legal.privacy_rights_h', 'legal.privacy_rights_b',
  'legal.privacy_children_h', 'legal.privacy_children_b',
  'legal.privacy_security_h', 'legal.privacy_security_b',
  'legal.privacy_contact_h', 'legal.privacy_contact_b',
] as const;

/**
 * Whether the legal text has been reviewed.
 *
 * FALSE, and it is a constant rather than a comment so that the banner on
 * the screens is driven by it: flipping this to true is the single edit that
 * removes "not yet reviewed by a lawyer" from every page it appears on, and
 * a test asserts the banner is shown while it is false. Nobody can quietly
 * ship reviewed-looking text by editing a screen.
 */
export const LEGAL_REVIEWED = false;
