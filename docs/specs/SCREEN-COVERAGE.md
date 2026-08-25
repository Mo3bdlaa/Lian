# Lian — Screen Coverage Matrix

Status: ✅ purpose-built · ◐ standard desktop fallback

| Area | Mobile | Desktop | RTL | Key states |
|---|---:|---:|---:|---|
| Chat | ✅ | ✅ | ✅ | thinking, streaming, retry, offline, reply, reactions, voice, history, delete/provenance |
| Tasks & notes | ✅ | ◐ | ✅ | empty, recurring, edit task/note, delete |
| Money | ✅ | ✅ | ✅ | summary, correction, receipt, empty |
| Memory | ✅ | ✅ | ✅ | full, empty, add, edit, delete, search, provenance, free-limit queue |
| Our story | ✅ | ◐ | ✅ | timeline, earned stages, empty |
| Health | ✅ | ◐ | ✅ | chat capture, week, correction, empty |
| Album | ✅ | ◐ | ✅ | grid, user sends, assistant sends, viewer, empty |
| Assistants | ✅ | ◐ | ✅ | single-assistant state, create second, switch (2+), active identity, gender, profile |
| Settings | ✅ | ◐ | ✅ | quiet hours, language/style, personality, voice |
| Security | ✅ | ◐ | ✅ | chat alert, devices, attempts, revoke, quick lock |
| Data | ✅ | ◐ | ✅ | export, ready, delete, completion |
| Account | ✅ | ◐ | ✅ | welcome, signup, signin, reset, errors |
| Consent | ✅ | ◐ | ✅ | 18+, legal text, agreement, under-18 |
| Subscription | ✅ | ◐ | ✅ | checkout, success, manage, cancel |
| Notifications & permissions | ✅ | ◐ | ✅ | pre-prompt, OS dialog, lock screen, in-app |
| PWA install | ✅ | ◐ | ✅ | pre-prompt, native install, first installed launch |
| Splash / 404 / outage | ✅ | ◐ | ✅ | startup, not found, unavailable |
| Onboarding conversation | ✅ | ◐ | ✅ | introduction, naming, Auto/language, first remembered detail |
| Morning briefing | ✅ | ◐ | ✅ | proactive, requested, chat, dedicated screen |
| Search | ✅ | ◐ | ✅ | conversations, grouped results, open in place, memory search |
| User profile | ✅ | ◐ | ✅ | name, about me, what assistant should know, self-authored notes |
| Free limit | ✅ | ◐ | ✅ | message limit approaching/reached, memory capacity approaching/full (100 per assistant), pending memories, quiet upgrade |
| Conversation types | ✅ | ◐ | ✅ | main, side, incognito, scenario role, edit/clear, switcher |
| Navigation drawer / rail | ✅ | ✅ | ✅ | grouped secondary nav, assistant header, open/close, desktop rail |

## Desktop fallback rule

Every `◐` row uses persistent left rail + centered 720px main column at 900px+ (800px for legal/long-form), no bottom navigation, desktop dialogs/side sheets, and RTL mirroring. Only Chat, Money, Memory require purpose-built wide layouts for v1.
