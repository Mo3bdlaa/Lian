// What a client is allowed to know about the relationship — LESSONS §6.
//
// "Never surfaced as a score, level, bar, or percentage."  A rule like that
// is not kept by remembering it at render time; it is kept by the number
// never reaching the renderer.  So this is the only function that turns
// relationship state into something a client sees, and it returns PROSE.
//
// There is deliberately no `days`, `progress`, `next` or `stage` number in
// the result.  A stage KEY is included because Our story needs to mark which
// description is the current one — but a key is a name, not a rank, and the
// five keys have no arithmetic between them.
import { STAGE_KEYS, stageKey, type Stage } from '@lian/domain';
import { t, type Language, type AssistantGender } from '@lian/i18n';
import type { CopyKey } from '@lian/i18n';

export type StageView = {
  readonly key: string;
  readonly name: string;
  readonly prose: string;
  readonly current: boolean;
};

export type RelationshipView = {
  /** The sentence shown on Our story now. */
  readonly now: string;
  /** All five, for the explanatory view.  Dimmed except the current one, and
   *  carrying no numbers, order badges or progress (DECISIONS §25). */
  readonly stages: readonly StageView[];
  /** "Quiet stretches are fine. This does not go backwards." */
  readonly footer: string;
};

export function relationshipView(stage: Stage, language: Language, gender: AssistantGender): RelationshipView {
  const currentKey = stageKey(stage);
  const stages = STAGE_KEYS.map((key) => ({
    key,
    name: t(`stage.${key}.name` as CopyKey, language, gender),
    prose: t(`stage.${key}.prose` as CopyKey, language, gender),
    current: key === currentKey,
  }));
  return {
    now: t(`stage.${currentKey}.prose` as CopyKey, language, gender),
    stages,
    footer: t('stage.footer', language, gender),
  };
}
