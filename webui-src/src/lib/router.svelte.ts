export type RouteName = 'today' | 'library' | 'discover' | 'queue' | 'history' | 'activity' | 'settings' | 'notfound';

export interface Route {
  name: RouteName;
  id: number | null;
  query: URLSearchParams;
}

export const nav = $state({ path: typeof location !== 'undefined' ? location.pathname + location.search : '/' });

const NAMES: RouteName[] = ['today', 'library', 'discover', 'queue', 'history', 'activity', 'settings'];

export function parse(full: string): Route {
  const [pathname, search = ''] = full.split('?');
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const query = new URLSearchParams(search);
  if (parts.length === 0) return { name: 'today', id: null, query };
  const head = parts[0] as RouteName;
  if (!NAMES.includes(head)) {
    if (/^\d+$/.test(head)) return { name: 'today', id: Number(head), query };
    return { name: 'notfound', id: null, query };
  }
  const id = parts[1] && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null;
  return { name: head, id, query };
}

export function openAnimeView(id: number, extraQuery?: Record<string, string | null | undefined>): void {
  const cur = parse(nav.path);
  const p = new URLSearchParams(cur.query);
  if (extraQuery) {
    for (const [k, v] of Object.entries(extraQuery)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
  }
  const qs = p.toString();
  const baseName = cur.name === 'notfound' || cur.name === 'today' ? 'today' : cur.name;
  const target = `/${baseName}/${id}${qs ? `?${qs}` : ''}`;
  navigateKeepScroll(target);
}

export function closeAnimeView(): void {
  const cur = parse(nav.path);
  const p = new URLSearchParams(cur.query);
  p.delete('tab');
  p.delete('ep');
  const qs = p.toString();
  const baseName = cur.name === 'today' ? '/' : `/${cur.name}`;
  const target = `${baseName}${qs ? `?${qs}` : ''}`;
  navigateKeepScroll(target);
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === nav.path) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  nav.path = to;
  // New page: start at the top unless we only opened/closed a sheet.
  window.scrollTo({ top: 0 });
}

/** Change only the URL (used when a sheet opens/closes over the same page). */
export function navigateKeepScroll(to: string, opts: { replace?: boolean } = {}): void {
  if (to === nav.path) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  nav.path = to;
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    nav.path = location.pathname + location.search;
  });
}

/** Click handler for <a> tags: client-side navigation unless the user wants a new tab. */
export function link(e: MouseEvent, to: string, keepScroll = false): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  (keepScroll ? navigateKeepScroll : navigate)(to);
}
