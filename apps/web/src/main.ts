// The client.
//
// One module boots the app: it fetches the snapshot, renders the screen for
// the current path, and delegates every click from one listener. There is no
// framework, and the reason is the same as everywhere else in this
// repository — a build step and a runtime dependency are a deployment story,
// and this product is sold on running on your own server.
//
// Rendering is by region: header, screen, composer, nav, overlays. A region
// is replaced wholesale from state; the composer keeps its own input value
// across renders, because replacing a field somebody is typing into is the
// thing this approach gets wrong if nobody says so.
import { get, patch as patch_, post, remove, stream, upload, newKey, ApiError } from './api.ts';
import { current, set, subscribe, type Message, type Snapshot, type State } from './state.ts';
import { match, tabFor } from './router.ts';
import { html, render, type Html } from './dom.ts';
import { t } from './copy.ts';
import { applyTheme as writeTheme, THEME_COOKIE, DIRECTION_COOKIE, type ThemeName } from '@lian/design';
import { head } from './components/head.ts';
import { nav } from './components/nav.ts';
import { drawer } from './components/drawer.ts';
import { chatScreen, composer, recorder, actionSheet, deleteSheet, thinking, permissionCard, installCard } from './screens/chat.ts';
import { welcome, signUp, signIn, heldDevice } from './screens/entry.ts';
import { memoryScreen, memoryEditor, memoryDeleteSheet, type Memory, type MemoryState } from './screens/memory.ts';
import { tasksScreen, moneyScreen, storyScreen, type Task, type Note, type Money, type Story } from './screens/life.ts';
import { settingsScreen, securityScreen, dataScreen, notBuilt, type Security, type DataState } from './screens/trust.ts';
import { correctionSheet, type Correcting, type CorrectKind } from './screens/correct.ts';

const root = document.getElementById('app')!;

function regions(): { head: HTMLElement; screen: HTMLElement; composer: HTMLElement; nav: HTMLElement; overlays: HTMLElement } {
  // Rebuilt whenever the regions are not there — which includes coming back
  // from an entry screen, since those replace the root wholesale. Checking
  // `childElementCount` instead was the bug that made a deep link render
  // nothing at all: the entry markup counted as children, so the regions
  // were never created and every paint wrote to null.
  if (document.getElementById('r-screen') === null) {
    root.innerHTML = `<div id="r-head"></div><div id="r-screen" class="screen"></div><div id="r-composer"></div><div id="r-nav"></div><div id="r-overlays"></div>`;
  }
  return {
    head: document.getElementById('r-head')!,
    screen: document.getElementById('r-screen')!,
    composer: document.getElementById('r-composer')!,
    nav: document.getElementById('r-nav')!,
    overlays: document.getElementById('r-overlays')!,
  };
}

const paint = (element: HTMLElement, markup: Html | string): void => {
  element.innerHTML = typeof markup === 'string' ? markup : render(markup);
};

let lastPath = '';

/** The screens that exist before there is an account. */
const ENTRY: Record<string, (state: { language: 'en' | 'ar'; error: string | null; busy: boolean }) => Html> = {
  welcome, signUp, signIn, confirmDevice: heldDevice,
};

