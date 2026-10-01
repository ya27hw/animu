import { api } from './api';
import type { Anime, Status, Torrent } from './types';

export const app = $state({
  status: null as Status | null,
  statusError: false,
  anime: [] as Anime[],
  animeLoaded: false,
  animeError: '' as string,
  userName: '',
  downloads: [] as Torrent[],
  downloadsLoaded: false,
  titleLang: 'romaji' as 'romaji' | 'english',
});

export const theme = $state({ mode: 'dark' as 'dark' | 'light' });

export function initTheme(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem('animu.theme'); } catch { /* storage may be blocked */ }
  if (saved === 'light' || saved === 'dark') theme.mode = saved;
  else theme.mode = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme.mode;
  try {
    const lang = localStorage.getItem('animu.titleLang');
    if (lang === 'english' || lang === 'romaji') app.titleLang = lang;
  } catch { /* ignore */ }
}

export function toggleTheme(): void {
  theme.mode = theme.mode === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme.mode;
  try { localStorage.setItem('animu.theme', theme.mode); } catch { /* ignore */ }
}

export function setTitleLang(lang: 'romaji' | 'english'): void {
  app.titleLang = lang;
  try { localStorage.setItem('animu.titleLang', lang); } catch { /* ignore */ }
}

export async function loadStatus(): Promise<void> {
  try {
    app.status = await api.get<Status>('/api/status');
    app.statusError = false;
  } catch {
    app.statusError = true;
  }
}

export async function loadAnime(): Promise<void> {
  try {
    const res = await api.get<{ userName: string; anime: Anime[] }>('/api/anime');
    app.anime = res.anime;
    app.userName = res.userName;
    app.animeError = '';
  } catch (e) {
    app.animeError = e instanceof Error ? e.message : 'Could not load your library';
  } finally {
    app.animeLoaded = true;
  }
}

export async function loadDownloads(): Promise<void> {
  try {
    const list = await api.get<Torrent[]>('/api/downloads');
    app.downloads = Array.isArray(list) ? list : [];
  } catch {
    /* keep the last good snapshot */
  } finally {
    app.downloadsLoaded = true;
  }
}

/**
 * Run `fn` every `ms` while the tab is visible. Pauses when hidden and
 * refreshes immediately on return, so a background tab costs nothing.
 */
export function poll(fn: () => unknown, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const start = () => { if (!timer) timer = setInterval(() => { void fn(); }, ms); };
  const stop = () => { if (timer) { clearInterval(timer); timer = undefined; } };
  const onVis = () => {
    if (document.hidden) stop();
    else { void fn(); start(); }
  };
  document.addEventListener('visibilitychange', onVis);
  void fn();
  if (!document.hidden) start();
  return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
}

export const attention = (a: Anime): boolean => a.state === 'not_found' || a.state === 'error' || a.state === 'search_error';
