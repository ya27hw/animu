// Dev-only mock of the Animu backend (`npm run dev:mock`). Serves dev/fixtures.json
// (built by dev/make_fixtures.py from AniList's public API) with in-memory state,
// so the UI can be developed and screenshotted without PocketBase, qBittorrent
// or an AniList login. Never part of the production build.
import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fx = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures.json', import.meta.url)), 'utf8'));
const t0 = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const anime: any[] = fx.anime;
const ignored: any[] = [{ id: 'ig1', title: 'Some Ecchi Show', media_id: null, added_at: iso(t0 - 9e8) }];
let history: any[] = anime.flatMap((a, i) =>
  Array.from({ length: i % 3 === 0 ? 3 : 2 }, (_, k) => ({
    id: `h${i}-${k}`,
    title: `[SubsPlease] ${a.media.title.romaji} - ${String(Math.max(1, a.airedEpisodes - k)).padStart(2, '0')} (1080p) [${(0xabcd0000 + i * 977 + k).toString(16).toUpperCase()}].mkv`,
    link: 'https://nyaa.si/download/1.torrent',
    added_at: iso(t0 - (i * 5 + k * 160) * 36e5 / 3),
    anime_title: a.media.title.romaji,
    episode: Math.max(1, a.airedEpisodes - k),
    size: `${(1.1 + ((i + k) % 5) * 0.2).toFixed(1)} GiB`,
    seeders: String(40 + ((i * 13 + k * 7) % 160)),
    cover_image: a.media.coverImage.large,
    source: k === 2 && i % 4 === 0 ? 'manual' : 'auto',
  })),
).sort((a, b) => Date.parse(b.added_at) - Date.parse(a.added_at));

let config: Record<string, any> = {
  aniUserName: 'yousuf', qbit_url: 'http://10.0.0.50:8080', username: 'admin', rootDir: '/storage/media/anime', altRootDir: '/storage/media/homework',
  resolution: '1080', nyaaUrl: 'https://nyaa.si', altNyaaUrl: 'https://nyaa.si', triggerGenre: 'Ecchi', interval: 30, offpeakInterval: 25,
  excludeReleaseGroups: ['Judas'], releaseGroupTierOverrides: {}, setCompletedToRewatching: true, useProxy: false, proxyAddress: '10.0.0.90', proxyPort: 8888,
  preferReleaseGroup: true, preferJapaneseDub: false, requireEnglishSubs: false, preferUncensored: true, discordEnableDownload: true, discordEnableFail: true,
  discordFailThreshold: 7, anilistClientId: '12345',
};
let authed = true;

const torrents = anime.slice(0, 5).map((a, i) => ({
  hash: (i + 1).toString(16).repeat(40).slice(0, 40),
  name: `${a.media.title.romaji} - ${a.airedEpisodes}`,
  size: (1.2 + i * 0.15) * 1024 ** 3,
  state: ['downloading', 'downloading', 'stalledDL', 'metaDL', 'pausedDL'][i],
  statusKind: ['downloading', 'downloading', 'stalled', 'checking', 'paused'][i],
  statusLabel: ['Downloading', 'Downloading', 'Stalled', 'Fetching metadata', 'Paused'][i],
  base: [0.42, 0.78, 0.13, 0.0, 0.55][i],
  rate: [12.4, 6.1, 0, 0, 0][i] * 1024 ** 2,
  num_seeds: [38, 120, 2, 0, 11][i],
}));

const events = () => [
  { at: iso(Date.now() - 3 * 60_000), ts: 0, level: 'info', message: 'Cycle finished in 74s: 2 episode(s) downloaded, 1 failed, 2 backing off' },
  { at: iso(Date.now() - 4 * 60_000), ts: 0, level: 'error', message: 'Dr. Stone: KeyError: romaji' },
  { at: iso(Date.now() - 5 * 60_000), ts: 0, level: 'warning', message: 'Search unavailable for Witch Watch: Nyaa did not return a usable feed for any query' },
  { at: iso(Date.now() - 6 * 60_000), ts: 0, level: 'info', message: 'Cycle started' },
  { at: iso(Date.now() - 36 * 60_000), ts: 0, level: 'info', message: 'Cycle finished in 61s: 0 episode(s) downloaded, 0 failed, 3 backing off' },
];