function draw(state: State): void {
  const screen = match(state.path)?.screen ?? 'chat';
  const me = state.me;

  const entry = ENTRY[screen];
  if (me === null || entry !== undefined) {
    // Before there is an account there is no header, no nav and no drawer —
    // just the screen.
    const language = me?.user.language ?? (document.documentElement.getAttribute('dir') === 'rtl' ? 'ar' : 'en');
    // What is already typed survives the re-render. The first draw happens
    // before /api/me answers, and the answer draws again — without this,
    // anyone typing quickly has their email erased under them.
    const typed = new Map<string, string>();
    for (const field of root.querySelectorAll('input')) typed.set(field.name, field.value);
    root.innerHTML = render((entry ?? welcome)({ language, error: state.error, busy: state.busy }));
    for (const field of root.querySelectorAll('input')) {
      const value = typed.get(field.name);
      if (value !== undefined && value !== '') field.value = value;
    }
    return;
  }
  const where = regions();

  paint(where.head, head(me));
  where.screen.className = `screen ${screen === 'chat' ? 'screen--chat' : ''}`;
  paint(where.screen, screenFor(screen, state, me));
  if (screen === 'chat' && state.busy && state.messages.some((message) => message.pending === 'sending')) {
    where.screen.insertAdjacentHTML('beforeend', render(thinking(me)));
  }
  if (screen === 'chat' && me.onboarding?.step === 'ask_notification_permission' && !dismissed.permission) {
    where.screen.insertAdjacentHTML('beforeend', render(permissionCard(me)));
  } else if (screen === 'chat' && installPrompt !== null && !dismissed.install) {
    // One at a time: the permission comes first, and the install prompt waits
    // until it is answered.
    where.screen.insertAdjacentHTML('beforeend', render(installCard(me)));
  }

  // The composer belongs to the conversation and nowhere else.
  if (screen !== 'chat') {
    where.composer.innerHTML = '';
    where.composer.dataset['key'] = 'none';
  }
  // It is only re-rendered when its own shape changes, so typing survives a
  // message arriving.
  const composerKey = screen === 'chat' ? `chat:${state.replyTo?.id ?? ''}` : 'none';
  if (screen === 'chat' && recording !== null) {
    paint(where.composer, recorder(state, Math.floor((Date.now() - recording.startedAt) / 1000)));
    where.composer.dataset['key'] = 'recording';
  } else if (screen === 'chat' && where.composer.dataset['key'] !== composerKey) {
    const value = (where.composer.querySelector('.composer__input') as HTMLInputElement | null)?.value ?? '';
    paint(where.composer, composer(state));
    where.composer.dataset['key'] = composerKey;
    const input = where.composer.querySelector('.composer__input') as HTMLInputElement | null;
    if (input !== null && value !== '') input.value = value;
  }

  paint(where.nav, nav(me, state.path));

  const overlays: string[] = [];
  if (state.drawerOpen) overlays.push(render(drawer(me)));
  if (screenData.correcting !== null) overlays.push(render(correctionSheet(me, screenData.correcting)));
  if (screenData.editing !== null) overlays.push(render(memoryEditor(memoryState(state, me))));
  if (screenData.deleting !== null) overlays.push(render(memoryDeleteSheet(memoryState(state, me))));
  if (state.acting !== null) {
    const message = state.messages.find((candidate) => candidate.id === state.acting!.id);
    overlays.push(render(state.acting.mode === 'delete' as string
      ? deleteSheet(state, message!)
      : actionSheet(state)));
  }
  paint(where.overlays, overlays.join(''));

  if (state.path !== lastPath || screen === 'chat') {
    lastPath = state.path;
    if (screen === 'chat') where.screen.scrollTop = where.screen.scrollHeight;
  }
}

/** What each screen has loaded. Kept beside the store rather than inside it
 *  so the chat's state stays readable. */
const screenData: {
  memories: Memory[]; query: string; filter: string; editing: Memory | null; deleting: Memory | null;
  tasks: { tasks: Task[]; notes: Note[] }; money: Money | null; story: Story | null;
  security: Security | null; data: DataState; correcting: Correcting | null;
} = {
  memories: [], query: '', filter: 'all', editing: null, deleting: null,
  tasks: { tasks: [], notes: [] }, money: null, story: null, security: null,
  data: { export: null, confirming: false, typed: '', busy: false }, correcting: null,
};

const memoryState = (state: State, me: Snapshot): MemoryState => ({
  me, memories: screenData.memories, query: screenData.query, filter: screenData.filter,
  editing: screenData.editing, deleting: screenData.deleting,
});

function screenFor(screen: string, state: State, me: Snapshot): Html {
  switch (screen) {
    case 'memory': return memoryScreen(memoryState(state, me));
    case 'tasks': return tasksScreen(me, screenData.tasks);
    case 'money': return screenData.money === null ? html`` : moneyScreen(me, screenData.money);
    case 'story': return screenData.story === null ? html`` : storyScreen(me, screenData.story);
    case 'settings': return settingsScreen(me);
    case 'security': return screenData.security === null ? html`` : securityScreen(me, screenData.security);
    case 'data': return dataScreen(me, screenData.data);
    case 'soon': return notBuilt(me);
    default: return chatScreen(state);
  }
}

