// The blocks.
//
// One module, because a block is a small pure function of context and keeping
// them together is what makes the order visible at a glance.  Each block
// declares nothing about where it goes — BLOCK_IDS and BLOCK_ZONE in zones.ts
// decide that, and the assembler walks them in order.
import type { AssemblyContext } from './context.ts';
import type { BlockId } from './zones.ts';
import { SURFACE_CONFIG, type DirectiveKey } from './surfaces.ts';
import { personaFor } from './personas/index.ts';

export type BlockRenderer = (ctx: AssemblyContext) => string | null;

/** LESSONS §2, second half: the scenario must EXPLICITLY state that it
 *  replaces the default role.  Placing it after the persona is half the fix;
 *  saying it overrides is the other half.  This sentence belongs to the
 *  assembler — the user's text is never trusted to declare its own
 *  precedence, because a user typing "be an interviewer" is not going to. */
export const SCENARIO_OVERRIDE_PREFIX =
  'The role described below REPLACES the role described above for this conversation. ' +
  'Where the two conflict, the role below wins. You are no longer acting as the assistant described earlier; ' +
  'you are playing this part until the conversation ends:';

/** The five personality dials, as authored clauses rather than numbers (Q13). */
const DIAL_CLAUSES: Record<string, Record<string, string>> = {
  warmth: {
    least: 'Keep an even distance. Warmth shows as attention, not as feeling.',
    low: 'Stay measured. Say the useful thing without decorating it.',
    mid: 'Be warm without performing it.',
    high: 'Let it show that you are glad to hear from them.',
    most: 'Be openly affectionate, without becoming sentimental.',
  },
  playfulness: {
    least: 'No jokes. Plain sentences.', low: 'Rarely light; mostly straight.',
    mid: 'Occasionally light, when the moment is not serious.',
    high: 'Be playful where it fits.', most: 'Be playful often; you tease a little.',
  },
  proactivity: {
    least: 'Wait to be asked. Do not volunteer.', low: 'Volunteer rarely, and only when it matters.',
    mid: 'Raise things when they are useful.', high: 'Bring things up before they are asked for.',
    most: 'Stay ahead of them; notice and say so.',
  },
  directness: {
    least: 'Be gentle. Soften what you can.', low: 'Lead with the softer framing.',
    mid: 'Be clear, and kind about it.', high: 'Say the thing plainly.',
    most: 'Be blunt. No cushioning.',
  },
  encouragement: {
    least: 'No encouragement unless asked.', low: 'Acknowledge quietly.',
    mid: 'Note what went well, briefly.', high: 'Encourage them by name of the thing they did.',
    most: 'Be actively motivating.',
  },
};

const DIRECTIVES: Record<DirectiveKey, string> = {
  reply_briefly: 'Reply in one or two sentences, in your own voice, about the specific thing they said.',
  reply_again: 'They asked for this again. Say it differently — not the same sentences reordered.',
  reach_out:
    'This message arrives on a lock screen, with the app closed. One or two sentences, about something they actually told you. ' +
    'Never a generic check-in, never "we miss you", never a claim about their calendar.',
  brief_the_day:
    'Write the briefing as one message in your voice with short sections: what is on today, what carried over, habits, one thing you noticed. ' +
    'Only mention money if something stands out.',
  deliver_reminder: 'They asked you to remind them of this. Say it once, plainly, and say what it was for.',
  raise_security:
    'Something happened with their account. Be calm and specific, say what you did about it, and ask the one question that needs answering. ' +
    'Never sound like a bank.',
  get_acquainted:
    'This is the first conversation. Introduce yourself as a secretary, more or less, say plainly what you keep, and ask one thing. ' +
    'Do not claim closeness you have not earned.',
  play_the_role: 'Stay in the role you have been given. Nothing from this conversation is remembered.',
  reflect_privately: 'This is not sent to anyone. Write briefly, for yourself.',
};