const logLines = () => Array.from({ length: 140 }, (_, i) => {
  const lvl = i % 17 === 0 ? 'WARNING' : i % 41 === 0 ? 'ERROR' : 'INFO';
  const a = anime[i % anime.length];
  const msgs = [`[SYNC_STATE] ${a.media.title.romaji} (ID ${a.mediaId}) downloaded_episodes=${a.downloadedEpisodes.length}, timeouts=0`,
    `Searching for ${a.media.title.romaji} (ID: ${a.mediaId}) episode(s) [${a.airedEpisodes}]`, `Sent Add Request to qBittorrent: ${a.media.title.romaji} - ${a.airedEpisodes}. Verifying...`,
    `Torrent ${a.media.title.romaji} - ${a.airedEpisodes} successfully verified in qBittorrent.`, `Next run for ${a.media.title.romaji} in 95 minutes`];
  const t = new Date(t0 - (140 - i) * 41_000).toISOString().replace('T', ' ').slice(0, 19);
  return `${t},${String(i * 7 % 1000).padStart(3, '0')} - ${msgs[i % msgs.length]}${lvl === 'ERROR' ? ' [ERROR] boom' : lvl === 'WARNING' ? ' [WARNING]' : ''}`;
}).join('\n');

const nyaaResults = (title: string, ep: number) => [
  ['SubsPlease', 1.4, 213, 'Jpn', 'Eng', 4.72], ['Erai-raws', 1.1, 154, 'Jpn', 'Eng (multi)', 4.7], ['ToonsHub', 2.1, 87, 'Jpn', 'Eng', 4.55],
  ['Judas', 0.9, 31, 'Jpn', 'Eng', 4.1], ['EMBER', 1.3, 12, 'Jpn', 'Eng', 3.9],
].map(([g, size, seeds, au, su, score]: any, i) => ({
  title: `[${g}] ${title} - ${String(ep).padStart(2, '0')} (1080p) [${(0xA1B2C3D0 + i).toString(16).toUpperCase()}].mkv`,
  link: `https://nyaa.si/download/${100 + i}.torrent`, seeders: String(seeds), size: `${size} GiB`,
  pubDate: new Date(Date.now() - (i + 1) * 7_200_000).toUTCString(), score, audioLabel: au === 'Jpn' ? 'Japanese' : au, subtitleLabel: su,
  details: { episode_match: true, resolution_match: true },
}));

const json = (res: any, status: number, body: unknown, delay = 0) => {
  const send = () => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  delay ? setTimeout(send, delay) : send();
};
const readBody = (req: any): Promise<any> => new Promise((resolve) => {
  let data = ''; req.on('data', (c: any) => (data += c)); req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
});