/** Prompts the person has waved away this session. */
const dismissed = { permission: false, install: false };

/** The browser's install event, kept until they ask for it (UI-UX §41: the
 *  prompt is offered in her voice, not fired at them on load). */
let installPrompt: { prompt(): Promise<void> } | null = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as unknown as { prompt(): Promise<void> };
  draw(current());
});

subscribe(draw);

// ── navigation ────────────────────────────────────────────────────────────

function go(path: string, replace = false): void {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  set({ path, drawerOpen: false, acting: null });
  void load(path);
}

window.addEventListener('popstate', () => {
  set({ path: location.pathname, drawerOpen: false, acting: null });
  void load(location.pathname);
});

async function load(path: string): Promise<void> {
  const state = current();
  if (state.me === null) return;
  const screen = match(path)?.screen ?? 'chat';
  set({ busy: true });
  try {
    if (screen === 'chat' && state.messages.length === 0) await loadMessages();
    else if (screen === 'memory') screenData.memories = (await get<{ memories: Memory[] }>(`/api/memories${screenData.query === '' ? '' : `?q=${encodeURIComponent(screenData.query)}`}`)).memories;
    else if (screen === 'tasks') screenData.tasks = await get('/api/tasks');
    else if (screen === 'money') screenData.money = await get('/api/money');
    else if (screen === 'story') screenData.story = await get('/api/story');
    else if (screen === 'security') screenData.security = await get('/api/security');
  } finally {
    set({ busy: false });
  }
}

async function loadMessages(): Promise<void> {
  const me = current().me!;
  if (me.conversation === null) return;
  const page = await get<{ messages: Message[]; hasOlder: boolean }>(`/api/conversations/${me.conversation.id}/messages`);
  set({ messages: page.messages, hasOlder: page.hasOlder });
}

async function loadOlder(): Promise<void> {
  const state = current();
  const oldest = state.messages[0];
  if (oldest === undefined || state.me?.conversation == null) return;
  const where = regions().screen;
  const before = where.scrollHeight;
  const page = await get<{ messages: Message[]; hasOlder: boolean }>(
    `/api/conversations/${state.me.conversation.id}/messages?before_at=${encodeURIComponent(oldest.at)}&before_id=${oldest.id}`,
  );
  set({ messages: [...page.messages, ...state.messages], hasOlder: page.hasOlder });
  // UI-UX §38: preserve the exact position, never jump to the top.
  where.scrollTop = where.scrollHeight - before;
}

// ── she speaks first (PRD §9) ─────────────────────────────────────────────
//
// A proactive message arrives as a push when the app is closed. When it is
// OPEN, a notification is the wrong channel and the conversation is the right
// one — so the client asks what is new while the person is looking at it.
//
// Polling rather than a second stream: the turn already owns an SSE
// connection, and a persistent stream per open tab is a connection per tab to
// hold for a message that arrives a few times a day.
const CATCH_UP_SECONDS = 20;
let catchUp = 0;

function watchForHerMessages(): void {
  clearInterval(catchUp);
  catchUp = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const state = current();
    if (state.me === null || state.busy || tabFor(state.path) !== 'chat') return;
    void catchUpNow();
  }, CATCH_UP_SECONDS * 1000) as unknown as number;
}

async function catchUpNow(): Promise<void> {
  const state = current();
  const conversation = state.me?.conversation;
  const newest = state.messages.at(-1);
  if (conversation === undefined || conversation === null || newest === undefined) return;
  const page = await get<{ messages: Message[] }>(
    `/api/conversations/${conversation.id}/messages?since_at=${encodeURIComponent(newest.at)}&since_id=${newest.id}`,
  );
  if (page.messages.length === 0) return;
  set({ messages: [...current().messages, ...page.messages] });
  // Her mood may have moved with it, and the header shows the mood.
  await refresh();
}

// Coming back to the tab is the moment worth checking immediately: she may
// have said something while it was in the background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void catchUpNow().catch(() => {});
});

// ── a turn ────────────────────────────────────────────────────────────────