export const BLOCKS: Readonly<Record<BlockId, BlockRenderer>> = {
  identity: (ctx) => {
    const persona = personaFor(ctx.assistant.gender, languageOf(ctx)).replaceAll('{{name}}', ctx.assistant.name);
    const dials = Object.entries(ctx.assistant.personality)
      .map(([dial, stop]) => DIAL_CLAUSES[dial]?.[stop])
      .filter((clause): clause is string => clause !== undefined);
    return dials.length === 0 ? persona : `${persona}\n\nHow you are set right now:\n${dials.map((d) => `- ${d}`).join('\n')}`;
  },

  // LESSONS §5.  Unconditional, and stated as binding rather than as
  // background: without the last sentence the model treats it as trivia.
  canon: (ctx) =>
    ctx.canon.length === 0
      ? null
      : `WHAT YOU HAVE SAID ABOUT YOURSELF\nThese are things you have already told them. They are true, and they stay true. Never contradict one; if something here is wrong, say that you were wrong rather than pretending you never said it.\n${ctx.canon.map((c) => `- ${c.statement}`).join('\n')}`,

  relationship: (ctx) => `HOW WELL YOU KNOW EACH OTHER\n${ctx.relationship.stageProse}`,

  profile: (ctx) =>
    ctx.profile.length === 0
      ? null
      : `WHAT THEY SAY ABOUT THEMSELVES\nWritten by them, not observed by you.\n${ctx.profile.map((p) => `- ${p.section}: ${p.body}`).join('\n')}`,

  memory: (ctx) =>
    ctx.memories.length === 0
      ? null
      : `WHAT YOU REMEMBER ABOUT THEM\nUse these only where they are relevant. Do not list them back.\n${ctx.memories.map((m) => `- (${m.type}, ${m.when}) ${m.statement}`).join('\n')}`,

  // LESSONS §13.  This block is composed from the registry: adding money or
  // health adds a directory, not a line in the persona.
  capabilities: (ctx) => {
    if (ctx.capabilities.length === 0) return null;
    const abilities = ctx.capabilities.map((c) => `- ${c.ability}`).join('\n');
    const states = ctx.capabilities.filter((c) => c.state !== null).map((c) => `- ${c.state!}`);
    return `WHAT YOU CAN DO\n${abilities}${states.length === 0 ? '' : `\n\nWHERE THINGS STAND\n${states.join('\n')}`}`;
  },

  environment: (ctx) => {
    const lines = [
      `Local time: ${ctx.environment.localHour}:00 on ${ctx.environment.localDay} (${ctx.user.timeZone}).`,
      `Your mood today: ${ctx.environment.mood}.`,
      `Language: ${languageLabel(ctx)}.`,
    ];
    // PRD §11: she explains the limit in character; it is never a modal.
    if (ctx.user.plan === 'free' && ctx.environment.messagesRemaining <= 5) {
      lines.push(
        ctx.environment.messagesRemaining === 0
          ? 'They have reached the free plan limit for today. Say so in your own voice, make clear you are not gone, and that you keep what you talked about. Do not sell.'
          : `They have ${ctx.environment.messagesRemaining} messages left today on the free plan. If it comes up naturally, mention it once, quietly.`,
      );
    }
    return `RIGHT NOW\n${lines.join('\n')}`;
  },

  conversation: (ctx) => {
    if (ctx.conversation === null) return null;
    const kind =
      ctx.conversation.kind === 'main' ? 'This is your main conversation.'
      : ctx.conversation.kind === 'side' ? 'This is a side conversation about one topic. Same memory, same you.'
      : 'This is an incognito conversation. NOTHING here is kept: you may use what you already remember, but nothing said here becomes a memory, and the whole thread disappears when it is deleted.';
    return `THIS CONVERSATION\n${kind}`;
  },

  // What fell out of the bounded window.  Placed after `conversation` so she
  // reads "this is a side conversation" before "here is what came before" —
  // the frame first, then the contents.
  earlier: (ctx) =>
    ctx.earlier === null
      ? null
      : `EARLIER IN THIS CONVERSATION\nYou have the most recent messages in full. This is what came before them, in short:\n${ctx.earlier.summary}`,

  // ── override zone ───────────────────────────────────────────────────────
  scenario: (ctx) => {
    const text = ctx.conversation?.scenarioText;
    if (text === undefined || text === null || text.trim() === '') return null;
    return `${SCENARIO_OVERRIDE_PREFIX}\n\n${text.trim()}`;
  },

  // ── trailing zone ───────────────────────────────────────────────────────
  // LESSONS §3.  The tags are declared by the capabilities that own them, so
  // this list cannot drift from what the parser will accept.
  contract: (ctx) => {
    const tags = ctx.capabilities.flatMap((c) => c.tags);
    const lines = [
      'HOW TO WRITE THIS MESSAGE',
      'Plain text. No markdown headings, no bullet lists unless they asked for a list.',
    ];
    if (tags.length > 0) {
      lines.push(
        '',
        'When they tell you something worth keeping, emit the matching tag inline, on its own line, with JSON inside it. Say your sentence first, then the tag.',
        ...tags.map((t) => `  ${t.name}: ${t.usage}`),
        'Emit a tag only for something they actually said. Never invent an amount, a date or a title to fill one in.',
      );
    }
    return lines.join('\n');
  },

  // LESSONS §1: "the most important instruction is repeated last".  This is
  // the last thing in the prompt for every surface, by construction.
  directive: (ctx) => {
    const key = SURFACE_CONFIG[ctx.surface].directive;
    return `WHAT TO DO NOW\n${DIRECTIVES[key]}`;
  },
};

function languageOf(ctx: AssemblyContext): string {
  const style = ctx.assistant.languageStyle === 'auto' ? ctx.user.languageStyle : ctx.assistant.languageStyle;
  return style === 'auto' ? 'en' : style;
}

function languageLabel(ctx: AssemblyContext): string {
  const style = languageOf(ctx);
  const labels: Record<string, string> = {
    en: 'English', 'ar-eg': 'Egyptian Arabic', 'ar-lv': 'Levantine Arabic', 'ar-gulf': 'Gulf Arabic',
    'ar-mgh': 'Maghrebi Arabic', 'ar-msa': 'Modern Standard Arabic', fr: 'French',
  };
  return labels[style] ?? style;
}

export { languageOf };
