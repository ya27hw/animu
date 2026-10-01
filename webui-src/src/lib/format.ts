export const DAY = 86_400_000;

export function titleOf(t?: { romaji?: string; english?: string | null; native?: string | null } | null, pref: 'romaji' | 'english' = 'romaji'): string {
  if (!t) return 'Untitled';
  return (pref === 'english' ? t.english || t.romaji : t.romaji || t.english) || t.native || 'Untitled';
}

export function bytes(n?: number | null): string {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function speed(n?: number | null): string {
  return !n ? '—' : `${bytes(n)}/s`;
}

export function eta(seconds?: number | null): string {
  if (seconds == null || seconds < 0 || seconds >= 8_640_000) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function countdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;

export function relative(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null) return '—';
  const t = typeof iso === 'number' ? (iso < 1e12 ? iso * 1000 : iso) : Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  if (!rtf) return new Date(t).toLocaleString();
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 2700) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 79_200) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 2_332_800) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function clock(iso: string | number | null | undefined): string {
  if (iso == null) return '—';
  const t = typeof iso === 'number' ? (iso < 1e12 ? iso * 1000 : iso) : Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function weekdayTime(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null) return '';
  const t = typeof iso === 'number' ? (iso < 1e12 ? iso * 1000 : iso) : Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const today = new Date(now);
  const same = d.toDateString() === today.toDateString();
  const tomorrow = new Date(now + DAY).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (same) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

export function dayLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === new Date(now - DAY).toDateString()) return 'Yesterday';
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Strip AniList's HTML description down to safe plain text with line breaks. */
export function plainText(html?: string | null): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function initials(s: string): string {
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
}

/** Pick readable text over an arbitrary AniList cover colour. */
export function tint(color?: string | null, fallback = '#ff7a4d'): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}
