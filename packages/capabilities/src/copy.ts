// Small bilingual helper.  A capability speaks in her voice, so its strings
// live with it rather than in a central bundle — but both languages are
// always authored together, never one derived from the other (LESSONS §10).
export function line(language: 'en' | 'ar', english: string, arabic: string): string {
  return language === 'ar' ? arabic : english;
}
