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
import { get, patch, post, remove, stream, newKey, ApiError } from './api.ts';
import { current, set, subscribe, type Message, type Snapshot, type State } from './state.ts';
import { match, tabFor } from './router.ts';
import { html, render, type Html } from './dom.ts';
import { t } from './copy.ts';
import { head } from './components/head.ts';
import { nav } from './components/nav.ts';
import { drawer } from './components/drawer.ts';
import { chatScreen, composer, actionSheet, deleteSheet, thinking } from './screens/chat.ts';
import { welcome, signUp, signIn, heldDevice } from './screens/entry.ts';
import { memoryScreen, memoryEditor, memoryDeleteSheet, type Memory, type MemoryState } from './screens/memory.ts';
import { tasksScreen, moneyScreen, storyScreen, type Task, type Note, type Money, type Story } from './screens/life.ts';
import { settingsScreen, securityScreen, dataScreen, type Security, type DataState } from './screens/trust.ts';

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
    root.innerHTML = render((entry ?? welcome)({ language, error: state.error, busy: state.busy }));
    return;
  }
  const where = regions();

  paint(where.head, head(me));
  where.screen.className = `screen ${screen === 'chat' ? 'screen--chat' : ''}`;
  paint(where.screen, screenFor(screen, state, me));
  if (screen === 'chat' && state.busy && state.messages.some((message) => message.pending === 'sending')) {
    where.screen.insertAdjacentHTML('beforeend', render(thinking(me)));
  }

  // The composer belongs to the conversation and nowhere else.
  if (screen !== 'chat') {
    where.composer.innerHTML = '';
    where.composer.dataset['key'] = 'none';
  }
  // It is only re-rendered when its own shape changes, so typing survives a
  // message arriving.
  const composerKey = screen === 'chat' ? `chat:${state.replyTo?.id ?? ''}` : 'none';
  if (screen === 'chat' && where.composer.dataset['key'] !== composerKey) {
    const value = (where.composer.querySelector('.composer__input') as HTMLInputElement | null)?.value ?? '';
    paint(where.composer, composer(state));
    where.composer.dataset['key'] = composerKey;
    const input = where.composer.querySelector('.composer__input') as HTMLInputElement | null;
    if (input !== null && value !== '') input.value = value;
  }

  paint(where.nav, nav(me, state.path));

  const overlays: string[] = [];
  if (state.drawerOpen) overlays.push(render(drawer(me)));
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
  security: Security | null; data: DataState;
} = {
  memories: [], query: '', filter: 'all', editing: null, deleting: null,
  tasks: { tasks: [], notes: [] }, money: null, story: null, security: null,
  data: { export: null, confirming: false, typed: '', busy: false },
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
    default: return chatScreen(state);
  }
}

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

// ── a turn ────────────────────────────────────────────────────────────────

async function send(text: string): Promise<void> {
  const state = current();
  const me = state.me!;
  if (me.conversation === null || text.trim() === '') return;

  const clientId = newKey();
  const mine: Message = {
    id: clientId, role: 'user', body: text, at: new Date().toISOString(), surface: null,
    captures: [], reaction: null, memoriesDerived: 0,
    replyTo: state.replyTo === null ? null : { id: state.replyTo.id, role: state.replyTo.role, body: state.replyTo.body },
    pending: 'sending',
  };
  const hers: Message = {
    id: `${clientId}-hers`, role: 'assistant', body: '', at: new Date().toISOString(), surface: null,
    captures: [], reaction: null, replyTo: null, memoriesDerived: 0, pending: 'streaming',
  };
  set({ messages: [...state.messages, mine], replyTo: null, busy: true, limitLine: null });

  let started = false;
  try {
    await stream(
      `/api/conversations/${me.conversation.id}/messages`,
      { message: text, clientId, replyToId: state.replyTo?.id ?? null },
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

  if (action === 'close-sheet') { screenData.editing = null; screenData.deleting = null; }
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

async function removeMemory(id: string): Promise<void> {
  screenData.deleting = null;
  await remove(`/api/memories/${id}`);
  screenData.memories = screenData.memories.filter((memory) => memory.id !== id);
  await refresh();
}

async function saveMemory(id: string, statement: string): Promise<void> {
  screenData.editing = null;
  await patch(`/api/memories/${id}`, { statement });
  screenData.memories = screenData.memories.map((memory) => (memory.id === id ? { ...memory, statement } : memory));
  draw(current());
}

async function setAppearance(preference: string): Promise<void> {
  // The theme is DECIDED by the server (LESSONS §7). The client sends the
  // preference and re-reads what was decided; it never picks a palette.
  await patch('/api/settings', { themePreference: preference });
  await refresh();
  applyTheme();
}

function applyTheme(): void {
  const me = current().me;
  if (me === null) return;
  document.documentElement.setAttribute('data-t', me.theme);
  document.documentElement.setAttribute('dir', me.direction);
  // The cookie is what the server and the pre-hydration script read, so the
  // next load paints the same thing without a flash.
  document.cookie = `lian_t=${me.theme}; path=/; max-age=31536000; samesite=lax`;
  document.cookie = `lian_dir=${me.direction}; path=/; max-age=31536000; samesite=lax`;
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

window.addEventListener('online', () => set({ offline: false }));
window.addEventListener('offline', () => set({ offline: true }));

void boot();