async function send(text: string, attachment: { id: string; kind: string; contentType: string } | null = null): Promise<void> {
  const state = current();
  const me = state.me!;
  // A photograph with no words is a whole message; empty is only empty when
  // there is nothing attached either.
  if (me.conversation === null || (text.trim() === '' && attachment === null)) return;

  const clientId = newKey();
  const mine: Message = {
    id: clientId, role: 'user', body: text, at: new Date().toISOString(), surface: null,
    captures: [], reaction: null, memoriesDerived: 0,
    attachments: attachment === null ? [] : [attachment],
    replyTo: state.replyTo === null ? null : { id: state.replyTo.id, role: state.replyTo.role, body: state.replyTo.body },
    pending: 'sending',
  };
  const hers: Message = {
    id: `${clientId}-hers`, role: 'assistant', body: '', at: new Date().toISOString(), surface: null,
    captures: [], reaction: null, replyTo: null, memoriesDerived: 0, attachments: [], pending: 'streaming',
  };
  set({ messages: [...state.messages, mine], replyTo: null, busy: true, limitLine: null });

  let started = false;
  try {
    await stream(
      `/api/conversations/${me.conversation.id}/messages`,
      { message: text, clientId, replyToId: state.replyTo?.id ?? null, attachmentId: attachment?.id ?? null },
      clientId,
      (event) => {
        if (event.event === 'text') {
          if (!started) {
            started = true;
            set({ busy: false, messages: [...current().messages, hers] });
          }
          hers.body += String(event.data['delta'] ?? '');
          patchStreaming(hers.body);
        } else if (event.event === 'capture') {
          hers.captures = [...hers.captures, event.data as unknown as Message['captures'][number]];
        } else if (event.event === 'limit') {
          set({ limitLine: String(event.data['line'] ?? '') });
        } else if (event.event === 'attachment_failed') {
          // Her sentence, in the conversation. Nothing was charged and no
          // message was written, so the composer comes back.
          set({ error: String(event.data['line'] ?? '') });
        } else if (event.event === 'error') {
          throw new Error(String(event.data['message'] ?? 'error'));
        }
      },
    );
    hers.pending = undefined;
    mine.pending = undefined;
    set({ busy: false, messages: [...current().messages] });
    // The window is re-read once at the end: ids, capture rows and what she
    // remembered are the server's answer, not the client's guess.
    await loadMessages();
    await refresh();
  } catch (error) {
    mine.pending = 'failed';
    set({
      busy: false,
      messages: current().messages.filter((message) => message.id !== hers.id),
      error: error instanceof ApiError ? error.message : t('error.send_failed', me.user.language, me.assistant.gender),
    });
  }
}

/** Only the streaming bubble's text, so the whole list is not rebuilt sixty
 *  times a second while she is writing. */
function patchStreaming(text: string): void {
  const node = regions().screen.querySelector('.chat__group--hers:last-child .bubble');
  if (node === null) { draw(current()); return; }
  node.textContent = text;
  const screen = regions().screen;
  screen.scrollTop = screen.scrollHeight;
}

async function refresh(): Promise<void> {
  set({ me: await get<Snapshot>('/api/me') });
}

