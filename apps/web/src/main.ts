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
import { t, TERMS, PRIVACY } from './copy.ts';
import { applyTheme as writeTheme, THEME_COOKIE, DIRECTION_COOKIE, type ThemeName } from '@lian/design';
import { head } from './components/head.ts';
import { nav, railGroups } from './components/nav.ts';
import { threadSheet, incognitoChip, scenarioSheet, type Thread } from './screens/threads.ts';
import { drawer } from './components/drawer.ts';
import { chatScreen, composer, recorder, actionSheet, deleteSheet, thinking, permissionCard, installCard } from './screens/chat.ts';
import { welcome, signUp, signIn, heldDevice, consent, legalScreen, forgotPassword, resetPassword, confirmEmailScreen, notFound, outage } from './screens/entry.ts';
import { memoryScreen, memoryEditor, memoryDeleteSheet, type Memory, type MemoryState } from './screens/memory.ts';
import { tasksScreen, moneyScreen, storyScreen, type Task, type Note, type Money, type Story } from './screens/life.ts';
import { healthScreen, albumScreen, type Health, type Album } from './screens/album.ts';
import { searchScreen, briefingScreen, profileScreen, type Search, type Briefing, type Profile } from './screens/find.ts';
import { planScreen, type Plan } from './screens/plan.ts';
import { identityScreen, dialsScreen, quietHoursScreen, assistantsScreen, languageScreen, type Settings } from './screens/her.ts';
import { settingsScreen, securityScreen, dataScreen, type Security, type DataState } from './screens/trust.ts';
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
  welcome, signUp, signIn, confirmDevice: heldDevice, notFound, outage,
  // Consent is an entry screen even for someone who is signed in: it has no
  // header and no nav, because agreeing to something is not a place to be.
  consent: (state) => consent({ ...state, adult: consentState.adult, agreed: consentState.agreed }),
  // Both documents render before an account exists and after it does, from
  // the same route — somebody reads them at the gate, and looks them up again
  // from Settings a month later.
  forgot: (state) => forgotPassword({ ...state, sent: recovery.sent, canEmail: recovery.canEmail }),
  resetPassword,
  confirmEmail: (state) => confirmEmailScreen({ ...state, done: verification.done }),
  terms: (state) => legalScreen({ ...state, document: TERMS, back: legalBack() }),
  privacy: (state) => legalScreen({ ...state, document: PRIVACY, back: legalBack() }),
};

/** Back to wherever they came from: the consent gate before an account, the
 *  data screen after one. */
const legalBack = (): string => (current().me === null ? '/consent' : '/data');

/** Whether the link was asked for, and whether this deployment can send one.
 *  The second is told by the server, so the screen can say "the link cannot
 *  arrive" rather than leaving somebody waiting for an email nothing sends. */
const recovery = { sent: false, canEmail: true };
const verification = { done: false };

/** Which thread the chat screen is showing: the one in the URL, or the main
 *  one from the snapshot. */
function currentThreadId(): string | null {
  const match = /^\/chat\/([^/]+)$/.exec(current().path);
  return match !== null ? match[1]! : current().me?.conversation?.id ?? null;
}
const currentThread = (): Thread | undefined => screenData.threads.find((thread) => thread.id === currentThreadId());

/** The two answers, held until sign-up sends them. Nothing is written until
 *  the account is created — an under-18 answer must not leave a trace. */
const consentState: { adult: boolean | null; agreed: boolean } = { adult: null, agreed: false };

function draw(state: State): void {
  // A path nobody defined is a 404, not the conversation. Rendering chat for
  // an unknown URL means a typo looks like it worked.
  const screen = match(state.path)?.screen ?? 'notFound';
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

  // PRD §27: in incognito the mood phrase is suppressed. Read from the
  // thread's retention, which is the server's word on what is kept.
  const incognito = screen === 'chat' && currentThread()?.retention === 'ephemeral';
  paint(where.head, head(me, incognito ? { incognito: true } : {}));
  where.screen.className = `screen ${screen === 'chat' ? 'screen--chat' : ''}`;
  paint(where.screen, screenFor(screen, state, me));
  // The at-a-glance incognito state (UI-UX §14), from the thread's RETENTION
  // as the server reported it — never from a client flag that could disagree
  // with what is actually being kept.
  if (incognito) {
    where.screen.insertAdjacentHTML('afterbegin', render(incognitoChip(me, currentThread()?.scenarioText ?? null)));
  }
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

  // The bottom nav on a phone; at 900px+ the same element is the left rail,
  // with the drawer's groups inside it. One DOM, one stylesheet, no width
  // measured in JavaScript.
  paint(where.nav, html`${nav(me, state.path)}${railGroups(me, state.path)}`);

  const overlays: string[] = [];
  if (state.drawerOpen) overlays.push(render(drawer(me)));
  if (screenData.threadsOpen) overlays.push(render(threadSheet(me, screenData.threads, currentThreadId())));
  if (screenData.scenarioOpen) {
    const thread = currentThread();
    // Only ever for the thread being read, and only while it is still an
    // incognito one — a sheet left open across a thread switch would edit
    // whatever happened to be current when Save was pressed.
    if (thread !== undefined && thread.retention === 'ephemeral') overlays.push(render(scenarioSheet(me, thread)));
  }
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
  manageFocus(where);

  if (state.path !== lastPath || screen === 'chat') {
    lastPath = state.path;
    if (screen === 'chat') where.screen.scrollTop = where.screen.scrollHeight;
  }
}

