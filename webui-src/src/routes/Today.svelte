<script lang="ts">
  import { onMount } from 'svelte';
  import { app, attention, loadStatus, loadAnime } from '../lib/store.svelte';
  import { clock, useClock } from '../lib/clock.svelte';
  import { api } from '../lib/api';
  import { navigate, link, openAnimeView } from '../lib/router.svelte';
  import { toast } from '../lib/toast.svelte';
  import { titleOf, weekdayTime, speed, eta, relative, plural } from '../lib/format';
  import type { AiringItem, SchedulerEvent } from '../lib/types';
  import Poster from '../components/Poster.svelte';
  import StateChip from '../components/StateChip.svelte';
  import SchedulerRing from '../components/SchedulerRing.svelte';
  import ProgressBar from '../components/ProgressBar.svelte';
  import Icon from '../components/Icon.svelte';

  useClock();

  let airing = $state<AiringItem[] | null>(null);
  let events = $state<SchedulerEvent[]>([]);
  let running = $state(false);

  onMount(() => {
    api.get<{ entries: AiringItem[] }>('/api/anilist/airing-today?hours=24').then((r) => (airing = r.entries ?? [])).catch(() => (airing = []));
    const loadEvents = () => api.get<{ events: SchedulerEvent[] }>('/api/events?limit=8').then((r) => (events = r.events)).catch(() => {});
    void loadEvents();
    const t = setInterval(() => { if (!document.hidden) void loadEvents(); }, 15000);
    return () => clearInterval(t);
  });

  const hour = $derived(new Date(clock.now).getHours());
  const greeting = $derived(hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  const needs = $derived(app.anime.filter(attention));
  const cycle = $derived(app.status?.scheduler.cycle);
  const sched = $derived(app.status?.scheduler);
  const active = $derived(app.downloads.filter((t) => t.statusKind === 'downloading' || t.statusKind === 'stalled' || t.statusKind === 'checking'));
  const totalSpeed = $derived(app.downloads.reduce((n, t) => n + (t.dlspeed || 0), 0));
  const addedToday = $derived(app.anime.filter((a) => a.state === 'downloaded').length);

  const services = $derived([
    { key: 'AniList', ok: !!app.status?.services.anilist.authenticated, note: app.status?.services.anilist.authenticated ? 'Signed in' : 'Not signed in', tone: app.status?.services.anilist.authenticated ? 'ok' : 'warn' },
    { key: 'qBittorrent', ok: !!app.status?.services.qbittorrent.authenticated, note: app.status?.services.qbittorrent.authenticated ? 'Connected' : 'No session', tone: app.status?.services.qbittorrent.authenticated ? 'ok' : 'warn' },
    { key: 'Database', ok: !!app.status?.services.pocketbase.authenticated, note: app.status?.services.pocketbase.offline_safe_mode ? 'Offline mode' : app.status?.services.pocketbase.authenticated ? 'Synced' : 'Unavailable', tone: app.status?.services.pocketbase.authenticated ? 'ok' : app.status?.services.pocketbase.offline_safe_mode ? 'warn' : 'bad' },
    { key: 'Scheduler', ok: !!sched?.scheduler_running, note: sched?.cycle_running ? 'Running' : sched?.scheduler_running ? 'Idle' : 'Stopped', tone: sched?.scheduler_running ? 'ok' : 'bad' },
  ]);

  async function runNow() {
    running = true;
    try {
      await api.post('/api/scheduler/run');
      toast('Cycle requested. It will start in a moment.', 'ok');
      setTimeout(loadStatus, 800);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start a cycle', 'bad');
    } finally { running = false; }
  }

  async function retry(id: number) {
    try {
      await api.patch(`/api/anime/${id}`, { retryNow: true });
      toast('Will search again on the next cycle', 'ok');
      await loadAnime();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not reset back-off', 'bad'); }
  }

  const byId = $derived(new Map(app.anime.map((a) => [a.mediaId, a])));
</script>

<div class="page">
  <header class="page-head">
    <div>
      <h1>{greeting}{app.userName ? `, ${app.userName}` : ''}</h1>
      <p class="sub">
        {#if !app.animeLoaded}Checking on your shows…
        {:else if needs.length === 0}Everything is on schedule. {addedToday ? `${plural(addedToday, 'show')} got new episodes this cycle.` : 'Nothing new needed this cycle.'}
        {:else}{plural(needs.length, 'show')} need{needs.length === 1 ? 's' : ''} your attention.{/if}
      </p>
    </div>
    <div class="page-actions">
      <button class="btn btn-primary" onclick={runNow} disabled={running || sched?.cycle_running}>
        <Icon name="refresh" size={16} />{sched?.cycle_running ? 'Cycle running…' : 'Run cycle now'}
      </button>
    </div>
  </header>

  <div class="metrics">
    <a class="metric card rise" style="--i:0" href="/library" onclick={(e) => link(e, '/library')}>
      <span class="k">Library</span><b class="tnum">{app.animeLoaded ? app.anime.length : '–'}</b><span class="d">shows tracked</span>
    </a>
    <a class="metric card rise" style="--i:1" href="/queue" onclick={(e) => link(e, '/queue')}>
      <span class="k">Downloading</span><b class="tnum">{active.length}</b><span class="d tnum">{totalSpeed ? speed(totalSpeed) : 'idle'}</span>
    </a>
    <a class="metric card rise" style="--i:2" href="/history" onclick={(e) => link(e, '/history')}>
      <span class="k">Last cycle</span><b class="tnum">{cycle?.downloaded_episodes ?? '–'}</b><span class="d">episodes added</span>
    </a>
    <a class="metric card rise {needs.length ? 'warn' : ''}" style="--i:3" href="/library?filter=attention" onclick={(e) => link(e, '/library?filter=attention')}>
      <span class="k">Attention</span><b class="tnum">{needs.length}</b><span class="d">{needs.length ? 'need a look' : 'all clear'}</span>
    </a>
  </div>

  <div class="cols">
    <div class="main stack" style="--gap: 34px">
      <section>
        <div class="section-head">
          <h2>Needs attention{#if needs.length}<span class="count tnum">{needs.length}</span>{/if}</h2>
          {#if needs.length > 4}<a class="btn btn-ghost btn-sm" href="/library?filter=attention" onclick={(e) => link(e, '/library?filter=attention')}>View all<Icon name="chevron-right" size={14} /></a>{/if}
        </div>
        {#if !app.animeLoaded}
          <div class="card list">{#each [0, 1, 2] as i}<div class="skeleton" style="height:64px;margin:10px"></div>{/each}</div>
        {:else if needs.length === 0}
          <div class="card empty-ok">
            <span class="tick"><Icon name="check" size={22} stroke={2.4} /></span>
            <div><b>All clear</b><p class="muted">Every show with aired episodes is up to date or waiting on its release.</p></div>
          </div>
        {:else}
          <ul class="card list">
            {#each needs.slice(0, 5) as a (a.mediaId)}
              <li>
                <button class="who" onclick={() => openAnimeView(a.mediaId)}>
                  <span class="thumb"><Poster cover={a.media.coverImage} title={titleOf(a.media.title)} /></span>
                  <span class="meta">
                    <b class="clamp-1">{titleOf(a.media.title, app.titleLang)}</b>
                    <span class="why muted clamp-1">{a.stateDetail || (a.state === 'not_found' ? 'No matching release on Nyaa yet' : 'Needs a look')}</span>
                  </span>
                </button>
                <StateChip state={a.state} detail={a.stateDetail} />
                <div class="acts">
                  <button class="btn btn-sm" onclick={() => openAnimeView(a.mediaId, { tab: 'search' })}><Icon name="search" size={14} />Search</button>
                  <button class="btn btn-sm btn-ghost" onclick={() => retry(a.mediaId)} title="Clear back-off and retry next cycle"><Icon name="refresh" size={14} />Retry</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section>
        <div class="section-head">
          <h2>Airing in the next 24 hours</h2>
        </div>
        {#if airing === null}
          <div class="hrail">{#each [0, 1, 2, 3, 4, 5] as i}<div class="skeleton" style="width:210px;height:92px"></div>{/each}</div>
        {:else if airing.length === 0}
          <div class="card empty-ok"><span class="tick info"><Icon name="calendar" size={20} /></span><div><b>Quiet day</b><p class="muted">Nothing on your list airs in the next 24 hours.</p></div></div>
        {:else}
          <div class="hrail">
            {#each airing as e, i (e.mediaId)}
              <button class="air card rise" style="--i:{i}" onclick={() => openAnimeView(e.mediaId)}>
                <span class="c"><Poster cover={{ large: e.coverImage }} title={e.title} /></span>
                <span class="t">
                  <small class="when tnum">{weekdayTime(e.airingAt * 1000, clock.now)}</small>
                  <b class="clamp-2">{e.title}</b>
                  <span class="ep faint">Episode {e.episode}</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <section>
        <div class="section-head">
          <h2>Downloading now</h2>
          <a class="btn btn-ghost btn-sm" href="/queue" onclick={(e) => link(e, '/queue')}>Open queue<Icon name="chevron-right" size={14} /></a>
        </div>
        {#if app.downloads.length === 0}
          <div class="card empty-ok"><span class="tick info"><Icon name="download" size={20} /></span><div><b>Nothing in the queue</b><p class="muted">New episodes appear here the moment they're added to qBittorrent.</p></div></div>
        {:else}
          <ul class="card list dl">
            {#each app.downloads.slice(0, 4) as t (t.hash)}
              <li>
                <div class="dlmeta">
                  <b class="clamp-1">{t.name}</b>
                  <span class="faint tnum">{Math.round(t.progress * 100)}% · {speed(t.dlspeed)} · {eta(t.eta)}</span>
                </div>
                <ProgressBar value={t.progress} tone={t.statusKind === 'stalled' ? 'warn' : 'accent'} />
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>

    <aside class="side stack" style="--gap: 18px">
      <section class="card sched rise" style="--i:1">
        <div class="ringrow">
          <SchedulerRing />
          <div class="legend">
            <div><span class="faint">Last cycle</span><b class="tnum">{sched?.last_cycle_completed_at ? relative(sched.last_cycle_completed_at, clock.now) : 'never'}</b></div>
            <div><span class="faint">Took</span><b class="tnum">{cycle?.duration_seconds != null ? `${Math.round(cycle.duration_seconds)}s` : '—'}</b></div>
            <div><span class="faint">Every</span><b class="tnum">{app.status?.intervalMinutes ?? '—'} min</b></div>
          </div>
        </div>
        <dl class="stats">
          <div><dt>Added</dt><dd class="tnum">{cycle?.downloaded_episodes ?? 0}</dd></div>
          <div><dt>Up to date</dt><dd class="tnum">{cycle?.up_to_date ?? 0}</dd></div>
          <div><dt>Backing off</dt><dd class="tnum">{cycle?.backing_off ?? 0}</dd></div>
          <div><dt>Failed</dt><dd class="tnum {cycle?.failed?.length ? 'bad' : ''}">{cycle?.failed?.length ?? 0}</dd></div>
        </dl>
        {#if cycle?.aborted}<p class="note warn"><Icon name="alert" size={15} />Cut short: {cycle.aborted}</p>{/if}
        {#if cycle?.anilist_stale_seconds != null}<p class="note warn"><Icon name="alert" size={15} />AniList was unreachable; used a cached list.</p>{/if}
      </section>

      <section class="card svc rise" style="--i:2">
        <h2>Services</h2>
        <ul>
          {#each services as s}
            <li><span class="dot {s.tone}"></span><b>{s.key}</b><span class="faint">{s.note}</span></li>
          {/each}
        </ul>
      </section>

      <section class="card feed rise" style="--i:3">
        <div class="row between"><h2>Recent activity</h2><a class="btn btn-ghost btn-sm" href="/activity" onclick={(e) => link(e, '/activity')}>All</a></div>
        {#if events.length === 0}
          <p class="muted" style="margin-top:12px">No events yet.</p>
        {:else}
          <ul>
            {#each events.slice(0, 6) as ev}
              <li>
                <span class="dot {ev.level === 'error' ? 'bad' : ev.level === 'warning' ? 'warn' : ''}"></span>
                <span class="msg clamp-2">{ev.message}</span>
                <time class="faint tnum">{relative(ev.at, clock.now)}</time>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </aside>
  </div>
</div>

<style>
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 30px; }
  .metric { display: grid; gap: 4px; padding: 16px 18px; transition: border-color var(--t-fast), transform var(--t) var(--ease); }
  .metric:hover { border-color: var(--line-strong); transform: translateY(-2px); }
  .metric .k { font-size: 12.5px; font-weight: 560; color: var(--text-3); }
  .metric b { font: 650 34px/1.05 var(--font); letter-spacing: -0.04em; }
  .metric .d { font-size: 12.5px; color: var(--text-2); }
  .metric.warn b { color: var(--warn); }

  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 28px; align-items: start; }
  .side { position: sticky; top: 24px; }

  .list { overflow: hidden; }
  .list li { display: flex; align-items: center; gap: 14px; padding: 12px 14px; }
  .list li + li { border-top: 1px solid var(--line); }
  .who { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; border: 0; background: none; text-align: left; cursor: pointer; padding: 0; }
  .thumb { width: 42px; flex: none; }
  .meta { display: grid; gap: 2px; min-width: 0; }
  .meta b { font-weight: 600; }
  .why { font-size: 12.5px; }
  .acts { display: flex; gap: 6px; flex: none; }

  .empty-ok { display: flex; align-items: center; gap: 16px; padding: 20px; }
  .empty-ok p { margin-top: 2px; font-size: 13.5px; }
  .tick { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: var(--ok-soft); color: var(--ok); flex: none; }
  .tick.info { background: var(--info-soft); color: var(--info); }

  .air { display: flex; gap: 12px; width: 236px; padding: 10px; text-align: left; cursor: pointer; color: inherit; transition: border-color var(--t-fast), transform var(--t) var(--ease); }
  .air:hover { border-color: var(--line-strong); transform: translateY(-2px); }
  .air .c { width: 56px; flex: none; }
  .air .t { display: grid; align-content: center; gap: 2px; min-width: 0; }
  .air .when { color: var(--accent); font-size: 12px; font-weight: 600; }
  .air b { font-size: 13.5px; line-height: 1.25; font-weight: 600; }
  .air .ep { font-size: 12px; }

  .dl li { display: grid; gap: 9px; }
  .dlmeta { display: flex; justify-content: space-between; gap: 14px; align-items: baseline; }
  .dlmeta b { font-weight: 560; font-size: 13.5px; }
  .dlmeta span { font-size: 12.5px; white-space: nowrap; }

  .sched { padding: 20px; display: grid; gap: 18px; }
  .ringrow { display: flex; align-items: center; gap: 18px; }
  .legend { display: grid; gap: 10px; flex: 1; min-width: 0; }
  .legend div { display: grid; line-height: 1.2; }
  .legend span { font-size: 11.5px; }
  .legend b { font-size: 14px; font-weight: 600; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 0; padding-top: 16px; border-top: 1px solid var(--line); }
  .stats div { display: grid; gap: 2px; text-align: left; }
  .stats dt { font-size: 11.5px; color: var(--text-3); }
  .stats dd { margin: 0; font: 640 20px/1.1 var(--font); letter-spacing: -0.03em; }
  .stats dd.bad { color: var(--bad); }
  .note { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 9px 11px; border-radius: 10px; }
  .note.warn { background: var(--warn-soft); color: var(--warn); }

  .svc { padding: 18px 20px; }
  .svc ul { margin-top: 12px; display: grid; gap: 10px; }
  .svc li { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
  .svc li span:last-child { margin-left: auto; font-size: 12.5px; }
  .feed { padding: 18px 20px; }
  .feed ul { margin-top: 12px; display: grid; gap: 12px; }
  .feed li { display: grid; grid-template-columns: 8px 1fr auto; align-items: start; gap: 10px; font-size: 13px; line-height: 1.4; }
  .feed .dot { margin-top: 6px; }
  .feed time { font-size: 11.5px; white-space: nowrap; margin-top: 1px; }

  @media (max-width: 1180px) { .cols { grid-template-columns: 1fr; } .side { position: static; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); display: grid; } }
  @media (max-width: 720px) {
    .metrics { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .metric b { font-size: 28px; }
    .list li { flex-wrap: wrap; row-gap: 10px; }
    .who { flex: 1 1 100%; }
    .acts { margin-left: auto; }
    .side { grid-template-columns: 1fr; }
  }
</style>