// ── one delegated listener ────────────────────────────────────────────────

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const link = target.closest('a[data-link]') as HTMLAnchorElement | null;
  if (link !== null) {
    event.preventDefault();
    go(new URL(link.href).pathname);
    return;
  }
  const actor = target.closest('[data-action]') as HTMLElement | null;
  if (actor === null) return;
  const action = actor.dataset['action']!;
  const id = actor.dataset['id'] ?? '';

  if (action === 'close-sheet') { screenData.editing = null; screenData.deleting = null; screenData.correcting = null; }
  if (action === 'drawer') set({ drawerOpen: true });
  else if (action === 'close-drawer') set({ drawerOpen: false });
  else if (action === 'close-sheet') set({ acting: null });
  else if (action === 'back') history.back();
  else if (action === 'older') void loadOlder();
  else if (action === 'message-actions') set({ acting: { id, mode: 'sheet' } });
  else if (action === 'react-picker') set({ acting: { id, mode: 'react' } });
  else if (action === 'reply') {
    set({ replyTo: current().messages.find((message) => message.id === id) ?? null, acting: null });
  } else if (action === 'cancel-reply') set({ replyTo: null });
  else if (action === 'copy') {
    const message = current().messages.find((candidate) => candidate.id === id);
    if (message !== undefined) void navigator.clipboard?.writeText(message.body);
    set({ acting: null });
  } else if (action === 'react') {
    void react(id, actor.dataset['kind'] ?? null);
  } else if (action === 'delete-message') {
    set({ acting: { id, mode: 'delete' as 'sheet' } });
  } else if (action === 'confirm-delete') {
    void deleteMessage(id, actor.dataset['keep'] === 'true');
  } else if (action === 'speak') {
    void playMessage(id);
  } else if (action === 'voice') {
    void startRecording();
  } else if (action === 'stop-voice') {
    void stopRecording(true);
  } else if (action === 'cancel-voice') {
    void stopRecording(false);
  } else if (action === 'permission-yes') {
    void enableNotifications();
  } else if (action === 'permission-no') {
    dismissed.permission = true;
    // Recorded, not just hidden: onboarding does not move on until the
    // question has been ASKED, and a person who says no has answered it.
    void post('/api/push/prompted', { outcome: 'dismissed' }).then(refresh);
  } else if (action === 'install-yes') {
    void installPrompt?.prompt();
    dismissed.install = true;
  } else if (action === 'install-no') {
    dismissed.install = true;
    draw(current());
  } else if (action === 'open-task') {
    const task = screenData.tasks.tasks.find((candidate) => candidate.id === id);
    if (task !== undefined) {
      screenData.correcting = { kind: 'tasks', id, values: { title: task.title, dueOn: task.dueOn ?? '' } };
      draw(current());
    }
  } else if (action === 'open-note') {
    const note = screenData.tasks.notes.find((candidate) => candidate.id === id);
    if (note !== undefined) {
      screenData.correcting = { kind: 'notes', id, values: { title: note.title ?? '', body: note.body } };
      draw(current());
    }
  } else if (action === 'open-money') {
    const transaction = screenData.money?.recent.find((candidate) => candidate.id === id);
    if (transaction !== undefined) {
      screenData.correcting = {
        kind: 'transactions', id,
        values: {
          // Minor units are what the server keeps; the field shows what a
          // person would type.
          amountMinor: String(transaction.amountMinor / 100),
          category: transaction.line, occurredOn: transaction.occurredOn, direction: transaction.direction,
        },
      };
      draw(current());
    }
  } else if (action === 'correct-choice') {
    if (screenData.correcting !== null) {
      screenData.correcting = {
        ...screenData.correcting,
        values: { ...screenData.correcting.values, [actor.dataset['name']!]: actor.dataset['value']! },
      };
      draw(current());
    }
  } else if (action === 'correct-delete') {
    void correctDelete(actor.dataset['kind'] as CorrectKind, id);
  } else if (action === 'memory-filter') {
    screenData.filter = actor.dataset['key'] ?? 'all';
    draw(current());
  } else if (action === 'memory-edit') {
    screenData.editing = screenData.memories.find((memory) => memory.id === id) ?? null;
    draw(current());
  } else if (action === 'memory-delete') {
    screenData.deleting = screenData.memories.find((memory) => memory.id === id) ?? null;
    draw(current());
  } else if (action === 'memory-delete-confirm') {
    void removeMemory(id);
  } else if (action === 'appearance') {
    void setAppearance(actor.dataset['key'] ?? 'auto');
  } else if (action === 'revoke-device') {
    void revokeDevice(id);
  } else if (action === 'sign-out-everywhere') {
    void post('/api/auth/sign-out-everywhere', {}).then(() => { location.href = '/welcome'; });
  } else if (action === 'export') {
    void prepareExport();
  } else if (action === 'delete-confirm') {
    screenData.data = { ...screenData.data, confirming: true };
    draw(current());
  } else if (action === 'notifications') {
    void enableNotifications();
  } else if (action === 'retry') {
    const message = current().messages.find((candidate) => candidate.id === id);
    if (message !== undefined) {
      set({ messages: current().messages.filter((candidate) => candidate.id !== id) });
      void send(message.body);
    }
  }
});