// ── overlays and the keyboard ──────────────────────────────────────────────
//
// Every sheet, the drawer and the photo viewer carry `role="dialog"` and,
// until now, none of the behaviour that word promises: focus stayed on the
// button behind, Tab walked straight out into a page that was still
// interactive, Escape did nothing, and closing left focus wherever it had
// drifted. HANDOFF called them "focus traps by shape", which had it exactly
// backwards — they LOOK like they should trap focus and did not.
//
// It is one function because every dialog in the product is `[role="dialog"]`
// and nothing else is, so the trap is written once and a sheet added later
// gets it without knowing this exists. It looks for the dialog ANYWHERE
// rather than in the overlays region, because the photo viewer is not there:
// it belongs to the album screen and renders inside it. A manager that only
// watched `#r-overlays` would have missed the one overlay that covers the
// entire display, and would have made it inert along with the screen it sits
// in the moment anything else opened.
//
// It takes BOTH halves, and each does something the other cannot:
//
//   `inert` on everything behind removes it from the tab order and from the
//   accessibility tree, so a screen reader cannot swipe into it either. A
//   hand-rolled Tab wrap does not do that second part, and it is the half
//   that is easy to forget.
//
//   A Tab wrap on the last and first controls, because inert is not a trap.
//   Tab past the final control in the dialog wraps through the DOCUMENT — the
//   browser's own chrome and then back to the top — so focus lands on `body`
//   with everything around it inert, and the keyboard is nowhere at all.
//   Measured, not assumed: the test below caught it on the tenth press.

/**
 * What opened the overlay, so closing can put focus back where it was.
 *
 * A SELECTOR, not the element. Every draw repaints whole regions from state,
 * so the button that opened a sheet is a different DOM node by the time the
 * sheet is on screen — holding the reference gives you a detached element
 * that can be focused and does nothing, silently. `data-action` plus
 * `data-id` is what identifies a control across a repaint, because it is what
 * identified it to the click handler in the first place.
 */
let returnFocusTo: string | null = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function manageFocus(where: ReturnType<typeof regions>): void {
  const regionList = [where.head, where.screen, where.composer, where.nav, where.overlays];
  // The LAST one, so a sheet opened over the drawer is the one that gets the
  // keyboard rather than whichever happened to be painted first.
  const dialogs = document.querySelectorAll('[role="dialog"]');
  const dialog = (dialogs[dialogs.length - 1] ?? null) as HTMLElement | null;

  if (dialog === null) {
    for (const region of regionList) {
      region.removeAttribute('inert');
      for (const child of region.children) child.removeAttribute('inert');
    }
    // Only if focus is nowhere useful: a close that already moved focus
    // deliberately (following a link out of the drawer) must not be undone.
    if (returnFocusTo !== null) {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        (document.querySelector(returnFocusTo) as HTMLElement | null)?.focus();
      }
      returnFocusTo = null;
    }
    return;
  }

  // `aria-modal` here rather than in seven templates: it is a fact about how
  // the dialog is being presented, and this is the only code that knows the
  // background has actually been made inert.
  dialog.setAttribute('aria-modal', 'true');
  // Every region EXCEPT the one holding the dialog. Marking the region a
  // dialog lives in as inert would make the dialog itself unreachable, which
  // is a worse bug than the one this fixes and is silent: everything renders,
  // and nothing can be operated at all.
  //
  // Then the same rule one level down, INSIDE that region. The photo viewer
  // is a sibling of the album grid, so stopping at the region boundary would
  // leave the grid behind it tabbable — a full-screen overlay with the page
  // it covers still reachable by keyboard, which is the exact bug this is
  // for. Two levels is enough for every overlay the product has; a third
  // would mean an overlay nested deeper than its screen, which is a reason to
  // move it to the overlays region rather than to generalise this.
  for (const region of regionList) {
    if (!region.contains(dialog)) { region.setAttribute('inert', ''); continue; }
    region.removeAttribute('inert');
    for (const child of region.children) {
      if (child.contains(dialog)) child.removeAttribute('inert');
      else child.setAttribute('inert', '');
    }
  }

  // Already inside — a re-render while the sheet is open (a reaction landing,
  // a thread list refreshing) must not yank focus back to the first control.
  if (dialog.contains(document.activeElement)) return;

  const first = dialog.querySelector(FOCUSABLE) as HTMLElement | null;
  if (first !== null) { first.focus(); return; }
  // A dialog with nothing focusable in it still has to receive focus, or the
  // reader is left announcing whatever is behind an inert region.
  dialog.tabIndex = -1;
  dialog.focus();
}

