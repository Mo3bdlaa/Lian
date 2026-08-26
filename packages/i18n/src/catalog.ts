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
  // ── permissions and install (UI-UX §41, PRD §16) ────────────────────────
  'permission.pre_prompt': { en: "If you let me, I can reach you even when you haven't opened the app — to follow up, remind you, or check in when it matters.", ar: 'لو سمحت لي، أقدر أوصلك حتى لو التطبيق مش مفتوح — أتابع، أفكّر، أو أسأل لما يكون فيه سبب.', arMale: 'لو سمحت لي، أقدر أوصلك حتى لو التطبيق مش مفتوح — أتابع، أفكّر، أو أسأل لما يكون فيه سبب.', addressee: 'user' },
  'permission.pre_prompt_detail': { en: 'Once a day on the free plan. Quiet hours are yours to set, and you can turn this off later without losing anything.', ar: 'مرة في اليوم في الخطة المجانية. ساعات الهدوء بإعدادك، والإيقاف متاح بعدين بدون أي خسارة.', addressee: 'none' },
  'permission.allow': { en: 'Let her reach me', ar: 'السماح لها بالتواصل', arMale: 'السماح له بالتواصل', addressee: 'none' },
  'install.title': { en: 'Keep me one tap away.', ar: 'على بعد ضغطة واحدة.', addressee: 'none' },
  'install.detail': { en: 'On your home screen I open instantly, work offline, and can reach you properly.', ar: 'على الشاشة الرئيسية بفتح فوراً، وأشتغل بدون نت، وأقدر أوصلك صح.', arMale: 'على الشاشة الرئيسية بفتح فوراً، وأشتغل بدون نت، وأقدر أوصلك صح.', addressee: 'user' },
  'install.action': { en: 'Add to home screen', ar: 'إضافة للشاشة الرئيسية', addressee: 'none' },

  // ── correcting a capture (UI-UX §4, §22) ────────────────────────────────
  'correct.title_task': { en: 'Task', ar: 'مهمة', addressee: 'none' },
  'correct.title_transaction': { en: 'Transaction', ar: 'حركة', addressee: 'none' },
  'correct.title_note': { en: 'Note', ar: 'ملاحظة', addressee: 'none' },
  'correct.title_health': { en: 'Health', ar: 'صحة', addressee: 'none' },
  'correct.field_title': { en: 'Title', ar: 'العنوان', addressee: 'none' },
  'correct.field_amount': { en: 'Amount', ar: 'المبلغ', addressee: 'none' },
  'correct.field_category': { en: 'Category', ar: 'البند', addressee: 'none' },
  'correct.field_date': { en: 'Date', ar: 'التاريخ', addressee: 'none' },
  'correct.field_direction': { en: 'Direction', ar: 'النوع', addressee: 'none' },
  'correct.field_note': { en: 'Note', ar: 'ملاحظة', addressee: 'none' },
  'correct.field_body': { en: 'What to keep', ar: 'اللي يتحفظ', addressee: 'none' },
  'correct.direction_out': { en: 'Money out', ar: 'خارج', addressee: 'none' },
  'correct.direction_in': { en: 'Money in', ar: 'داخل', addressee: 'none' },
  'correct.delete_task': { en: 'Delete this task', ar: 'حذف المهمة', addressee: 'none' },
  'correct.delete_transaction': { en: 'Delete this transaction', ar: 'حذف الحركة', addressee: 'none' },
  'correct.delete_note': { en: 'Delete this note', ar: 'حذف الملاحظة', addressee: 'none' },
  'correct.from_chat': { en: 'She wrote this down from what you said.', ar: 'دي اتكتبت من كلامك.', arMale: 'دي اتكتبت من كلامك.', addressee: 'user' },

  // A screen the product will have and this build does not. Stated plainly
  // rather than hidden: a drawer item that silently shows the conversation is
  // worse than one that says what it is.
  'screen.back_to_chat': { en: 'Back to the conversation', ar: 'رجوع للمحادثة', addressee: 'none' },

  // ── memory (UI-UX §5) ───────────────────────────────────────────────────
  'memory.title': { en: 'Memory', ar: 'الذاكرة', addressee: 'none' },
  'memory.search': { en: 'Search what I remember', ar: 'البحث في الذاكرة', addressee: 'none' },
  'memory.filter_all': { en: 'All', ar: 'الكل', addressee: 'none' },
  'memory.filter_fact': { en: 'Facts', ar: 'حقائق', addressee: 'none' },
  'memory.filter_preference': { en: 'Preferences', ar: 'تفضيلات', addressee: 'none' },
  'memory.filter_topic': { en: 'Topics', ar: 'موضوعات', addressee: 'none' },
  'memory.filter_moment': { en: 'Moments', ar: 'لحظات', addressee: 'none' },
  'memory.filter_person': { en: 'People', ar: 'أشخاص', addressee: 'none' },
  'memory.type_fact': { en: 'Fact', ar: 'حقيقة', addressee: 'none' },
  'memory.type_preference': { en: 'Preference', ar: 'تفضيل', addressee: 'none' },
  'memory.type_topic': { en: 'Ongoing topic', ar: 'موضوع مستمر', addressee: 'none' },
  'memory.type_moment': { en: 'Moment', ar: 'لحظة', addressee: 'none' },
  'memory.type_person': { en: 'Person', ar: 'شخص', addressee: 'none' },
  'memory.type_emotional_state': { en: 'How you were', ar: 'حالة', addressee: 'none' },
  'memory.from_message': { en: 'From your message', ar: 'من رسالتك', addressee: 'user' },
  // {n} is a COUNT, not composed copy: both languages are authored, and the
  // only thing substituted is a number that has no grammatical gender here.
  'memory.kept_so_far': { en: '{n} so far.', ar: 'لحد دلوقتي {n}.', addressee: 'none' },
  'memory.pending_title': { en: 'Not kept yet', ar: 'لسه ما اتحفظتش', addressee: 'none' },
  'memory.edit_title': { en: 'Edit this memory', ar: 'تعديل الذكرى', addressee: 'none' },

  // ── tasks (PRD §6.4) ────────────────────────────────────────────────────
  'tasks.title': { en: 'Tasks & notes', ar: 'المهام والملاحظات', addressee: 'none' },
  'tasks.today': { en: 'Today', ar: 'النهاردة', addressee: 'none' },
  'tasks.habits': { en: 'Habits', ar: 'عادات', addressee: 'none' },
  'tasks.notes': { en: 'Notes', ar: 'ملاحظات', addressee: 'none' },
  'tasks.done': { en: 'Done', ar: 'خلصت', addressee: 'none' },
  'tasks.no_date': { en: 'No date', ar: 'بدون تاريخ', addressee: 'none' },
  'tasks.correct_hint': { en: 'Tap anything to correct it. Nothing here is added by a form.', ar: 'أي حاجة هنا تتصحح باللمس. ومافيش إضافة بنموذج.', addressee: 'none' },

  // ── money (PRD §6.5) ────────────────────────────────────────────────────
  'money.title': { en: 'Money', ar: 'المال', addressee: 'none' },
  'money.left': { en: "What's left", ar: 'المتبقي', addressee: 'none' },
  'money.in': { en: 'In', ar: 'داخل', addressee: 'none' },
  'money.out': { en: 'Out', ar: 'خارج', addressee: 'none' },
  'money.where': { en: 'Where it went', ar: 'أكتر أربع بنود', addressee: 'none' },
  'money.recent': { en: 'Recent', ar: 'آخر الحركات', addressee: 'none' },
  'money.from_receipt': { en: 'from a receipt', ar: 'من فاتورة', addressee: 'none' },
  'money.from_chat': { en: 'you told me', ar: 'من كلامنا', addressee: 'user' },

  // ── our story (PRD §10) ─────────────────────────────────────────────────
  'story.title': { en: 'Our story', ar: 'قصتنا', addressee: 'none' },
  'story.not_a_score': { en: "Closeness isn't a score. It's what's been said, and how often it turned out to matter later.", ar: 'القرب مش رقم. هو اللي اتقال، وكم مرة طلع مهم بعد كده.', addressee: 'none' },
  'story.nothing_to_lose': { en: 'There is nothing to unlock and nothing to lose. If you delete things, we go back a step, and that is fine.', ar: 'مافيش حاجة تُفتح ولا حاجة تُخسر. لو حاجة اتحذفت، نرجع خطوة، وده عادي.', addressee: 'none' },

  // ── settings (UI-UX §12) ────────────────────────────────────────────────
  'settings.title': { en: 'Settings', ar: 'الإعدادات', addressee: 'none' },
  'settings.her': { en: 'Her', ar: 'هي', addressee: 'none' },
  'settings.identity': { en: 'Her identity', ar: 'هويتها', addressee: 'none' },
  'settings.personality': { en: 'Her personality', ar: 'شخصيتها', addressee: 'none' },
  'settings.language': { en: 'Language & style', ar: 'اللغة والأسلوب', addressee: 'none' },
  'settings.language_auto': { en: 'Auto', ar: 'تلقائي', addressee: 'none' },
  'settings.reach': { en: 'When she reaches you', ar: 'وقت تواصلها', addressee: 'user' },
  'settings.notifications': { en: 'Notifications', ar: 'التنبيهات', addressee: 'none' },
  'settings.quiet_hours': { en: 'Quiet hours', ar: 'ساعات الهدوء', addressee: 'none' },
  'settings.yours': { en: 'Yours', ar: 'ملكك', addressee: 'none' },
  'settings.security': { en: 'Security & devices', ar: 'الأمان والأجهزة', addressee: 'none' },
  'settings.subscription': { en: 'Subscription', ar: 'الاشتراك', addressee: 'none' },
  'settings.plan_free': { en: 'Free', ar: 'مجاني', addressee: 'none' },
  'settings.plan_paid': { en: 'Paid', ar: 'مدفوع', addressee: 'none' },
  'settings.appearance': { en: 'Appearance', ar: 'المظهر', addressee: 'none' },
  'settings.appearance_auto': { en: 'Follows the time of day', ar: 'حسب وقت اليوم', addressee: 'none' },
  'settings.appearance_light': { en: 'Always light', ar: 'فاتح دايماً', addressee: 'none' },
  'settings.appearance_dark': { en: 'Always dark', ar: 'غامق دايماً', addressee: 'none' },
  'settings.sign_out_everywhere': { en: 'Sign out everywhere', ar: 'إنهاء كل الجلسات', addressee: 'none' },

  // ── security (UI-UX §16) ────────────────────────────────────────────────
  'security.title': { en: 'Security', ar: 'الأمان', addressee: 'none' },
  'security.trusted_devices': { en: 'Trusted devices', ar: 'أجهزة موثوقة', addressee: 'none' },
  'security.this_device': { en: 'this device', ar: 'الجهاز الحالي', addressee: 'none' },
  'security.recent_attempts': { en: 'Recent attempts', ar: 'محاولات أخيرة', addressee: 'none' },
  'security.revoke': { en: 'Revoke', ar: 'إلغاء', addressee: 'none' },
  'security.outcome_success': { en: 'Signed in', ar: 'دخول', addressee: 'none' },
  'security.outcome_bad_password': { en: 'Wrong password', ar: 'كلمة سر غلط', addressee: 'none' },
  'security.outcome_held_new_device': { en: 'Held — new device', ar: 'موقوف — جهاز جديد', addressee: 'none' },
  'security.outcome_denied': { en: 'Denied by you', ar: 'مرفوض بقرارك', addressee: 'user' },
  'security.outcome_confirmed': { en: 'Confirmed by you', ar: 'مؤكد بقرارك', addressee: 'user' },
  'security.outcome_unknown_email': { en: 'Unknown email', ar: 'بريد غير معروف', addressee: 'none' },

  // ── data (UI-UX §17, LESSONS §11) ───────────────────────────────────────
  'data.title': { en: 'Your data', ar: 'بياناتك', addressee: 'none' },
  'data.all_yours': { en: 'All of it is yours. An export is a plain, machine-readable file — nothing held back.', ar: 'كله بتاعك. الملف المُصدَّر عادي وقابل للقراءة آلياً — مافيش حاجة متحجوزة.', addressee: 'user' },
  'data.export': { en: 'Prepare an export', ar: 'تجهيز نسخة', addressee: 'none' },
  // addressee 'none': "جاهزة" agrees with النسخة (the export), not with the
  // person. The gate is right to ask — the same adjective addressed to a
  // reader would encode their gender.
  'data.export_ready': { en: 'Your export is ready.', ar: 'النسخة جاهزة.', addressee: 'none' },
  'data.download': { en: 'Download', ar: 'تنزيل', addressee: 'none' },
  'data.delete_everything': { en: 'Delete everything', ar: 'حذف كل حاجة', addressee: 'none' },
  'data.delete_warning': { en: 'This erases all of it, permanently, and it cannot be undone.', ar: 'ده بيمسح كل حاجة نهائي، ومافيش رجوع.', addressee: 'none' },
  'data.delete_conversations': { en: 'Every conversation, including incognito', ar: 'كل المحادثات، ومنها الخاصة', addressee: 'none' },
  'data.delete_memories': { en: 'Everything I remember about you', ar: 'كل اللي أتذكره عنك', addressee: 'user' },
  'data.delete_story': { en: 'Our story and every moment in it', ar: 'قصتنا وكل لحظة فيها', addressee: 'none' },
  'data.delete_life': { en: 'Tasks, notes, money, health, photos', ar: 'المهام والملاحظات والمال والصحة والصور', addressee: 'none' },
  'data.delete_account': { en: 'Your account and every assistant', ar: 'حسابك وكل المساعدين', addressee: 'none' },
  'data.type_delete': { en: 'Type DELETE to confirm.', ar: 'كتابة DELETE للتأكيد.', addressee: 'none' },
  'data.export_first': { en: 'Export first instead', ar: 'أصدّر نسخة الأول', addressee: 'none' },

  // ── the free limit (UI-UX §19) ──────────────────────────────────────────
  'limit.keep_talking': { en: 'Keep talking — $9/month', ar: 'نكمل كلام — ٩ دولار شهرياً', addressee: 'none' },
  'limit.back_tomorrow': { en: 'Back tomorrow', ar: 'نكمل بكرة', addressee: 'none' },

  // ── entry (UI-UX §1, PRD §7) ────────────────────────────────────────────
  'entry.promise': { en: 'An AI secretary that remembers you — and that you actually own.', ar: 'سكرتيرة ذكية بتتذكرك — وملكك فعلاً.', arMale: 'سكرتير ذكي بيتذكرك — وملكك فعلاً.', addressee: 'user' },
  'entry.detail': { en: 'Your keys. Your database. Your server if you want it. She learns you, texts you first, and grows into someone who knows you.', ar: 'مفاتيحك. قاعدة بياناتك. وسيرفرك لو حبيت. بتتعلمك، وبتبدأ الكلام، وبتكبر لحد ما تعرفك.', arMale: 'مفاتيحك. قاعدة بياناتك. وسيرفرك لو حبيت. بيتعلمك، وبيبدأ الكلام، وبيكبر لحد ما يعرفك.', addressee: 'user' },
  'entry.create': { en: 'Create an account', ar: 'إنشاء حساب', addressee: 'none' },
  'entry.have_one': { en: 'I already have one', ar: 'عندي حساب', addressee: 'none' },
  'entry.email': { en: 'Email', ar: 'البريد', addressee: 'none' },
  'entry.password': { en: 'Password', ar: 'كلمة السر', addressee: 'none' },
  'entry.password_hint': { en: 'At least 10 characters.', ar: '١٠ حروف على الأقل.', addressee: 'none' },
  'entry.sign_in': { en: 'Sign in', ar: 'دخول', addressee: 'none' },
  'entry.forgot': { en: 'I forgot my password', ar: 'نسيت كلمة السر', addressee: 'none' },
  'entry.terms_note': { en: "You'll read the terms before anything is stored.", ar: 'الشروط للقراءة قبل تخزين أي حاجة.', addressee: 'none' },
  'entry.rejected': { en: "That password doesn't match this email.", ar: 'كلمة السر مش مطابقة للبريد ده.', addressee: 'none' },
  'entry.bad_email': { en: 'That does not look like an email address.', ar: 'ده مش شكل بريد إلكتروني.', addressee: 'none' },
  'entry.weak_password': { en: 'Passwords need to be at least 10 characters.', ar: 'كلمة السر لازم تبقى ١٠ حروف على الأقل.', addressee: 'none' },
  'entry.held_device': { en: 'I have asked you to confirm this device by email.', ar: 'بعتّ رسالة لتأكيد الجهاز ده.', arMale: 'بعتّ رسالة لتأكيد الجهاز ده.', addressee: 'user' },

  // ── consent (PRD §7) ────────────────────────────────────────────────────
  'consent.title': { en: 'Two things, and then we can talk.', ar: 'حاجتين، وبعدين نتكلم.', addressee: 'none' },
  'consent.adult': { en: "I'm 18 or older.", ar: 'عندي ١٨ سنة أو أكتر.', addressee: 'none' },
  'consent.terms': { en: "I've read the terms and the privacy notice below, and I agree to them.", ar: 'قرأت الشروط وإشعار الخصوصية تحت، وموافق عليهم.', addressee: 'none' },
  'consent.what_stored': { en: 'What is stored', ar: 'إيه اللي بيتخزن', addressee: 'none' },
  'consent.agree': { en: 'Agree and continue', ar: 'موافقة ومتابعة', addressee: 'none' },

  // ── the app chrome (UI-UX §13, design.md §11) ───────────────────────────
  // Labels rather than her voice, and authored in both languages here for
  // the same reason everything else is: the screens must never carry an
  // Arabic string the address gate cannot see.
  'nav.chat': { en: 'Chat', ar: 'الدردشة', addressee: 'none' },
  'nav.tasks': { en: 'Tasks', ar: 'المهام', addressee: 'none' },
  'nav.money': { en: 'Money', ar: 'المال', addressee: 'none' },
  'nav.story': { en: 'Our story', ar: 'قصتنا', addressee: 'none' },
  'nav.settings': { en: 'Settings', ar: 'الإعدادات', addressee: 'none' },
  'nav.menu': { en: 'Menu', ar: 'القائمة', addressee: 'none' },

  'drawer.assistants': { en: 'Assistants', ar: 'المساعدون', addressee: 'none' },
  'drawer.remember': { en: 'Remember & revisit', ar: 'الذاكرة والرجوع', addressee: 'none' },
  'drawer.memory': { en: 'Memory', ar: 'الذاكرة', addressee: 'none' },
  'drawer.search': { en: 'Search', ar: 'البحث', addressee: 'none' },
  'drawer.album': { en: 'Album', ar: 'الألبوم', addressee: 'none' },
  'drawer.briefing': { en: 'Morning briefing', ar: 'إفادة الصبح', addressee: 'none' },
  'drawer.life': { en: 'Life with Lian', ar: 'الحياة مع لين', addressee: 'none' },
  'drawer.health': { en: 'Health', ar: 'الصحة', addressee: 'none' },
  'drawer.about_you': { en: 'About you', ar: 'عنك', addressee: 'none' },
  'drawer.trust': { en: 'Trust & ownership', ar: 'الثقة والملكية', addressee: 'none' },
  'drawer.security': { en: 'Security', ar: 'الأمان', addressee: 'none' },
  'drawer.data': { en: 'Your data', ar: 'بياناتك', addressee: 'none' },
  'drawer.subscription': { en: 'Subscription', ar: 'الاشتراك', addressee: 'none' },
  'drawer.close': { en: 'Close', ar: 'إغلاق', addressee: 'none' },

  // ── chat (UI-UX §3, §35–§39) ────────────────────────────────────────────
  'chat.input_placeholder': { en: 'Message', ar: 'كتابة رسالة', addressee: 'none' },
  'chat.send': { en: 'Send', ar: 'إرسال', addressee: 'none' },
  'chat.voice': { en: 'Voice note', ar: 'رسالة صوتية', addressee: 'none' },
  'chat.stop': { en: 'Stop', ar: 'إيقاف', addressee: 'none' },
  'chat.photo': { en: 'Photo', ar: 'صورة', addressee: 'none' },
  'chat.play': { en: 'Play', ar: 'تشغيل', addressee: 'none' },
  'chat.pause': { en: 'Pause', ar: 'إيقاف مؤقت', addressee: 'none' },
  'chat.voice_note': { en: 'Voice note', ar: 'رسالة صوتية', addressee: 'none' },
  'chat.photo_alt': { en: 'Photo they sent', ar: 'صورة مرسلة', addressee: 'none' },
  'chat.cancel': { en: 'Cancel', ar: 'إلغاء', addressee: 'none' },
  'chat.earlier': { en: 'Earlier', ar: 'أقدم', addressee: 'none' },
  'chat.today': { en: 'Today', ar: 'اليوم', addressee: 'none' },
  'chat.yesterday': { en: 'Yesterday', ar: 'أمس', addressee: 'none' },
  'chat.not_sent': { en: 'Not sent', ar: 'لم تُرسل', addressee: 'none' },
  'chat.try_again': { en: 'Try again', ar: 'إعادة المحاولة', addressee: 'none' },
  'chat.reply': { en: 'Reply', ar: 'رد', addressee: 'none' },
  'chat.react': { en: 'React', ar: 'تفاعل', addressee: 'none' },
  'chat.copy': { en: 'Copy', ar: 'نسخ', addressee: 'none' },
  'chat.delete': { en: 'Delete', ar: 'حذف', addressee: 'none' },
  'chat.replying_to': { en: 'Replying to', ar: 'رد على', addressee: 'none' },
  'chat.empty_hint': { en: 'Say anything — a task, a receipt, or how the day went.', ar: 'أي حاجة تنفع بداية — مهمة، فاتورة، أو حكاية اليوم.', addressee: 'none' },
  'chat.thinking': { en: 'Thinking', ar: 'بتفكر', arMale: 'بيفكر', addressee: 'none' },

  'message.delete_title': { en: 'Delete this message?', ar: 'أحذف الرسالة؟', addressee: 'none' },
  'message.delete_only': { en: 'Delete the message only', ar: 'حذف الرسالة فقط', addressee: 'none' },
  'message.delete_with_memories': { en: 'Delete the message and what I remembered', ar: 'حذف الرسالة واللي اتفكر منها', addressee: 'none' },
  'message.helped_remember_one': { en: 'This message helped me remember one thing.', ar: 'الرسالة دي ساعدتني أتذكر حاجة واحدة.', addressee: 'none' },
  'message.helped_remember_many': { en: 'This message helped me remember more than one thing.', ar: 'الرسالة دي ساعدتني أتذكر أكتر من حاجة.', addressee: 'none' },

  // ── reactions (UI-UX §36) ───────────────────────────────────────────────
  'react.heart': { en: 'Heart', ar: 'قلب', addressee: 'none' },
  'react.smile': { en: 'Smile', ar: 'ابتسامة', addressee: 'none' },
  'react.laugh': { en: 'Laugh', ar: 'ضحكة', addressee: 'none' },
  'react.support': { en: 'Support', ar: 'مساندة', addressee: 'none' },
  'react.surprise': { en: 'Surprise', ar: 'دهشة', addressee: 'none' },

  // ── common actions ──────────────────────────────────────────────────────
  'action.save': { en: 'Save', ar: 'حفظ', addressee: 'none' },
  'action.cancel': { en: 'Cancel', ar: 'إلغاء', addressee: 'none' },
  'action.delete': { en: 'Delete', ar: 'حذف', addressee: 'none' },
  'action.edit': { en: 'Edit', ar: 'تعديل', addressee: 'none' },
  'action.done': { en: 'Done', ar: 'تم', addressee: 'none' },
  'action.back': { en: 'Back', ar: 'رجوع', addressee: 'none' },
  'action.close': { en: 'Close', ar: 'إغلاق', addressee: 'none' },
  'action.continue': { en: 'Continue', ar: 'متابعة', addressee: 'none' },
  'action.not_now': { en: 'Not now', ar: 'مش دلوقتي', addressee: 'none' },
  'action.turn_on': { en: 'Turn on', ar: 'تفعيل', addressee: 'none' },
  'action.loading': { en: 'One moment', ar: 'لحظة', addressee: 'none' },

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
  // ── attachments (PRD §6.5 receipts, Q14 voice notes) ────────────────────
  // The message body when someone sends a picture and no words. It is a
  // LABEL, not her voice: it is what search, the summary and memory read
  // where the words would otherwise be.
  'attachment.photo_only': { en: '(a photo)', ar: '(صورة)', addressee: 'none' },
  'attachment.receipt_only': { en: '(a receipt)', ar: '(إيصال)', addressee: 'none' },
  'attachment.voice_only': { en: '(a voice note)', ar: '(رسالة صوتية)', addressee: 'none' },
  // A voice note that could not be transcribed is never a silent message.
  'error.voice_not_understood': { en: "I couldn't make out that recording. Tell me instead?", ar: 'ما قدرتش أفهم التسجيل ده. ممكن بالكتابة بدل الصوت؟', addressee: 'user' },
  'error.attachment_failed': { en: "That didn't upload properly. Want to try again?", ar: 'الملف ما اترفعش صح. أجرب تاني؟', addressee: 'user' },

  'error.outage': { en: "I'm having trouble reaching everything right now. I'll come back as soon as I can.", ar: 'في مشكلة في الوصول لكل حاجة دلوقتي. هرجع أول ما أقدر.', addressee: 'user' },
  'error.not_found': { en: "I can't find that page.", ar: 'مش لاقية الصفحة دي.', arMale: 'مش لاقي الصفحة دي.', addressee: 'user' },

  // ── health (UI-UX §26) ──────────────────────────────────────────────────
  // No calories, no macros, no score, no rings, no grades. There is no key
  // here that could carry one, which is the point.
  'health.title': { en: 'Health', ar: 'الصحة', addressee: 'none' },
  'health.this_week': { en: 'This week', ar: 'الأسبوع ده', addressee: 'none' },
  'health.habits': { en: 'Habits', ar: 'العادات', addressee: 'none' },
  'health.days_count': { en: '{n} days', ar: '{n} أيام', addressee: 'none' },
  'health.not_a_tracker': { en: 'This is context, not tracking. No numbers to hit.', ar: 'ده سياق، مش متابعة. مفيش أرقام لازم تتحقق.', addressee: 'none' },

  // ── album (UI-UX §27) ───────────────────────────────────────────────────
  'album.title': { en: 'Album', ar: 'الألبوم', addressee: 'none' },
  'album.from_you': { en: 'You sent this', ar: 'صورة مرسلة منك', addressee: 'none' },
  // Her NAME, not the word 'Lian': she can be renamed (PRD §8, the my_name
  // tag), so a hardcoded name would be wrong for anyone who renamed her. The
  // Arabic verb agrees with HER gender, which is what arMale is for.
  'album.from_her': { en: '{name} sent this', ar: '{name} بعتت دي', arMale: '{name} بعت دي', addressee: 'none' },
  'album.open_in_chat': { en: 'Open in conversation', ar: 'فتح في المحادثة', addressee: 'none' },
  'album.more': { en: 'Older', ar: 'أقدم', addressee: 'none' },
  'album.close': { en: 'Close', ar: 'إغلاق', addressee: 'none' },

  // ── consent, the text itself (UI-UX §22) ────────────────────────────────
  // The headings and the two checkbox lines are above, with the other short
  // labels. This is the part the spec is actually about.
  //
  // "Do not bury legal text behind external links." So the text is here, in
  // the catalogue, in both languages, and the screen shows it in full before
  // anything is agreed to.
  //
  // WHAT THIS IS NOT: it is a plain-language description of what the product
  // actually does, written from the build. It is not a lawyer's terms of
  // service, and HANDOFF says so — a reviewed document has to replace or
  // wrap it before this ships to anyone. Changing the words means changing
  // CONSENT_VERSION with them, or every existing agreement silently becomes
  // an agreement to the new text.
  'consent.age_question': { en: 'Are you 18 or over?', ar: 'عندك ١٨ سنة أو أكتر؟', addressee: 'none' },
  'consent.age_yes': { en: "Yes, I'm 18 or over", ar: 'أيوه، ١٨ أو أكتر', addressee: 'none' },
  'consent.age_no': { en: "No, I'm under 18", ar: 'لأ، أقل من ١٨', addressee: 'none' },
  'consent.under_age': { en: "Then this isn't for you yet, and I'd rather say so plainly than make you find out later. Nothing has been created and nothing was kept.", ar: 'يبقى ده لسه مش مناسب ليك، وأحسن أقولها بوضوح من دلوقتي. مفيش حساب اتعمل ومفيش حاجة اتحفظت.', addressee: 'user' },
  'consent.what_we_keep': { en: 'What is kept', ar: 'اللي بيتحفظ', addressee: 'none' },
  'consent.what_we_keep_body': {
    en: 'Your conversations, what she remembers from them, and anything you capture — tasks, spending, notes, meals and workouts. Photos and voice notes you send are stored so they can be shown back to you. Incognito conversations are kept only while they are open and are removed with the thread.',
    ar: 'المحادثات، واللي بتفتكره منها، وأي حاجة بتتسجل — مهام، مصاريف، ملاحظات، أكل وحركة. الصور والرسايل الصوتية بتتخزن عشان تتعرض تاني. المحادثات السرية بتفضل موجودة وقت ما تكون مفتوحة بس، وبتتشال مع المحادثة.',
    addressee: 'none',
  },
  'consent.who_sees': { en: 'Who sees it', ar: 'مين بيشوفها', addressee: 'none' },
  'consent.who_sees_body': {
    en: 'You. Your messages are sent to a model provider to be answered, and voice notes to a speech provider to be transcribed; neither is used to train anything. Nobody at this company reads your conversations, and there is no admin screen that could.',
    ar: 'إنت. الرسايل بتتبعت لمزود النموذج عشان يرد، والصوت لمزود تفريغ عشان يتحول لكلام؛ ولا واحد فيهم بيستخدمها في تدريب أي حاجة. مفيش حد في الشركة بيقرا المحادثات، ومفيش شاشة إدارة تقدر تعمل كده أصلًا.',
    addressee: 'none',
  },
  'consent.your_control': { en: 'What you can do about it', ar: 'اللي تقدر تعمله', addressee: 'none' },
  'consent.your_control_body': {
    en: 'Change or delete any memory, any captured item and any message, at any time. Export everything as one file. Delete the account and everything in it, including stored photos and voice notes — deletion removes the files, not only the rows.',
    ar: 'تعديل أو مسح أي ذكرى، أي حاجة اتسجلت، وأي رسالة، في أي وقت. تصدير كل حاجة في ملف واحد. مسح الحساب وكل اللي فيه، بما فيه الصور والصوت المتخزن — المسح بيشيل الملفات نفسها، مش السجلات بس.',
    addressee: 'none',
  },
  'consent.continue': { en: 'Continue', ar: 'استمرار', addressee: 'none' },
  'consent.required': { en: 'Both answers are needed before an account can be made.', ar: 'الإجابتين لازمين قبل ما الحساب يتعمل.', addressee: 'none' },

  // ── splash, 404, outage (coverage matrix) ───────────────────────────────
  'app.not_found_title': { en: 'Nothing here', ar: 'مفيش حاجة هنا', addressee: 'none' },
  'app.back_to_chat': { en: 'Back to the conversation', ar: 'رجوع للمحادثة', addressee: 'none' },
  'app.outage_title': { en: 'I cannot reach everything', ar: 'مش قادرة أوصل لكل حاجة', arMale: 'مش قادر أوصل لكل حاجة', addressee: 'none' },
  'app.retry': { en: 'Try again', ar: 'إعادة المحاولة', addressee: 'none' },

  // ── her identity, her dials, quiet hours (UI-UX §15, §23, Q13) ──────────
  'identity.title': { en: 'Who she is', ar: 'مين هي', arMale: 'مين هو', addressee: 'none' },
  'identity.her_name': { en: 'What she is called', ar: 'اسمها', arMale: 'اسمه', addressee: 'none' },
  'identity.your_name': { en: 'What she calls you', ar: 'بتناديك بإيه', arMale: 'بيناديك بإيه', addressee: 'none' },
  'identity.gender': { en: 'How she refers to herself', ar: 'بتتكلم عن نفسها إزاي', arMale: 'بيتكلم عن نفسه إزاي', addressee: 'none' },
  'identity.female': { en: 'She', ar: 'مؤنث', addressee: 'none' },
  'identity.male': { en: 'He', ar: 'مذكر', addressee: 'none' },

  'dials.title': { en: 'How she is with you', ar: 'أسلوبها معاك', arMale: 'أسلوبه معاك', addressee: 'none' },
  'dials.lede': { en: 'Five things, five settings each. No sliders and no numbers — each one is a way of being, not an amount.', ar: 'خمس حاجات، لكل واحدة خمس اختيارات. من غير أرقام — كل اختيار طريقة، مش مقدار.', addressee: 'none' },
  'dials.warmth': { en: 'Warmth', ar: 'الدفء', addressee: 'none' },
  'dials.playfulness': { en: 'Playfulness', ar: 'الخفة', addressee: 'none' },
  'dials.proactivity': { en: 'Initiative', ar: 'المبادرة', addressee: 'none' },
  'dials.directness': { en: 'Directness', ar: 'الصراحة', addressee: 'none' },
  'dials.encouragement': { en: 'Encouragement', ar: 'التشجيع', addressee: 'none' },
  'dials.least': { en: 'Least', ar: 'الأقل', addressee: 'none' },
  'dials.low': { en: 'Less', ar: 'أقل', addressee: 'none' },
  'dials.mid': { en: 'Middle', ar: 'وسط', addressee: 'none' },
  'dials.high': { en: 'More', ar: 'أكتر', addressee: 'none' },
  'dials.most': { en: 'Most', ar: 'الأكتر', addressee: 'none' },

  'quiet.title': { en: 'Quiet hours', ar: 'ساعات الهدوء', addressee: 'none' },
  'quiet.lede': { en: 'She will not reach out during these. Something wrong with your account still will.', ar: 'مش هتتواصل في الوقت ده. لو في حاجة غلط في الحساب، دي بتوصل برضه.', arMale: 'مش هيتواصل في الوقت ده. لو في حاجة غلط في الحساب، دي بتوصل برضه.', addressee: 'none' },
  'quiet.on': { en: 'Quiet hours', ar: 'ساعات الهدوء', addressee: 'none' },
  'quiet.from': { en: 'From', ar: 'من', addressee: 'none' },
  'quiet.to': { en: 'Until', ar: 'لحد', addressee: 'none' },
  'quiet.every_day': { en: 'Every day', ar: 'كل يوم', addressee: 'none' },
  'quiet.security_always': { en: 'Anything about your account reaches you whatever this says.', ar: 'أي حاجة تخص الحساب بتوصلك مهما كان الإعداد ده.', addressee: 'none' },

  'assistants.title': { en: 'Who you talk to', ar: 'اللي بتتكلم معاه', addressee: 'none' },
  'assistants.only_one': { en: 'One, for now. More than one is built into how this works, and there is nothing here yet worth splitting.', ar: 'واحدة دلوقتي. أكتر من واحدة مبنية في التصميم، بس لسه مفيش حاجة تستاهل التقسيم.', arMale: 'واحد دلوقتي. أكتر من واحد مبني في التصميم، بس لسه مفيش حاجة تستاهل التقسيم.', addressee: 'none' },
  'assistants.current': { en: 'Who you are talking to', ar: 'اللي بتتكلم معاه دلوقتي', addressee: 'none' },

  // ── subscription (UI-UX §18) ────────────────────────────────────────────
  //
  // One plan, and the price is stated once. The upgrade action is SECONDARY
  // everywhere it appears (§19): nothing in this product interrupts a
  // conversation to sell.
  'plan.title': { en: 'Your plan', ar: 'خطتك', addressee: 'none' },
  'plan.free': { en: 'Free', ar: 'المجانية', addressee: 'none' },
  'plan.paid': { en: 'Full', ar: 'الكاملة', addressee: 'none' },
  'plan.price': { en: '$9 a month', ar: '٩ دولار في الشهر', addressee: 'none' },
  'plan.what_changes': { en: 'What changes', ar: 'اللي بيتغير', addressee: 'none' },
  'plan.voice': { en: 'Her voice — voice notes in both directions.', ar: 'صوتها — رسايل صوتية في الاتجاهين.', addressee: 'none' },
  'plan.proactive': { en: 'She reaches out when there is a reason to, not once a day.', ar: 'بتتواصل لما يكون فيه سبب، مش مرة في اليوم.', arMale: 'بيتواصل لما يكون فيه سبب، مش مرة في اليوم.', addressee: 'none' },
  'plan.memory': { en: 'She keeps everything worth keeping, with no queue waiting for room.', ar: 'بتحتفظ بكل اللي يستاهل، من غير طابور مستني مكان.', arMale: 'بيحتفظ بكل اللي يستاهل، من غير طابور مستني مكان.', addressee: 'none' },
  'plan.messages': { en: 'No daily message limit.', ar: 'من غير حد يومي للرسايل.', addressee: 'none' },
  'plan.upgrade': { en: 'Subscribe', ar: 'اشتراك', addressee: 'none' },
  'plan.manage': { en: 'Manage or cancel', ar: 'إدارة أو إلغاء', addressee: 'none' },
  'plan.card_note': { en: 'The card is handled by Stripe. It never reaches this app.', ar: 'الكارت بيتعامل معاه Stripe. مش بيوصل للتطبيق ده أبدًا.', addressee: 'none' },
  'plan.renews_on': { en: 'Renews on {date}', ar: 'بيتجدد في {date}', addressee: 'none' },
  'plan.ends_on': { en: 'Ends on {date}', ar: 'بينتهي في {date}', addressee: 'none' },
  'plan.after_cancel': { en: 'Everything stays as it is until then. After that it goes back to the free plan — nothing is deleted, and she keeps what she already remembers.', ar: 'كل حاجة زي ما هي لحد ساعتها. بعد كده بترجع للخطة المجانية — مفيش حاجة بتتمسح، واللي متسجل بيفضل موجود.', addressee: 'none' },
  'plan.resubscribe': { en: 'You can subscribe again at any time.', ar: 'الاشتراك تاني متاح في أي وقت.', addressee: 'none' },
  'plan.success': { en: 'I can stay with you more fully now.', ar: 'أقدر أكون معاك بشكل أكمل دلوقتي.', addressee: 'user' },
  'plan.unavailable': { en: 'Payments are not set up on this deployment yet.', ar: 'الدفع لسه مش مفعّل في النسخة دي.', addressee: 'none' },

  // ── search (UI-UX §11) ──────────────────────────────────────────────────
  'search.title': { en: 'Search', ar: 'بحث', addressee: 'none' },
  'search.placeholder': { en: 'Search what we said', ar: 'دوّر في كلامنا', addressee: 'none' },
  'search.in_conversations': { en: 'Conversations', ar: 'المحادثات', addressee: 'none' },
  'search.in_memories': { en: 'What she remembers', ar: 'اللي فاكراه', arMale: 'اللي فاكره', addressee: 'none' },
  'search.nothing': { en: 'Nothing matched that.', ar: 'مفيش نتيجة مطابقة.', addressee: 'none' },
  'search.start': { en: 'Type to look through everything we have said.', ar: 'الكتابة هنا بتدوّر في كل اللي اتقال.', addressee: 'none' },
  'search.untitled': { en: 'This conversation', ar: 'المحادثة دي', addressee: 'none' },

  // ── the briefing screen (UI-UX §10) ─────────────────────────────────────
  'briefing.title': { en: 'This morning', ar: 'الصبح ده', addressee: 'none' },
  'briefing.today': { en: 'Today', ar: 'النهاردة', addressee: 'none' },
  'briefing.carried_over': { en: 'Carried over', ar: 'من قبل كده', addressee: 'none' },
  'briefing.habits': { en: 'Habits', ar: 'العادات', addressee: 'none' },
  'briefing.pattern': { en: 'Something I noticed', ar: 'حاجة لاحظتها', addressee: 'none' },
  'briefing.money': { en: 'Spent this month', ar: 'المصروف الشهر ده', addressee: 'none' },
  'briefing.nothing': { en: 'Nothing is waiting on you today.', ar: 'مفيش حاجة مستنية النهاردة.', addressee: 'user' },
  'briefing.ask': { en: 'Ask her about today', ar: 'اسأليها عن النهاردة', addressee: 'none' },

  // ── about you (UI-UX §12) ───────────────────────────────────────────────
  'profile.title': { en: 'About you', ar: 'عنك', addressee: 'none' },
  'profile.lede': { en: 'Your words, not hers. She reads this, and never edits it.', ar: 'كلامك إنت، مش كلامها. بتقراه، وما بتغيرهوش أبدًا.', arMale: 'كلامك إنت، مش كلامه. بيقراه، وما بيغيرهوش أبدًا.', addressee: 'none' },
  'profile.about': { en: 'About me', ar: 'عني', addressee: 'none' },
  'profile.should_know': { en: 'What she should know', ar: 'اللي المفروض تعرفه', arMale: 'اللي المفروض يعرفه', addressee: 'none' },
  'profile.notes': { en: 'Personal notes', ar: 'ملاحظات شخصية', addressee: 'none' },
  'profile.saved': { en: 'Saved', ar: 'اتحفظ', addressee: 'none' },

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