document.addEventListener('input', (event) => {
  const search = (event.target as HTMLElement).closest('[data-action="memory-search"]') as HTMLInputElement | null;
  if (search === null) return;
  screenData.query = search.value;
  clearTimeout(searchTimer);
  // Debounced, because every keystroke is a query against everything she
  // remembers.
  searchTimer = setTimeout(() => { void load('/memory'); }, 200) as unknown as number;
});
let searchTimer = 0;

document.addEventListener('submit', (event) => {
  const target = event.target as HTMLElement;
  const credentials = target.closest('[data-action="sign-up"], [data-action="sign-in"]') as HTMLFormElement | null;
  if (credentials !== null) {
    event.preventDefault();
    void submitCredentials(credentials, credentials.dataset['action'] as 'sign-up' | 'sign-in');
    return;
  }
  const correctForm = target.closest('[data-action="correct-save"]') as HTMLFormElement | null;
  if (correctForm !== null) {
    event.preventDefault();
    void correctSave(correctForm.dataset['kind'] as CorrectKind, correctForm.dataset['id']!, correctForm);
    return;
  }
  const memoryForm = target.closest('[data-action="memory-save"]') as HTMLFormElement | null;
  if (memoryForm !== null) {
    event.preventDefault();
    const statement = String(new FormData(memoryForm).get('statement') ?? '').trim();
    if (statement !== '') void saveMemory(memoryForm.dataset['id']!, statement);
    return;
  }
  const deleteForm = target.closest('[data-action="delete-everything"]') as HTMLFormElement | null;
  if (deleteForm !== null) {
    event.preventDefault();
    const confirm = String(new FormData(deleteForm).get('confirm') ?? '');
    void post('/api/data/delete', { confirm }).then(() => { location.href = '/welcome'; });
    return;
  }
  const form = target.closest('[data-action="send"]') as HTMLFormElement | null;
  if (form === null) return;
  event.preventDefault();
  const input = form.querySelector('.composer__input') as HTMLInputElement;
  const text = input.value;
  input.value = '';
  void send(text);
});

// The photo control is a file input, so it reports through 'change' rather
// than the click listener above.
document.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset['action'] !== 'photo') return;
  const file = input.files?.[0];
  // Cleared immediately so choosing the same picture twice fires again.
  input.value = '';
  if (file !== undefined) void sendPhoto(file);
});

// ── voice notes (UI-UX §34) ───────────────────────────────────────────────
//
// The recording is uploaded as an attachment and the server transcribes it on
// the way into the turn, so the TRANSCRIPT is the message body (Q14) and the
// AUDIO is kept beside it. That is one path: there is no separate transcribe
// endpoint that would produce a message body a second way.

let recording: { recorder: MediaRecorder; chunks: Blob[]; startedAt: number; timer: number } | null = null;

async function startRecording(): Promise<void> {
  const me = current().me;
  if (me === null) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const media = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    media.addEventListener('dataavailable', (event) => { if (event.data.size > 0) chunks.push(event.data); });
    media.start();
    recording = {
      recorder: media, chunks, startedAt: Date.now(),
      // The counter is the only moving part on the bar; a second is enough.
      timer: setInterval(() => draw(current()), 1000) as unknown as number,
    };
    draw(current());
  } catch {
    // No microphone, or permission refused. Nothing to say about it: the
    // text field is right there.
    recording = null;
  }
}

async function stopRecording(send_: boolean): Promise<void> {
  const active = recording;
  const me = current().me;
  if (active === null || me === null) return;
  clearInterval(active.timer);
  recording = null;
  const seconds = Math.round((Date.now() - active.startedAt) / 1000);
  const finished = new Promise<Blob>((resolve) => {
    active.recorder.addEventListener('stop', () => resolve(new Blob(active.chunks, { type: active.recorder.mimeType })), { once: true });
  });
  active.recorder.stop();
  for (const track of active.recorder.stream.getTracks()) track.stop();
  const audio = await finished;
  draw(current());
  if (!send_ || seconds < 1) return;

  set({ busy: true });
  try {
    const contentType = audio.type === '' ? 'audio/webm' : audio.type.split(';')[0]!;
    const uploaded = await upload(audio, {
      kind: 'audio', contentType,
      conversationId: current().me?.conversation?.id ?? null,
    });
    set({ busy: false });
    // No text: the transcript becomes the body server-side.
    await send('', { id: uploaded.id, kind: 'audio', contentType });
  } catch (error) {
    // UI-UX §20: she says it, rather than an error toast.
    set({
      busy: false,
      error: error instanceof ApiError && error.code !== 'upload_failed'
        ? error.message
        : t('error.voice_fallback', me.user.language, me.assistant.gender),
    });
  }
}