/**
 * Keep Tab inside the open dialog.
 *
 * Only at the two edges: everywhere else the browser's own tab order is
 * correct and interfering with it is how a wrap ends up skipping a control
 * or reversing two. Hidden elements are filtered by `offsetParent`, because
 * a sheet renders its cancel button conditionally and tabbing to something
 * with no box is indistinguishable from tabbing to nothing.
 */
function wrapTab(event: KeyboardEvent): void {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  const dialog = dialogs[dialogs.length - 1] as HTMLElement | undefined;
  if (dialog === undefined) return;
  const stops = [...dialog.querySelectorAll(FOCUSABLE)]
    .filter((element) => (element as HTMLElement).offsetParent !== null) as HTMLElement[];
  if (stops.length === 0) { event.preventDefault(); return; }
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Escape closes the top overlay.
 *
 * One listener, and it closes whatever is open by clearing the state that
 * opened it — rather than by clicking a close button, which would depend on
 * every sheet having one in the same shape. The scrim already answers a click
 * anywhere outside; this is the same affordance for somebody who is not using
 * a mouse.
 */
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') { wrapTab(event); return; }
  if (event.key !== 'Escape') return;
  const state = current();
  if (screenData.viewing !== null) { screenData.viewing = null; set({}); return; }
  if (state.acting !== null) { set({ acting: null }); return; }
  if (screenData.deleting !== null) { screenData.deleting = null; set({}); return; }
  if (screenData.editing !== null) { screenData.editing = null; set({}); return; }
  if (screenData.correcting !== null) { screenData.correcting = null; set({}); return; }
  if (screenData.scenarioOpen) { screenData.scenarioOpen = false; set({}); return; }
  if (screenData.threadsOpen) { screenData.threadsOpen = false; set({}); return; }
  if (state.drawerOpen) set({ drawerOpen: false });
});

/** What each screen has loaded. Kept beside the store rather than inside it
 *  so the chat's state stays readable. */
