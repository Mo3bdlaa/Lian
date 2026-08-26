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