/**
 * Her sentence, spoken — asked for, never pushed.
 *
 * Synthesis happens when the button is pressed and not before: pre-generating
 * every reply bills for audio nobody plays, and LESSONS §8's own story is a
 * pre-generation path that looked fixed and was not.
 */
async function playMessage(messageId: string): Promise<void> {
  const me = current().me;
  if (me === null) return;
  try {
    const { url } = await post<{ url: string }>(`/api/messages/${messageId}/voice`);
    await new Audio(url).play();
  } catch (error) {
    // UI-UX §20: "The voice note didn't work, so I'll say it here instead."
    // Her words are already on screen, which is exactly what that line means.
    set({ error: error instanceof ApiError && error.code === 'voice_not_on_plan'
      ? error.message
      : t('error.voice_fallback', me.user.language, me.assistant.gender) });
  }
}

// ── photographs (PRD §6.5) ────────────────────────────────────────────────
//
// One control, and it does not ask what the picture is: the server reads
// every image as a possible receipt, because asking someone to classify their
// own photograph is a form, and this product does not have forms.
async function sendPhoto(file: File): Promise<void> {
  const me = current().me;
  if (me === null) return;
  set({ busy: true });
  try {
    const uploaded = await upload(file, {
      kind: 'image', contentType: file.type === '' ? 'image/jpeg' : file.type,
      conversationId: me.conversation?.id ?? null,
    });
    set({ busy: false });
    await send('', { id: uploaded.id, kind: 'image', contentType: file.type });
  } catch (error) {
    set({
      busy: false,
      error: error instanceof ApiError ? error.message : t('error.attachment_failed', me.user.language, me.assistant.gender),
    });
  }
}

async function correctSave(kind: CorrectKind, id: string, form: HTMLFormElement): Promise<void> {
  const values = Object.fromEntries(new FormData(form).entries());
  const patch: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const text = String(value).trim();
    if (name === 'amountMinor') patch[name] = Math.round(Number(text) * 100);
    else if (name === 'durationMinutes') patch[name] = text === '' ? null : Number(text);
    else if (name === 'dueOn' || name === 'occurredOn') patch[name] = text === '' ? null : text;
    else patch[name] = text === '' ? null : text;
  }
  const chosen = screenData.correcting?.values['direction'];
  if (kind === 'transactions' && chosen !== undefined) patch['direction'] = chosen;
  screenData.correcting = null;
  await patch_(`/api/${kind}/${id}`, patch);
  await load(current().path);
}

async function correctDelete(kind: CorrectKind, id: string): Promise<void> {
  screenData.correcting = null;
  await remove(`/api/${kind}/${id}`);
  await load(current().path);
}

async function removeMemory(id: string): Promise<void> {
  screenData.deleting = null;
  await remove(`/api/memories/${id}`);
  screenData.memories = screenData.memories.filter((memory) => memory.id !== id);
  await refresh();
}

async function saveMemory(id: string, statement: string): Promise<void> {
  screenData.editing = null;
  await patch_(`/api/memories/${id}`, { statement });
  screenData.memories = screenData.memories.map((memory) => (memory.id === id ? { ...memory, statement } : memory));
  draw(current());
}

async function setAppearance(preference: string): Promise<void> {
  // The theme is DECIDED by the server (LESSONS §7). The client sends the
  // preference and re-reads what was decided; it never picks a palette.
  await patch_('/api/settings', { themePreference: preference });
  await refresh();
  applyTheme();
}