const screenData: {
  memories: Memory[]; query: string; filter: string; editing: Memory | null; deleting: Memory | null;
  tasks: { tasks: Task[]; notes: Note[] }; money: Money | null; story: Story | null;
  /** UI-UX §8's timeline filter. A view preference, held here rather than in
   *  the URL: it is not somewhere anybody links to or shares. */
  storyFilter: string | null;
  security: Security | null; data: DataState; correcting: Correcting | null;
  health: Health | null; album: Album | null; viewing: string | null;
  search: Search | null; briefing: Briefing | null; profile: Profile | null; savedSection: string | null;
  plan: Plan | null; settings: Settings | null;
  threads: Thread[]; threadsOpen: boolean; scenarioOpen: boolean;
} = {
  memories: [], query: '', filter: 'all', editing: null, deleting: null,
  tasks: { tasks: [], notes: [] }, money: null, story: null, storyFilter: null, security: null,
  data: { export: null, confirming: false, typed: '', busy: false }, correcting: null,
  health: null, album: null, viewing: null,
  search: null, briefing: null, profile: null, savedSection: null, plan: null, settings: null,
  threads: [], threadsOpen: false, scenarioOpen: false,
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
    case 'story': return screenData.story === null ? html`` : storyScreen(me, screenData.story, screenData.storyFilter);
    case 'settings': return settingsScreen(me);
    case 'security': return screenData.security === null ? html`` : securityScreen(me, screenData.security);
    case 'data': return dataScreen(me, screenData.data);
    case 'health': return screenData.health === null ? html`` : healthScreen(me, screenData.health);
    case 'search': return searchScreen(me, screenData.search);
    case 'briefing': return screenData.briefing === null ? html`` : briefingScreen(me, screenData.briefing);
    case 'profile': return screenData.profile === null ? html`` : profileScreen(me, screenData.profile, screenData.savedSection);
    case 'identity': return screenData.settings === null ? html`` : identityScreen(me, screenData.settings);
    // Reads only from the snapshot, so unlike its neighbours it needs no fetch.
    case 'language': return languageScreen(me);
    case 'personality': return screenData.settings === null ? html`` : dialsScreen(me, screenData.settings);
    case 'quietHours': return screenData.settings === null ? html`` : quietHoursScreen(me, screenData.settings);
    case 'assistants': return screenData.settings === null ? html`` : assistantsScreen(me, screenData.settings);
    case 'subscription': return screenData.plan === null ? html`` : planScreen(me, screenData.plan, new URLSearchParams(location.search).get('checkout') === 'done');
    case 'album': return screenData.album === null ? html`` : albumScreen(me, screenData.album, screenData.viewing);
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
  const found = match(path);
  const screen = found?.screen ?? 'notFound';
  set({ busy: true });
  try {
    if (screen === 'chat') {
      await loadThreads();
      await loadMessages();
    }
    else if (screen === 'memory') screenData.memories = (await get<{ memories: Memory[] }>(`/api/memories${screenData.query === '' ? '' : `?q=${encodeURIComponent(screenData.query)}`}`)).memories;
    else if (screen === 'tasks') screenData.tasks = await get('/api/tasks');
    else if (screen === 'money') screenData.money = await get('/api/money');
    else if (screen === 'story') screenData.story = await get('/api/story');
    else if (screen === 'security') screenData.security = await get('/api/security');
    else if (screen === 'health') screenData.health = await get('/api/health');
    else if (screen === 'album') { screenData.album = await get('/api/album'); screenData.viewing = null; }
    else if (screen === 'briefing') screenData.briefing = await get('/api/briefing');
    else if (screen === 'subscription') screenData.plan = await get('/api/subscription');
    else if (screen === 'identity' || screen === 'personality' || screen === 'quietHours' || screen === 'assistants') {
      screenData.settings = await get('/api/settings');
    }
    else if (screen === 'profile') { screenData.profile = await get('/api/profile'); screenData.savedSection = null; }
    else if (screen === 'search' && screenData.search === null) screenData.search = { query: '', conversations: [], memories: [] };
    // UI-UX §4: a capture chip points at ITS correction, not at a list. The
    // id was parsed by match() and dropped on the floor, so tapping "AED 400
    // · gym · Today" opened the Money screen and left somebody to find the
    // row again — on the one interaction the whole product is built around.
    if (found !== null && found.params['id'] !== undefined) openCorrection(screen, found.params['id']);
  } finally {
    set({ busy: false });
  }
}

/**
 * Open the correction the URL names, if the thing it names is there.
 *
 * Silent when it is not: a deleted transaction whose chip is still in the
 * conversation should leave you on the Money screen, not looking at an error
 * about a row that used to exist. The screen behind the sheet is the answer
 * either way.
 */
function openCorrection(screen: string, id: string): void {
  if (screen === 'money') {
    const transaction = screenData.money?.recent.find((candidate) => candidate.id === id);
    if (transaction === undefined) return;
    screenData.correcting = {
      kind: 'transactions', id,
      values: {
        amountMinor: String(transaction.amountMinor / 100),
        category: transaction.line, occurredOn: transaction.occurredOn, direction: transaction.direction,
      },
    };
  } else if (screen === 'tasks') {
    const task = screenData.tasks.tasks.find((candidate) => candidate.id === id);
    if (task !== undefined) {
      screenData.correcting = { kind: 'tasks', id, values: { title: task.title, dueOn: task.dueOn ?? '' } };
      return;
    }
    // /notes/:id and /tasks/:id are the same screen; a note is looked for
    // only when no task matched, so one path serves both.
    const note = screenData.tasks.notes.find((candidate) => candidate.id === id);
    if (note !== undefined) {
      screenData.correcting = { kind: 'notes', id, values: { title: note.title ?? '', body: note.body } };
    }
  }
}

async function loadMessages(): Promise<void> {
  // The thread in the URL, or the main one. /chat/:id is how a side or
  // incognito conversation is read.
  const conversationId = currentThreadId();
  if (conversationId === null) return;
  const page = await get<{ messages: Message[]; hasOlder: boolean }>(`/api/conversations/${conversationId}/messages`);
  set({ messages: page.messages, hasOlder: page.hasOlder });
}

