// Routing.
//
// Real paths, not hashes: the server serves the shell for anything that is
// not /api or an asset, so a deep link works on first load and the address
// bar is honest. Back and forward are the browser's.
export type Route = { readonly pattern: string; readonly screen: string };

/** Every screen the product has. The nav and the drawer link into it. */
export const ROUTES: readonly Route[] = [
  { pattern: '/', screen: 'chat' },
  { pattern: '/chat', screen: 'chat' },
  { pattern: '/chat/:id', screen: 'chat' },
  { pattern: '/tasks', screen: 'tasks' },
  { pattern: '/money', screen: 'money' },
  { pattern: '/story', screen: 'story' },
  { pattern: '/settings', screen: 'settings' },
  { pattern: '/settings/language', screen: 'language' },
  { pattern: '/memory', screen: 'memory' },
  { pattern: '/security', screen: 'security' },
  { pattern: '/data', screen: 'data' },
  { pattern: '/profile', screen: 'profile' },
  // In the drawer (PRD §13) and in the specs, and not built in this run.
  // They are routes so that tapping one says so, rather than quietly
  // rendering the conversation.
  { pattern: '/search', screen: 'search' },
  { pattern: '/album', screen: 'album' },
  { pattern: '/briefing', screen: 'briefing' },
  { pattern: '/health', screen: 'health' },
  { pattern: '/assistants', screen: 'soon' },
  { pattern: '/subscription', screen: 'soon' },
  { pattern: '/settings/identity', screen: 'soon' },
  { pattern: '/settings/personality', screen: 'soon' },
  { pattern: '/settings/quiet-hours', screen: 'soon' },
  { pattern: '/tasks/:id', screen: 'tasks' },
  { pattern: '/money/:id', screen: 'money' },
  { pattern: '/notes/:id', screen: 'tasks' },
  { pattern: '/welcome', screen: 'welcome' },
  { pattern: '/sign-in', screen: 'signIn' },
  { pattern: '/sign-up', screen: 'signUp' },
  { pattern: '/confirm-device', screen: 'confirmDevice' },
];

export type Match = { screen: string; params: Record<string, string> };

export function match(path: string): Match | null {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  for (const route of ROUTES) {
    const pattern = route.pattern.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (const [index, segment] of pattern.entries()) {
      const actual = parts[index]!;
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(actual);
      else if (segment !== actual) { ok = false; break; }
    }
    if (ok) return { screen: route.screen, params };
  }
  return null;
}

/** Which bottom-nav tab a path lights up. Derived from the path so a deep
 *  link into a screen still shows where you are (design.md §11). */
export function tabFor(path: string): 'chat' | 'tasks' | 'money' | 'story' | 'settings' | 'none' {
  if (path === '/' || path.startsWith('/chat')) return 'chat';
  if (path.startsWith('/tasks')) return 'tasks';
  if (path.startsWith('/money')) return 'money';
  if (path.startsWith('/story')) return 'story';
  if (path.startsWith('/settings')) return 'settings';
  return 'none';
}
