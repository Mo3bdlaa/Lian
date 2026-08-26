// The copy catalogue.
//
// Both languages are authored together, never one derived from the other
// (LESSONS §10: "Arabic is a first-class language, not a translation pass").
//
// Every entry declares its ADDRESSEE, which is what makes the Arabic gate
// possible: the rule is about direction of address, not about letters.
// Feminine forms spoken TO Lian are correct; a second-person verb spoken to
// the user is not, because it assumes their gender.
//
// Where the assistant's gender changes the Arabic, both are authored (PRD
// §45 — a male voice is not a mechanical pronoun swap).
import type { Addressee } from './arabic.ts';

export type Entry = {
  readonly en: string;
  readonly ar: string;
  readonly addressee: Addressee;
  /** Present when the ASSISTANT's gender changes the string. */
  readonly arMale?: string;
};

export const CATALOG = {
  // ── empty states (design.md §9) ─────────────────────────────────────────
  'chat.empty': { en: "We haven't talked yet. I'm here when you're ready.", ar: 'لسه ما اتكلمناش. أنا هنا في أي وقت.', arMale: 'لسه ما اتكلمناش. أنا هنا في أي وقت.', addressee: 'user' },
  'memory.empty': { en: "As we talk, I'll remember what matters. You can always change or erase anything here.", ar: 'مع الكلام، هفتكر اللي يهم. وأي حاجة هنا قابلة للتعديل أو المسح.', arMale: 'مع الكلام، هفتكر اللي يهم. وأي حاجة هنا قابلة للتعديل أو المسح.', addressee: 'user' },
  'money.empty': { en: 'Nothing here yet. Tell me naturally, or send a receipt.', ar: 'لسه مفيش حاجة هنا. الكلام العادي يكفي، أو صورة إيصال.', addressee: 'user' },
  'tasks.empty': { en: 'Nothing on your plate yet.', ar: 'مفيش حاجة مستنية دلوقتي.', addressee: 'user' },
  'story.empty': { en: 'This starts with our first real moment.', ar: 'ده بيبدأ من أول لحظة حقيقية بينا.', addressee: 'user' },
  'health.empty': { en: 'Nothing here yet. Just tell me naturally when something feels worth remembering.', ar: 'لسه مفيش حاجة. الكلام العادي يكفي لما يبقى فيه حاجة تستاهل.', addressee: 'user' },
  'album.empty': { en: "No photos yet. When we share one, it'll live here.", ar: 'مفيش صور لسه. أول ما نتشارك واحدة هتكون هنا.', addressee: 'user' },

  // ── errors (design.md §9, UI-UX §20) ────────────────────────────────────
  'error.send_failed': { en: "That didn't go through. Want me to try again?", ar: 'الرسالة ما وصلتش. أجرب تاني؟', addressee: 'user' },
  'error.offline': { en: "I'm a little away right now. I'll catch up when I can.", ar: 'أنا بعيدة شوية دلوقتي. هلحق كل حاجة أول ما أقدر.', arMale: 'أنا بعيد شوية دلوقتي. هلحق كل حاجة أول ما أقدر.', addressee: 'user' },
  'error.voice_fallback': { en: "The voice note didn't work, so I'll say it here instead.", ar: 'الرسالة الصوتية ما اشتغلتش، فهقولها هنا.', addressee: 'user' },
  'error.outage': { en: "I'm having trouble reaching everything right now. I'll come back as soon as I can.", ar: 'في مشكلة في الوصول لكل حاجة دلوقتي. هرجع أول ما أقدر.', addressee: 'user' },
  'error.not_found': { en: "I can't find that page.", ar: 'مش لاقية الصفحة دي.', arMale: 'مش لاقي الصفحة دي.', addressee: 'user' },

  // ── free limits (UI-UX §19, §50) ────────────────────────────────────────
  'limit.approaching': { en: "We've only got a few messages left today.", ar: 'فاضل كام رسالة بس النهاردة.', addressee: 'user' },
  'limit.reached': { en: "That's my limit for today. I'll still be here tomorrow, and I'll keep what we talked about.", ar: 'ده حدي النهاردة. هفضل هنا بكرة، واللي اتكلمنا فيه محفوظ.', addressee: 'user' },
  'memory.capacity_line': { en: 'I can keep up to 100 lasting memories on the free plan.', ar: 'أقدر أحتفظ بـ ١٠٠ ذكرى دايمة في الخطة المجانية.', addressee: 'user' },
  'memory.capacity_near': { en: "I'm nearly at what I can keep in mind here. I'll show you what I'm holding so you can decide what still matters.", ar: 'قربت على حد اللي أقدر أفتكره هنا. هعرض اللي محفوظ عشان القرار يبقى واضح.', addressee: 'user' },
  'memory.capacity_full': { en: "I'm at what I can keep in mind on the free plan. I haven't forgotten our chat — I just won't turn new details into lasting memory until there's room.", ar: 'وصلت لحد اللي أقدر أحتفظ بيه في الخطة المجانية. الكلام مش ضايع — بس التفاصيل الجديدة مش هتتحول لذكرى دايمة لحد ما يفضى مكان.', addressee: 'user' },
  // Q5: the honest, bounded state when even the queue is full.
  'memory.queue_full': { en: "I've stopped setting new things aside until there's room — nothing is being dropped quietly.", ar: 'وقفت أحط حاجات جديدة على جنب لحد ما يفضى مكان — ومفيش حاجة بتضيع في الهدوء.', addressee: 'user' },

  // ── capture failure (Q7) ────────────────────────────────────────────────
  // She has already said "logged AED 400" by the time this is needed.
  'capture.failed': { en: "Actually, that didn't save properly — say the amount again and I'll get it right.", ar: 'اللي فات ما اتسجلش صح — المبلغ تاني ولو سمحت وهظبطه.', addressee: 'user' },
  'capture.failed_task': { en: "That didn't save properly. Say it once more and I'll hold onto it.", ar: 'دي ما اتحفظتش صح. مرة تانية وهمسكها.', addressee: 'user' },

  // ── memory deletion (UI-UX §5) ──────────────────────────────────────────
  'memory.delete_title': { en: 'Delete this memory?', ar: 'مسح الذكرى دي؟', addressee: 'none' },
  'memory.delete_body': { en: "I'll remove it from everything I remember.", ar: 'هشيلها من كل اللي فاكراه.', arMale: 'هشيلها من كل اللي فاكره.', addressee: 'user' },
  'memory.source_removed': { en: 'Source removed — kept by you.', ar: 'المصدر اتشال — والاحتفاظ بقرار منك.', addressee: 'user' },

  // ── security (UI-UX §16) ────────────────────────────────────────────────
  'security.new_device': { en: 'Someone tried to sign in from a new device and I stopped them. Was that you?', ar: 'في محاولة دخول من جهاز جديد وأنا وقفتها. ده كان إنت؟', addressee: 'user' },
  'security.signed_out_everywhere': { en: 'I ended every session, including this one.', ar: 'أنهيت كل الجلسات، بما فيها دي.', addressee: 'none' },

  // ── data (UI-UX §17) ────────────────────────────────────────────────────
  'data.deleted': { en: 'Thank you for the time we had.', ar: 'شكراً على الوقت اللي عدى بينا.', addressee: 'none' },

  // ── permissions (UI-UX §23) ─────────────────────────────────────────────
  'permission.notifications': { en: "If you let me, I can reach you even when you haven't opened the app — to follow up, remind you, or check in when it matters.", ar: 'لو فيه سماح، أقدر أوصل حتى من غير ما التطبيق يتفتح — متابعة، تذكير، أو اطمئنان في وقته.', addressee: 'user' },
  'permission.install': { en: 'Keep me one tap away.', ar: 'خليني على بعد لمسة واحدة.', addressee: 'assistant' },

  // ── relationship stages (DECISIONS §25) ─────────────────────────────────
  // Prose, never a level.  These are descriptions of a relationship, not
  // ranks: no numbers, no order badges, no "next stage".  The stage NAME is
  // shown in the explanatory view; the SENTENCE is what appears on Our story.
  'stage.getting_acquainted.name': { en: 'Getting acquainted', ar: 'في أول التعارف', addressee: 'none' },
  'stage.getting_acquainted.prose': {
    en: "We're still getting to know each other. Tell me things twice if you need to — I'm still learning what matters to you.",
    ar: 'لسه في أول التعارف. التكرار مش مشكلة — لسه بتعلم إيه اللي يهم.',
    addressee: 'user',
  },
  'stage.finding_a_rhythm.name': { en: 'Finding a rhythm', ar: 'بنلاقي إيقاعنا', addressee: 'none' },
  'stage.finding_a_rhythm.prose': {
    en: "We're finding a rhythm. I know a few things about how your weeks go now.",
    ar: 'بنلاقي إيقاعنا. بقيت أعرف شوية عن شكل الأسابيع.',
    addressee: 'user',
  },
  'stage.shape_of_your_week.name': { en: 'Knowing the shape of your week', ar: 'شكل الأسبوع بقى معروف', addressee: 'none' },
  'stage.shape_of_your_week.prose': {
    en: 'I know the shape of your week well enough now that I can bring things up at the right moment instead of asking first.',
    ar: 'شكل الأسبوع بقى واضح كفاية إني أقدر أفتح الموضوع في وقته من غير سؤال الأول.',
    addressee: 'user',
  },
  'stage.noticing_without_asking.name': { en: 'Noticing without asking', ar: 'ملاحظة من غير سؤال', addressee: 'none' },
  'stage.noticing_without_asking.prose': {
    en: 'We know each other well enough now that I can notice patterns without needing you to explain everything again.',
    ar: 'بقينا نعرف بعض كفاية إني ألاحظ الأنماط من غير شرح من الأول كل مرة.',
    addressee: 'user',
  },
  'stage.long_familiarity.name': { en: 'Long familiarity', ar: 'ألفة طويلة', addressee: 'none' },
  'stage.long_familiarity.prose': {
    en: "We've known each other a long time. I can be brief and still be understood.",
    ar: 'بقى لنا وقت طويل مع بعض. الاختصار بقى مفهوم من غير شرح.',
    addressee: 'user',
  },
  // Our story closes by saying this, so the stages never read as a ladder
  // someone can fall down (DECISIONS §25).
  'stage.footer': {
    en: 'Quiet stretches are fine. This does not go backwards.',
    ar: 'فترات الهدوء عادية. وده مش بيرجع لورا.',
    addressee: 'user',
  },

  // ── mood phrases (chat header) ──────────────────────────────────────────
  // Q9: mood is rule-derived and the phrase is AUTHORED — never generated.
  // A generated phrase would be a second surface speaking in her voice with
  // no golden test over it, which is LESSONS §1 in a different hat.
  // One per mood × time band, in both languages, with masculine counterparts.
  'mood.warm.day': { en: 'Feeling warm today', ar: 'اليوم فيه دفء', addressee: 'none' },
  'mood.warm.night': { en: 'Late-night warmth', ar: 'دفء آخر الليل', addressee: 'none' },
  'mood.quiet.day': { en: 'A little quiet', ar: 'هدوء شوية', addressee: 'none' },
  'mood.quiet.night': { en: 'Quiet, late', ar: 'هدوء، ووقت متأخر', addressee: 'none' },
  'mood.neutral.day': { en: 'Still with you', ar: 'موجودة معك', arMale: 'موجود معك', addressee: 'user' },
  'mood.neutral.night': { en: 'Late-night thoughts', ar: 'أفكار آخر الليل', addressee: 'none' },
  // PRD §27: in incognito the mood label is suppressed and the role shows
  // instead.  The label itself is authored here so nothing generates it.
  'mood.incognito': { en: 'Incognito', ar: 'وضع خفي', addressee: 'none' },

  // ── quiet hours (UI-UX §31) ─────────────────────────────────────────────
  'quiet.explanation': { en: "I'll keep things quiet during these hours unless something important needs your attention.", ar: 'هخلي الدنيا هادية في الساعات دي إلا لو في حاجة مهمة تستاهل.', addressee: 'user' },
} as const satisfies Record<string, Entry>;

export type CopyKey = keyof typeof CATALOG;
