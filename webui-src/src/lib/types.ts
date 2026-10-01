export interface CoverImage { medium?: string; large?: string; extraLarge?: string; color?: string | null }
export interface Title { romaji?: string; english?: string | null; native?: string | null }
export interface NextAiring { episode: number; timeUntilAiring?: number; airingAt?: number }

export interface Media {
  id: number;
  title: Title;
  coverImage?: CoverImage;
  bannerImage?: string | null;
  episodes?: number | null;
  status?: string;
  format?: string;
  genres?: string[];
  averageScore?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  description?: string | null;
  nextAiringEpisode?: NextAiring | null;
  localState?: { tracked: boolean; downloadedEpisodes?: number[] };
  mediaListEntry?: { status?: string; progress?: number } | null;
}

export type ShowState =
  | 'pending' | 'downloaded' | 'up_to_date' | 'waiting_release'
  | 'not_found' | 'backoff' | 'search_error' | 'error';

export interface Anime {
  mediaId: number;
  progress: number;
  downloadedEpisodes: number[];
  preferredReleaseGroup: string | null;
  releaseGroupMisses: number;
  requireJapaneseAudio: boolean;
  requireEnglishSubs: boolean;
  airedEpisodes: number | null;
  nextAirAt: string | null;
  state: ShowState;
  stateDetail: string;
  nextAttemptAt: string | null;
  timeouts: number;
  maxTimeouts: number;
  media: {
    title: Title;
    coverImage?: CoverImage;
    genres?: string[];
    format?: string;
    episodes?: number | null;
    status?: string;
    nextAiringEpisode?: NextAiring | null;
    alternativeTitle: string | null;
    startingEpisode: number;
    preferredReleaseGroup: string | null;
  };
}

export interface CycleStats {
  started_at?: string;
  duration_seconds?: number;
  total?: number;
  ignored?: number;
  backing_off?: number;
  up_to_date?: number;
  queued?: number;
  downloaded_episodes?: number;
  not_found?: number;
  search_errors?: number;
  failed?: { title: string; error: string }[];
  aborted?: string | null;
  anilist_stale_seconds?: number | null;
}

export interface Health {
  ok: boolean;
  ready: boolean;
  scheduler_running: boolean;
  cycle_running: boolean;
  cycle_running_since: string | null;
  last_cycle_started_at: string | null;
  last_cycle_completed_at: string | null;
  last_success_at: string | null;
  next_run_at: string | null;
  last_error_type: string | null;
  degraded: boolean;
  cycle: CycleStats;
  dependency: { pocketbase: { authenticated: boolean; offline_safe_mode: boolean; status: string } };
}

export interface Status {
  scheduler: Health;
  services: {
    pocketbase: { authenticated: boolean; offline_safe_mode: boolean; status: string };
    qbittorrent: { authenticated: boolean; lastAuthStatus: number; lastAddError: string };
    anilist: { authenticated: boolean; userName: string };
  };
  intervalMinutes: number;
}

export interface Torrent {
  hash: string;
  name: string;
  progress: number;
  dlspeed: number;
  eta: number;
  size?: number;
  downloaded?: number;
  state: string;
  statusKind: string;
  statusLabel: string;
  num_seeds?: number;
}

export interface HistoryItem {
  id: string;
  title: string;
  link: string;
  added_at: string;
  anime_title?: string | null;
  episode?: number | string | null;
  size?: string | null;
  seeders?: string | number | null;
  cover_image?: string | null;
  source: string;
}

export interface SchedulerEvent { at: string; ts: number; level: 'info' | 'warning' | 'error'; message: string }

export interface NyaaResult {
  title: string; link: string; seeders: string; size: string; pubDate: string;
  score: number | null; audioLabel?: string; subtitleLabel?: string; audioRank?: number;
  details?: Record<string, unknown> | null;
}

export interface FailedTrace {
  media_id: number; anime_title: string; english_title?: string | null; search_query: string;
  status: string; candidates: { title: string; rating: number }[]; last_attempt: number;
  timeouts?: number; max_timeouts?: number; unresolved?: boolean;
  season_info?: { format?: string; episodes?: number; status?: string };
}

export interface AiringItem {
  mediaId: number; title: string; coverImage?: string; episode: number; airingAt: number; timeUntilAiring: number; progress: number;
}

export type Config = Record<string, any>;