function applyTheme(): void {
  const me = current().me;
  if (me === null) return;
  // The SAME writer the server-rendered document uses (LESSONS §7: one
  // decision point, one writer, and it writes an attribute rather than a
  // colour). The theme itself was decided server-side and arrives in the
  // snapshot; this only applies it.
  writeTheme(document.documentElement, me.theme as ThemeName, me.direction);
  // The cookies are what the pre-hydration script reads, so the next load
  // paints the same thing without a flash. They carry the last known theme,
  // never a colour.
  document.cookie = `${THEME_COOKIE}=${me.theme}; path=/; max-age=31536000; samesite=lax`;
  document.cookie = `${DIRECTION_COOKIE}=${me.direction}; path=/; max-age=31536000; samesite=lax`;
}

async function revokeDevice(deviceId: string): Promise<void> {
  await post(`/api/security/devices/${deviceId}/revoke`, {});
  screenData.security = await get('/api/security');
  draw(current());
}

async function prepareExport(): Promise<void> {
  screenData.data = { ...screenData.data, busy: true };
  draw(current());
  const result = await post<{ filename: string; archive: unknown }>('/api/data/export', {});
  screenData.data = { ...screenData.data, busy: false, export: result, confirming: false };
  draw(current());
}

/** The permission, asked where the product asks it (PRD §8) — after she has
 *  remembered something, or from Settings. Both answers reach the server. */
async function enableNotifications(): Promise<void> {
  const push = (window as unknown as { lianPush?: { enable(key: string): Promise<string> } }).lianPush;
  if (push === undefined) return;
  dismissed.permission = true;
  await push.enable(newKey());
  await refresh();
}

async function react(messageId: string, kind: string | null): Promise<void> {
  const state = current();
  const message = state.messages.find((candidate) => candidate.id === messageId);
  const next = message?.reaction === kind ? null : kind;
  set({
    acting: null,
    messages: state.messages.map((candidate) => (candidate.id === messageId ? { ...candidate, reaction: next } : candidate)),
  });
  await post(`/api/messages/${messageId}/reactions`, { kind: next });
}

async function deleteMessage(messageId: string, keepDerived: boolean): Promise<void> {
  set({ acting: null });
  await remove(`/api/messages/${messageId}?keep_derived=${keepDerived}`);
  await loadMessages();
  await refresh();
}

// ── boot ──────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  set({ path: location.pathname });
  try {
    const me = await get<Snapshot>('/api/me');
    set({ me });
    applyTheme();
    watchForHerMessages();
    // A signed-in person who lands on an entry screen goes to the
    // conversation: the entry screens exist for people who are not signed in.
    if (ENTRY[match(location.pathname)?.screen ?? ''] !== undefined) go('/chat', true);
    else await load(location.pathname);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // Not signed in. Replace rather than push, so Back does not bounce.
      if (ENTRY[match(location.pathname)?.screen ?? ''] === undefined) go('/welcome', true);
      else draw(current());
      return;
    }
    throw error;
  }
}

// ── accounts ──────────────────────────────────────────────────────────────

async function submitCredentials(form: HTMLFormElement, route: 'sign-up' | 'sign-in'): Promise<void> {
  const data = new FormData(form);
  set({ busy: true, error: null });
  try {
    const body = {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      ...(route === 'sign-up' ? { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}),
    };
    const result = await post<{ status?: string }>(`/api/auth/${route}`, body);
    if (result.status === 'held_new_device') {
      set({ busy: false });
      go('/confirm-device');
      return;
    }
    set({ busy: false });
    // Straight into the conversation — onboarding is a conversation, not a
    // setup screen (PRD §8).
    await boot();
    go('/chat', true);
  } catch (error) {
    const language = document.documentElement.getAttribute('dir') === 'rtl' ? 'ar' : 'en';
    const message = error instanceof ApiError
      ? error.code === 'rejected' ? t('entry.rejected', language)
        : error.code === 'bad_email' ? t('entry.bad_email', language)
        : error.code === 'weak_password' ? t('entry.weak_password', language)
        : error.message
      : t('error.send_failed', language);
    set({ busy: false, error: message });
  }
}

// The worker is what receives a push and draws the notification — the
// product's defining behaviour. Registered after boot rather than in the
// document, so a failure to register cannot stop the app from rendering.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}

window.addEventListener('online', () => set({ offline: false }));
window.addEventListener('offline', () => set({ offline: true }));

void boot();