async function loadOlder(): Promise<void> {
  const state = current();
  const oldest = state.messages[0];
  const conversationId = currentThreadId();
  if (oldest === undefined || conversationId === null) return;
  const where = regions().screen;
  const before = where.scrollHeight;
  const page = await get<{ messages: Message[]; hasOlder: boolean }>(
    `/api/conversations/${conversationId}/messages?before_at=${encodeURIComponent(oldest.at)}&before_id=${oldest.id}`,
  );
  set({ messages: [...page.messages, ...state.messages], hasOlder: page.hasOlder });
  // UI-UX §38: preserve the exact position, never jump to the top.
  where.scrollTop = where.scrollHeight - before;
}

/**
 * Hand the browser to Stripe.
 *
 * A full navigation rather than an iframe or a popup: the hosted page has to
 * be able to run 3-D Secure, which means it has to be a top-level document,
 * and a card form inside somebody else's frame is the shape a person should
 * be suspicious of anyway.
 */
async function resendVerification(): Promise<void> {
  const me = current().me;
  if (me === null) return;
  const { sent } = await post<{ sent: boolean }>('/api/auth/resend-verification');
  set({ error: t(sent ? 'verify.sent' : 'verify.no_transport', me.user.language, me.assistant.gender) });
}

/** Following a confirmation link. Runs on load rather than on a press: the
 *  person clicked the link, which IS the press. */
async function confirmEmailFromLink(): Promise<void> {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const language = document.documentElement.getAttribute('dir') === 'rtl' ? 'ar' : 'en';
  try {
    await post('/api/auth/confirm-email', { token });
    verification.done = true;
    set({ error: null });
    // The snapshot carries emailVerified, so the security screen stops asking.
    if (current().me !== null) set({ me: await get<Snapshot>('/api/me') });
  } catch (error) {
    verification.done = false;
    set({ error: error instanceof ApiError ? error.message : t('verify.expired', language) });
  }
}

// ── conversations (UI-UX §14) ─────────────────────────────────────────────

async function loadThreads(): Promise<void> {
  screenData.threads = (await get<{ conversations: Thread[] }>('/api/conversations')).conversations;
}

async function openThreads(): Promise<void> {
  await loadThreads();
  screenData.threadsOpen = true;
  set({});
}

async function startThread(kind: 'side' | 'incognito', scenarioText: string | null): Promise<void> {
  const { id } = await post<{ id: string }>('/api/conversations',
    scenarioText === null ? { kind } : { kind, scenarioText });
  await loadThreads();
  screenData.threadsOpen = false;
  go(`/chat/${id}`);
}

/** Whatever is in the role box right now — on the start sheet or the edit
 *  sheet, whichever is open. Empty means no role, which is `null`. */
function scenarioTyped(): string | null {
  const field = document.querySelector('textarea[name="scenarioText"]') as HTMLTextAreaElement | null;
  const value = field?.value.trim() ?? '';
  return value === '' ? null : value;
}

/**
 * Set or clear the role (UI-UX §46).
 *
 * The threads list is reloaded rather than patched locally: the chip renders
 * from it, and the server is the only thing that knows whether the write
 * actually landed. A locally-patched chip that showed a role the prompt does
 * not have is the exact failure the chip exists to prevent.
 */
async function setScenario(id: string, scenarioText: string | null): Promise<void> {
  await patch_(`/api/conversations/${id}`, { scenarioText });
  await loadThreads();
  screenData.scenarioOpen = false;
  set({});
}

async function endThread(id: string): Promise<void> {
  await remove(`/api/conversations/${id}`);
  await loadThreads();
  // If they closed the thread they were reading, go back to the main one
  // rather than leaving them looking at something that no longer exists.
  if (currentThreadId() === id) {
    screenData.threadsOpen = false;
    go('/chat', true);
    return;
  }
  set({});
}

async function goToStripe(route: string): Promise<void> {
  const me = current().me;
  if (me === null) return;
  set({ busy: true });
  try {
    const { url } = await post<{ url: string }>(route);
    location.href = url;
  } catch (error) {
    set({
      busy: false,
      error: error instanceof ApiError && error.code === 'billing_unconfigured'
        ? t('plan.unavailable', me.user.language, me.assistant.gender)
        : t('error.send_failed', me.user.language, me.assistant.gender),
    });
  }
}

/** One patch, then re-read: the server is what decides what a setting IS,
 *  and a client that guessed would drift from it silently. */