export function mockApi(): Plugin {
  return {
    name: 'animu-mock-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const p = url.pathname;
        if (!p.startsWith('/api/')) return next();
        const m = req.method ?? 'GET';
        const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);
        const sp = url.searchParams;
        let r: RegExpMatchArray | null;

        if (p === '/api/status') {
          return json(res, 200, {
            scheduler: {
              ok: true, ready: true, live: true, scheduler_running: true, cycle_running: false, cycle_running_since: null,
              last_cycle_started_at: iso(t0 - 18 * 60_000), last_cycle_completed_at: iso(t0 - 16 * 60_000), last_success_at: iso(t0 - 16 * 60_000),
              next_run_at: iso(Math.max(Date.now() + 20_000, t0 + 12 * 60_000 - ((Date.now() - t0) % (30 * 60_000)))), last_error_type: null, degraded: true,
              cycle: { duration_seconds: 74, total: 14, ignored: 1, backing_off: 3, up_to_date: 6, queued: 4, downloaded_episodes: 2, not_found: 1, search_errors: 1, failed: [{ title: 'Dr. STONE', error: "KeyError: 'romaji'" }], aborted: null },
              dependency: { pocketbase: { authenticated: true, offline_safe_mode: false, status: 'authenticated' } },
            },
            services: {
              pocketbase: { authenticated: true, offline_safe_mode: false, status: 'authenticated' },
              qbittorrent: { authenticated: true, lastAuthStatus: 200, lastAddError: '' },
              anilist: { authenticated: authed, userName: 'yousuf' },
            },
            intervalMinutes: 30,
          }, 60);
        }
        if (p === '/api/anime') return json(res, 200, { userName: 'yousuf', count: anime.length, anime }, 120);
        if (p === '/api/events') return json(res, 200, { events: events() });
        if (p === '/api/downloads') {
          const el = (Date.now() - t0) / 1000;
          return json(res, 200, torrents.map((t) => {
            const progress = Math.min(0.99, t.base + (t.rate ? (el * t.rate) / t.size : 0));
            return { ...t, progress, dlspeed: t.rate, downloaded: progress * t.size, eta: t.rate ? ((1 - progress) * t.size) / t.rate : 8640000 };
          }));
        }
        if ((r = p.match(/^\/api\/downloads\/([0-9a-f]{40})(\/retry)?$/))) return json(res, 200, { ok: true, message: m === 'DELETE' ? 'Removed' : 'Resumed' });
        if (p === '/api/history' && m === 'GET') {
          const limit = Number(sp.get('limit') ?? 1000), offset = Number(sp.get('offset') ?? 0);
          return json(res, 200, { count: history.length, history: history.slice(offset, offset + limit) }, 90);
        }
        if (p === '/api/history' && m === 'DELETE') { history = []; return json(res, 200, { ok: true }); }
        if ((r = p.match(/^\/api\/history\/([\w-]+)$/)) && m === 'DELETE') {
          history = history.filter((h) => h.id !== r![1]); return json(res, 200, { ok: true, action: sp.get('action') ?? 'delete' });
        }
        if ((r = p.match(/^\/api\/history\/([\w-]+)\/(rerun|ignore-redownload)$/))) { history = history.filter((h) => h.id !== r![1]); return json(res, 200, { ok: true, action: r[2], message: 'Done' }); }
        if (p === '/api/logs') {
          const key = sp.get('name') ?? 'combined';
          return json(res, 200, { selected: key, available: [{ key: 'combined', label: 'Combined' }, { key: 'out', label: 'Stdout' }, { key: 'error', label: 'Stderr' }], path: `/app/logs/animu${key === 'combined' ? '' : '-' + key}.log`, lines: Number(sp.get('lines') ?? 250), content: logLines() }, 80);
        }
        if (p === '/api/search-debug') {
          return json(res, 200, anime.filter((a) => ['not_found', 'error'].includes(a.state)).map((a) => ({
            media_id: a.mediaId, anime_title: a.media.title.romaji, english_title: a.media.title.english, search_query: `${a.media.title.romaji} "${a.airedEpisodes}"`,
            status: 'NO_MATCH', unresolved: true, last_attempt: Date.now() / 1000 - 1500, timeouts: 3, max_timeouts: 3,
            season_info: { format: a.media.format, episodes: a.media.episodes, status: a.media.status },
            candidates: [{ title: `[Judas] ${a.media.title.romaji} - ${a.airedEpisodes - 1} (1080p)`, rating: 2.4 }, { title: `${a.media.title.romaji} Season 2 - 01 [720p]`, rating: 1.6 }],
          })));
        }
        if (p === '/api/config' && m === 'GET') return json(res, 200, config);
        if (p === '/api/config' && m === 'PATCH') { config = { ...config, ...body }; return json(res, 200, { ok: true, config }, 200); }
        if (p.startsWith('/api/test/')) return json(res, 200, { ok: p !== '/api/test/proxy', message: p === '/api/test/proxy' ? undefined : 'Connection successful.', error: p === '/api/test/proxy' ? 'Proxy unreachable (timeout)' : undefined }, 500);
        if (p === '/api/anilist/auth/state') return json(res, 200, { authenticated: authed, needsReauth: false, userName: 'yousuf', tokenExpiry: { present: true, expired: false, expiresAt: iso(t0 + 290 * 864e5), daysRemaining: 290 } });
        if (p === '/api/anilist/auth/pin') return json(res, 200, { authUrl: 'https://anilist.co/api/v2/oauth/authorize?client_id=12345&response_type=code', grantType: 'code', pinRedirect: true });
        if (p === '/api/anilist/auth/callback') { authed = true; return json(res, 200, { ok: true, authenticated: true, userName: 'yousuf' }, 400); }
        if (p === '/api/anilist/auth/clear') { authed = false; return json(res, 200, { ok: true, authenticated: false }); }
        if (p === '/api/ignored' && m === 'GET') return json(res, 200, { count: ignored.length, ignored });
        if (p === '/api/ignored' && m === 'POST') { const e = { id: 'ig' + Math.random(), title: body.title ?? '', media_id: body.mediaId ?? null, added_at: iso(Date.now()) }; ignored.unshift(e); return json(res, 200, { ok: true, entry: e }); }
        if ((r = p.match(/^\/api\/ignored\/(.+)$/)) && m === 'DELETE') { const i = ignored.findIndex((x) => x.id === decodeURIComponent(r![1])); if (i >= 0) ignored.splice(i, 1); return json(res, 200, { ok: true }); }
        if (p === '/api/anilist/discover') {
          const t = sp.get('type') ?? 'trending';
          const map: Record<string, string> = { trending: 'trending', popular: 'popular', top: 'top', upcoming: 'upcoming', seasonal: 'seasonal' };
          return json(res, 200, { media: fx.rails[map[t] ?? 'trending'], pageInfo: { hasNextPage: false }, type: t }, 220);
        }
        if (p === '/api/anilist/search') {
          const term = (sp.get('q') ?? '').toLowerCase();
          const genre = sp.get('genre');
          const format = sp.get('format');
          const status = sp.get('status');
          const season = sp.get('season');
          const seasonYear = sp.get('seasonYear');
          const sort = sp.get('sort') ?? 'POPULARITY_DESC';
          let all = Object.values<any>(fx.detail);
          if (term) {
            all = all.filter((x) => `${x.title.romaji} ${x.title.english ?? ''}`.toLowerCase().includes(term));
          }
          if (genre) all = all.filter((x) => x.genres?.some((g: string) => genre.split(',').map((s) => s.trim().toLowerCase()).includes(g.toLowerCase())));
          if (format) all = all.filter((x) => format.split(',').map((s) => s.trim()).includes(x.format));
          if (status) all = all.filter((x) => status.split(',').map((s) => s.trim()).includes(x.status));
          if (season) all = all.filter((x) => x.season?.toLowerCase() === season.toLowerCase());
          if (seasonYear) all = all.filter((x) => String(x.seasonYear) === String(seasonYear));
          if (sort === 'score' || sort === 'SCORE_DESC') all.sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0));
          else if (sort === 'title' || sort === 'TITLE_ROMAJI') all.sort((a, b) => (a.title.romaji || '').localeCompare(b.title.romaji || ''));
          else if (sort === 'date' || sort === 'START_DATE_DESC' || sort === 'year') all.sort((a, b) => (b.seasonYear ?? 0) - (a.seasonYear ?? 0));
          else if (sort === 'trending' || sort === 'TRENDING_DESC') all.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
          return json(res, 200, {
            media: all.slice(0, Number(sp.get('perPage') ?? 30)).map((m: any) => {
              const inAnime = anime.find((x) => x.mediaId === m.id);
              if (inAnime) return { ...m, mediaListEntry: { id: m.id, status: 'CURRENT', progress: inAnime.progress } };
              if (m.id === 5114 || m.id === 16498 || m.id === 11061) return { ...m, mediaListEntry: { id: m.id, status: 'PLANNING', progress: 0 } };
              return m;
            }),
            pageInfo: { hasNextPage: false },
            query: sp.get('q'),
          }, 180);
        }
        if ((r = p.match(/^\/api\/anilist\/media\/(\d+)$/))) {
          const d = fx.detail[r[1]];
          if (!d) return json(res, 404, { error: 'Anime not found on AniList' });
          const mid = Number(r[1]);
          const inAnime = anime.find((x) => x.mediaId === mid);
          const enriched: any = { ...d };
          if (inAnime) {
            enriched.mediaListEntry = { id: mid, status: 'CURRENT', progress: inAnime.progress };
          } else if (mid === 5114 || mid === 16498 || mid === 11061) {
            enriched.mediaListEntry = { id: mid, status: 'PLANNING', progress: 0 };
          }
          return json(res, 200, { media: enriched }, 150);
        }
        if (p === '/api/anilist/completed-sequels') {
          const sq = fx.rails.upcoming.slice(0, 6).map((m: any, i: number) => ({ ...m, parentMedia: fx.rails.top[i % 12] }));
          return json(res, 200, { sequels: sq, groups: { finished: sq.slice(0, 2), airing: sq.slice(2, 4), upcoming: sq.slice(4) }, counts: { total: 6, finished: 2, airing: 2, upcoming: 2 } }, 260);
        }
        if (p === '/api/anilist/airing-today') return json(res, 200, { entries: fx.airing_today, windowHours: 24 }, 140);
        if (p === '/api/anilist/user-list') {
          let status = sp.get('statusIn') ?? 'PLANNING';
          if (status === 'REWATCHING') status = 'REPEATING';
          const entries = fx.rails.popular.concat(fx.rails.top).slice(0, 18).map((media: any, i: number) => ({ id: i + 1, mediaId: media.id, status, progress: status === 'COMPLETED' ? media.episodes ?? 12 : 0, score: 70 + (i % 5) * 5, media }));
          return json(res, 200, { lists: [{ name: status, status, entries }], hasNextChunk: false }, 300);
        }
        if (p === '/api/anilist/list/update') return json(res, 200, { SaveMediaListEntry: { id: 1, status: body.status, progress: body.progress } }, 250);
        if ((r = p.match(/^\/api\/anime\/(\d+)\/nyaa-search$/))) {
          const a = anime.find((x) => x.mediaId === Number(r![1]));
          const ep = body.episode ?? a?.airedEpisodes ?? 1;
          return json(res, 200, { mediaId: Number(r[1]), episode: ep, title: a?.media.title.romaji, count: 5, results: nyaaResults(a?.media.title.romaji ?? 'Show', ep) }, 700);
        }
        if ((r = p.match(/^\/api\/anime\/(\d+)\/nyaa-download$/))) {
          const a = anime.find((x) => x.mediaId === Number(r![1]));
          if (a && body.episode != null && !a.downloadedEpisodes.includes(Number(body.episode))) a.downloadedEpisodes.push(Number(body.episode));
          return json(res, 200, { ok: true, mediaId: Number(r[1]), episode: body.episode, title: a?.media.title.romaji }, 600);
        }
        if ((r = p.match(/^\/api\/anime\/(\d+)\/reset$/))) { const a = anime.find((x) => x.mediaId === Number(r![1])); if (a) a.downloadedEpisodes = []; return json(res, 200, { ok: true }); }
        if ((r = p.match(/^\/api\/anime\/(\d+)$/)) && m === 'PATCH') {
          const a = anime.find((x) => x.mediaId === Number(r![1]));
          if (a) {
            if ('alternativeTitle' in body) a.media.alternativeTitle = body.alternativeTitle || null;
            if ('startingEpisode' in body) a.media.startingEpisode = body.startingEpisode;
            if ('preferredReleaseGroup' in body) a.preferredReleaseGroup = body.preferredReleaseGroup || null;
            if ('requireJapaneseAudio' in body) a.requireJapaneseAudio = !!body.requireJapaneseAudio;
            if ('requireEnglishSubs' in body) a.requireEnglishSubs = !!body.requireEnglishSubs;
            if (body.retryNow) { a.state = 'pending'; a.nextAttemptAt = null; a.maxTimeouts = 0; }
            if (body.resetDownloadedEpisodes) a.downloadedEpisodes = [];
          }
          return json(res, 200, { ok: true, synced: true, warning: null }, 180);
        }
        if (p === '/api/scheduler/run') return json(res, 202, { ok: true, message: 'Cycle requested' }, 120);
        return json(res, 404, { error: 'Not found' });
      });
    },
  };
}