async function saveSetting(patch: Record<string, unknown>): Promise<void> {
  await patch_('/api/settings', patch);
  screenData.settings = await get<Settings>('/api/settings');
  // /api/me carries her name, her gender and the language — all three change
  // what the rest of the app renders, so the snapshot is re-read too.
  set({ me: await get<Snapshot>('/api/me') });
}

async function saveProfileSection(section: string, body: string): Promise<void> {
  await patch_('/api/profile', { section, body });
  screenData.profile = await get<Profile>('/api/profile');
  screenData.savedSection = section;
  set({});
}

/** The next page of the album, appended rather than replacing — scrolling
 *  back through a year of pictures should not lose where you were. */
async function loadOlderPhotos(): Promise<void> {
  const album = screenData.album;
  const oldest = album?.items.at(-1);
  if (album === null || album === undefined || oldest === undefined) return;
  const page = await get<Album>(`/api/album?before=${encodeURIComponent(oldest.at)}`);
  screenData.album = { items: [...album.items, ...page.items], hasOlder: page.hasOlder };
  set({});
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

/**
 * Give somebody back what they typed, when the write was REFUSED.
 *
 * A refusal is not a failure. Nothing was written server-side and nothing was
 * charged, which is right — so the optimistic bubble is reconciled away when
 * the window is re-read, which is also right. But the composer had already
 * been cleared on submit, so the sentence vanished from both places at once:
 * somebody who had just hit the day's limit also lost what they wrote.
 *
 * THE RULE, and it holds anywhere a write is refused rather than failed: if
 * the message is not going to remain on screen, the text goes back in the
 * box. They can copy it, or send it tomorrow.
 *
 * Not restored over something they have started typing while waiting — their
 * newer sentence is the one they care about, and clobbering it would be the
 * same mistake pointed the other way.
 *
 * A FAILED send is the other case and is deliberately not this: the bubble
 * stays, marked "not sent", with a Try again beside it. The words are still
 * on screen, so putting them in the box as well would duplicate them.
 */
function restoreComposer(text: string): void {
  if (text === '') return;
  const input = regions().composer.querySelector('.composer__input') as HTMLInputElement | null;
  if (input === null || input.value !== '') return;
  input.value = text;
}

async function send(text: string, attachment: { id: string; kind: string; contentType: string } | null = null): Promise<void> {
  const state = current();
  const me = state.me!;
  const conversationId = currentThreadId();
  // A photograph with no words is a whole message; empty is only empty when
  // there is nothing attached either.
  if (conversationId === null || (text.trim() === '' && attachment === null)) return;

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
      `/api/conversations/${conversationId}/messages`,
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
          // A REFUSAL. The message was not written, so it will disappear when
          // the window is re-read — and their words would disappear with it.
          set({ limitLine: String(event.data['line'] ?? '') });
          restoreComposer(text);
        } else if (event.event === 'attachment_failed') {
          // Her sentence, in the conversation. Nothing was charged and no
          // message was written, so the composer comes back — with what they
          // typed still in it, for the same reason as above.
          set({ error: String(event.data['line'] ?? '') });
          restoreComposer(text);
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

  // Remembered HERE and not in manageFocus, because by the time that runs the
  // control has already been repainted out of existence — the click that
  // opens a sheet triggers a draw, and a draw replaces whole regions. This is
  // the last moment the opener is still on the page.
  if (returnFocusTo === null) {
    returnFocusTo = id === ''
      ? `[data-action="${action}"]`
      : `[data-action="${action}"][data-id="${id}"]`;
  }

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
  } else if (action === 'story-filter') {
    // The empty string is "everything": a data attribute cannot hold null,
    // and a filter of '' would match no event type.
    screenData.storyFilter = actor.dataset['value'] === '' ? null : actor.dataset['value']!;
    set({});
  } else if (action === 'remove-story') {
    void removeStoryEvent(id);
  } else if (action === 'resend-verification') {
    void resendVerification();
  } else if (action === 'threads') {
    void openThreads();
  } else if (action === 'close-threads') {
    screenData.threadsOpen = false;
    set({});
  } else if (action === 'open-thread') {
    screenData.threadsOpen = false;
    go(`/chat/${id}`);
  } else if (action === 'new-thread') {
    const kind = actor.dataset['kind'] as 'side' | 'incognito';
    void startThread(kind, kind === 'incognito' ? scenarioTyped() : null);
  } else if (action === 'end-thread') {
    screenData.scenarioOpen = false;
    void endThread(id);
  } else if (action === 'scenario') {
    screenData.scenarioOpen = true;
    set({});
  } else if (action === 'close-scenario') {
    screenData.scenarioOpen = false;
    set({});
  } else if (action === 'scenario-save') {
    void setScenario(id, scenarioTyped());
  } else if (action === 'scenario-clear') {
    void setScenario(id, null);
  } else if (action === 'consent-adult') {
    consentState.adult = actor.dataset['value'] === 'yes';
    set({});
  } else if (action === 'consent-agree') {
    consentState.agreed = !consentState.agreed;
    set({});
  } else if (action === 'set-gender') {
    void saveSetting({ assistantGender: actor.dataset['key'] });
  } else if (action === 'set-dial') {
    void saveSetting({ personality: { [actor.dataset['key']!]: actor.dataset['stop'] } });
  } else if (action === 'toggle-quiet') {
    void saveSetting({ quietHours: { enabled: !(screenData.settings?.quietHours.enabled ?? false) } });
  } else if (action === 'set-quiet-start') {
    void saveSetting({ quietHours: { startHour: Number(actor.dataset['key']) } });
  } else if (action === 'set-quiet-end') {
    void saveSetting({ quietHours: { endHour: Number(actor.dataset['key']) } });
  } else if (action === 'upgrade') {
    void goToStripe('/api/subscription/checkout');
  } else if (action === 'manage-plan') {
    void goToStripe('/api/subscription/portal');
  } else if (action === 'retry') {
    void boot();
  } else if (action === 'open-photo') {
    screenData.viewing = id;
    set({});
  } else if (action === 'close-photo') {
    screenData.viewing = null;
    set({});
  } else if (action === 'album-older') {
    void loadOlderPhotos();
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
  } else if (action === 'set-language') {
    void saveSetting({ languageStyle: actor.dataset['key'] });
  } else if (action === 'set-gender') {
    void saveSetting({ assistantGender: actor.dataset['key'] });
  } else if (action === 'set-dial') {
    void saveSetting({ personality: { [actor.dataset['key']!]: actor.dataset['stop'] } });
  } else if (action === 'toggle-quiet') {
    void saveSetting({ quietHours: { enabled: !(screenData.settings?.quietHours.enabled ?? false) } });
  } else if (action === 'set-quiet-start') {
    void saveSetting({ quietHours: { startHour: Number(actor.dataset['key']) } });
  } else if (action === 'set-quiet-end') {
    void saveSetting({ quietHours: { endHour: Number(actor.dataset['key']) } });
  } else if (action === 'upgrade') {
    void goToStripe('/api/subscription/checkout');
  } else if (action === 'manage-plan') {
    void goToStripe('/api/subscription/portal');
  } else if (action === 'retry') {
    const message = current().messages.find((candidate) => candidate.id === id);
    if (message !== undefined) {
      set({ messages: current().messages.filter((candidate) => candidate.id !== id) });
      void send(message.body);
    }
  }
});

// Both search fields, debounced: every keystroke is a scan over everything
// this account has said or she has remembered, and someone typing one word
// would otherwise run six of them.
document.addEventListener('input', (event) => {
  const field = (event.target as HTMLElement).closest('[data-action="memory-search"], [data-action="search"]') as HTMLInputElement | null;
  if (field === null) return;
  const scoped = field.dataset['action'] === 'memory-search';
  if (scoped) screenData.query = field.value;
  clearTimeout(searchTimer);
  const value = field.value;
  searchTimer = setTimeout(
    () => { void (scoped ? load('/memory') : runSearch(value)); },
    SEARCH_DEBOUNCE_MS,
  ) as unknown as number;
});
let searchTimer = 0;
const SEARCH_DEBOUNCE_MS = 220;

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
  const settingForm = target.closest('[data-action="save-setting"]') as HTMLFormElement | null;
  if (settingForm !== null) {
    event.preventDefault();
    const field = settingForm.dataset['field']!;
    const value = String(new FormData(settingForm).get('value') ?? '').trim();
    if (value !== '') void saveSetting({ [field]: value });
    return;
  }
  const forgotForm = target.closest('[data-action="forgot"]') as HTMLFormElement | null;
  if (forgotForm !== null) {
    event.preventDefault();
    void requestReset(String(new FormData(forgotForm).get('email') ?? ''));
    return;
  }
  const resetForm = target.closest('[data-action="reset"]') as HTMLFormElement | null;
  if (resetForm !== null) {
    event.preventDefault();
    void completeReset(String(new FormData(resetForm).get('password') ?? ''));
    return;
  }
  const profileForm = target.closest('[data-action="save-profile"]') as HTMLFormElement | null;
  if (profileForm !== null) {
    event.preventDefault();
    const section = profileForm.dataset['section']!;
    const body = String(new FormData(profileForm).get('body') ?? '');
    void saveProfileSection(section, body);
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

async function runSearch(query: string): Promise<void> {
  if (query.trim().length < 2) {
    screenData.search = { query, conversations: [], memories: [] };
    set({});
    return;
  }
  screenData.search = await get<Search>(`/api/search?q=${encodeURIComponent(query)}`);
  set({});
}

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
  // PRD §10: voice is paid-only. The button STAYS — hiding a feature is how
  // nobody learns it exists, and §11's quiet upgrade is about not nagging,
  // not about hiding. What changes is that nothing is recorded and nothing
  // is uploaded: she answers in the conversation, once, and the person's
  // storage is not spent on bytes the server is going to refuse.
  //
  // The server refuses independently (wiring.ts). A client check is a
  // courtesy, never a gate.
  if (me.user.plan === 'free') {
    set({ error: t('error.voice_not_on_plan', me.user.language, me.assistant.gender) });
    return;
  }
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
      // The recorder has always known this; it was only used to decide
      // whether the clip was long enough to send. The server floors it with
      // what the bytes prove, so an honest number is charged accurately and
      // a made-up one buys nothing (DECISIONS §29).
      durationSeconds: seconds,
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

/**
 * Take an event off the timeline (UI-UX §8).
 *
 * Re-read from the server rather than spliced out of the array: the server
 * refuses a derived milestone, so a client that removed the row optimistically
 * would show it gone and put it back on the next visit.
 */
async function removeStoryEvent(id: string): Promise<void> {
  await remove(`/api/story/${id}`);
  screenData.story = await get<Story>('/api/story');
  set({});
}

// ── boot ──────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  set({ path: location.pathname });
  // Before anything else: the link was clicked, and it should work whether or
  // not there is a session in this browser.
  if (location.pathname === '/confirm-email') await confirmEmailFromLink();
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
    // Anything else — the server is down, the database is unreachable, the
    // network went away mid-request. It arrives as her saying so, on a screen
    // with a way to try again, rather than as a blank page and a console
    // message nobody will read.
    go('/outage', true);
  }
}

// ── accounts ──────────────────────────────────────────────────────────────

/**
 * Ask for a reset link.
 *
 * The screen shows the same sentence whatever happens, INCLUDING when the
 * request fails — a network error that revealed nothing is still nothing, and
 * a different message here would be the enumeration oracle the endpoint was
 * built to avoid. A rate-limit refusal is the one exception, because being
 * told to slow down is about the requester rather than the account.
 */
async function requestReset(email: string): Promise<void> {
  set({ busy: true, error: null });
  try {
    const answer = await post<{ status: string; canEmail?: boolean }>('/api/auth/forgot', { email });
    recovery.canEmail = answer.canEmail !== false;
    recovery.sent = true;
    set({ busy: false });
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      set({ busy: false, error: error.message });
      return;
    }
    recovery.sent = true;
    set({ busy: false });
  }
}

async function completeReset(password: string): Promise<void> {
  const language = document.documentElement.getAttribute('dir') === 'rtl' ? 'ar' : 'en';
  const token = new URLSearchParams(location.search).get('token') ?? '';
  set({ busy: true, error: null });
  try {
    await post('/api/auth/reset', { token, password });
    set({ busy: false });
    await boot();
    go('/chat', true);
  } catch (error) {
    const message = error instanceof ApiError
      ? error.code === 'weak_password' ? t('entry.weak_password', language)
        : error.code === 'reset_invalid' ? t('recover.expired', language)
        : error.message
      : t('error.send_failed', language);
    set({ busy: false, error: message });
  }
}

async function submitCredentials(form: HTMLFormElement, route: 'sign-up' | 'sign-in'): Promise<void> {
  const data = new FormData(form);
  set({ busy: true, error: null });
  try {
    const body = {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      ...(route === 'sign-up'
        ? {
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            // UI-UX §22: both answers, from the consent screen that had to be
            // passed to get here. The server refuses without them, so a
            // client that skipped the screen gets a 403, not an account.
            isAdult: consentState.adult === true,
            agreedToTerms: consentState.agreed,
            // The language these screens were RENDERED in, so her authored
            // opening is in the one they were just reading. It is not a
            // setting — the server keeps language_style on 'auto' and
            // onboarding still asks, because this is the browser's guess
            // rather than their answer.
            language: document.documentElement.getAttribute('dir') === 'rtl' ? 'ar' : 'en',
          }
        : {}),
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
        : error.code === 'under_age' ? t('consent.under_age', language)
        : error.code === 'consent_required' ? t('consent.required', language)
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
