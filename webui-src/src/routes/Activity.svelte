<script lang="ts">
  import { onMount } from 'svelte';
  import { nav, parse, navigateKeepScroll, navigate } from '../lib/router.svelte';
  import { api, q } from '../lib/api';
  import { clock, useClock } from '../lib/clock.svelte';
  import { poll } from '../lib/store.svelte';
  import { relative, plural } from '../lib/format';
  import type { FailedTrace, SchedulerEvent } from '../lib/types';
  import Icon from '../components/Icon.svelte';

  useClock();
  const route = $derived(parse(nav.path));
  const tab = $derived((route.query.get('tab') as 'events' | 'logs' | 'diagnostics') || 'events');
  const setTab = (t: string) => navigateKeepScroll(`/activity${t === 'events' ? '' : `?tab=${t}`}`, { replace: true });

  // events
  let events = $state<SchedulerEvent[]>([]);
  let eventsLoaded = $state(false);
  onMount(() => poll(async () => {
    if (tab !== 'events') return;
    try { events = (await api.get<{ events: SchedulerEvent[] }>('/api/events?limit=200')).events; } catch { /* keep last */ }
    eventsLoaded = true;
  }, 5000));

  // logs
  let logName = $state('combined');
  let lines = $state(250);
  let level = $state<'all' | 'warn' | 'error'>('all');
  let follow = $state(true);
  let raw = $state('');
  let logPath = $state('');
  let available = $state<{ key: string; label: string }[]>([]);
  let logLoaded = $state(false);
  let logError = $state('');
  let logEl = $state<HTMLElement>();

  async function loadLogs() {
    try {
      const r = await api.get<{ content: string; path: string; available: { key: string; label: string }[] }>(`/api/logs${q({ name: logName, lines })}`);
      raw = r.content; logPath = r.path; available = r.available; logError = '';
      if (follow) queueMicrotask(() => logEl && (logEl.scrollTop = logEl.scrollHeight));
    } catch (e) { logError = e instanceof Error ? e.message : 'Could not read logs'; }
    finally { logLoaded = true; }
  }
  $effect(() => { void logName; void lines; if (tab === 'logs') void loadLogs(); });
  onMount(() => poll(() => { if (tab === 'logs' && follow) void loadLogs(); }, 3000));

  const logLines = $derived.by(() => {
    const out = raw.split('\n').filter(Boolean).map((text) => {
      const lvl = /\bERROR\b|Traceback|Exception/.test(text) ? 'error' : /\bWARNING\b|\[WARN|❌|Failed|failed/.test(text) ? 'warn' : 'info';
      return { text, lvl };
    });
    return level === 'all' ? out : out.filter((l) => (level === 'error' ? l.lvl === 'error' : l.lvl !== 'info'));
  });

  // diagnostics
  let traces = $state<FailedTrace[] | null>(null);
  $effect(() => {
    if (tab !== 'diagnostics') return;
    api.get<FailedTrace[]>('/api/search-debug').then((r) => (traces = r)).catch(() => (traces = []));
  });
</script>

<div class="page">
  <header class="page-head">
    <div><h1>Activity</h1><p class="sub">What the scheduler is doing, raw logs, and why searches failed.</p></div>
    <div class="seg" role="tablist" aria-label="Activity sections">
      {#each [['events', 'Events'], ['logs', 'Logs'], ['diagnostics', 'Search diagnostics']] as [k, label]}
        <button role="tab" aria-selected={tab === k} onclick={() => setTab(k)}>{label}</button>
      {/each}
    </div>
  </header>

  {#if tab === 'events'}
    {#if !eventsLoaded}
      <div class="stack">{#each [0, 1, 2, 3] as i}<div class="skeleton" style="height:52px"></div>{/each}</div>
    {:else if events.length === 0}
      <div class="empty card"><div class="glyph"><Icon name="activity" size={26} /></div><h2>No events yet</h2><p>Scheduler events appear here as cycles run.</p></div>
    {:else}
      <ol class="timeline card">
        {#each events as ev, i (ev.at + i)}
          <li class={ev.level}>
            <span class="pin"><span class="dot {ev.level === 'error' ? 'bad' : ev.level === 'warning' ? 'warn' : ''}"></span></span>
            <div class="msg">{ev.message}</div>
            <time class="faint tnum" title={new Date(ev.at).toLocaleString()}>{relative(ev.at, clock.now)}</time>
          </li>
        {/each}
      </ol>
    {/if}

  {:else if tab === 'logs'}
    <div class="logtools">
      <select class="select" bind:value={logName} aria-label="Log file">{#each available.length ? available : [{ key: 'combined', label: 'Combined' }] as a}<option value={a.key}>{a.label}</option>{/each}</select>
      <select class="select" bind:value={lines} aria-label="Lines">{#each [100, 250, 500, 1000] as n}<option value={n}>{n} lines</option>{/each}</select>
      <div class="seg" role="group" aria-label="Level">
        {#each [['all', 'All'], ['warn', 'Warnings+'], ['error', 'Errors']] as [k, l]}<button aria-pressed={level === k} onclick={() => (level = k as typeof level)}>{l}</button>{/each}
      </div>
      <div class="grow"></div>
      <label class="follow"><span class="switch"><input type="checkbox" bind:checked={follow} /><i></i></span>Follow</label>
      <button class="btn" onclick={loadLogs}><Icon name="refresh" size={15} />Refresh</button>
    </div>
    <div class="term card" bind:this={logEl} role="log" aria-label="Log output">
      {#if !logLoaded}<p class="muted pad">Loading…</p>
      {:else if logError}<p class="pad" style="color:var(--bad)">{logError}</p>
      {:else if logLines.length === 0}<p class="muted pad">No lines to show.</p>
      {:else}{#each logLines as l}<div class="ln {l.lvl}">{l.text}</div>{/each}{/if}
    </div>
    <p class="faint path mono">{logPath}</p>

  {:else}
    {#if traces === null}
      <div class="stack">{#each [0, 1] as i}<div class="skeleton" style="height:150px"></div>{/each}</div>
    {:else if traces.length === 0}
      <div class="empty card"><div class="glyph" style="color:var(--ok)"><Icon name="check" size={26} /></div><h2>No failed searches</h2><p>Every show was either found or is waiting on its release.</p></div>
    {:else}
      <div class="stack" style="--gap:14px">
        {#each traces as t (t.media_id)}
          <article class="card trace">
            <div class="row between wrap">
              <div><h3>{t.anime_title}</h3><p class="faint mono q">{t.search_query}</p></div>
              <div class="row"><span class="chip bad">{t.status.replaceAll('_', ' ').toLowerCase()}</span>
                <button class="btn btn-sm" onclick={() => navigate(`/library/${t.media_id}?tab=search`)}>Open<Icon name="chevron-right" size={14} /></button></div>
            </div>
            <div class="facts faint tnum">
              {#if t.max_timeouts != null}<span>{plural(t.max_timeouts, 'failed attempt')}</span>{/if}
              <span>Last tried {relative(t.last_attempt, clock.now)}</span>
              {#if t.season_info?.format}<span>{t.season_info.format}{t.season_info.episodes ? ` · ${t.season_info.episodes} ep` : ''}</span>{/if}
            </div>
            {#if t.candidates?.length}
              <div class="cands"><span class="label">Closest candidates</span>
                {#each t.candidates as c}
                  <div class="cand"><span class="clamp-1">{c.title}</span>
                    <span class="meter" title="Match score {c.rating.toFixed(2)}"><i style:width="{Math.min(100, (c.rating / 5) * 100)}%" class:ok={c.rating >= 3.7}></i></span>
                    <b class="tnum">{c.rating.toFixed(2)}</b></div>
                {/each}
              </div>
            {:else}<p class="muted">No candidates came back from Nyaa.</p>{/if}
          </article>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .timeline { overflow: hidden; }
  .timeline li { display: grid; grid-template-columns: 24px 1fr auto; align-items: start; gap: 12px; padding: 14px 18px; }
  .timeline li + li { border-top: 1px solid var(--line); }
  .pin { display: grid; place-items: center; height: 22px; } .msg { line-height: 1.45; } .timeline time { font-size: 12.5px; white-space: nowrap; }
  .logtools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .logtools .select { width: auto; height: 36px; }
  .follow { display: inline-flex; align-items: center; gap: 10px; font-size: 13.5px; color: var(--text-2); }
  .term { height: min(64dvh, 620px); overflow: auto; padding: 10px 0; font: 12.5px/1.6 var(--mono); background: color-mix(in oklab, var(--bg) 70%, black); }
  .ln { padding: 1px 16px; white-space: pre-wrap; word-break: break-word; color: var(--text-2); content-visibility: auto; contain-intrinsic-size: auto 20px; }
  .ln.warn { color: var(--warn); background: var(--warn-soft); } .ln.error { color: var(--bad); background: var(--bad-soft); }
  .ln:hover { background: oklch(1 0 0 / 0.05); }
  .path { margin-top: 10px; font-size: 12px; } .pad { padding: 18px; }
  .trace { padding: 18px 20px; display: grid; gap: 14px; }
  .trace h3 { font-size: 15px; } .q { font-size: 12px; margin-top: 3px; word-break: break-all; }
  .wrap { flex-wrap: wrap; } .facts { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12.5px; }
  .cands { display: grid; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line); } .label { font-size: 12px; color: var(--text-3); }
  .cand { display: grid; grid-template-columns: 1fr 90px 40px; gap: 12px; align-items: center; font-size: 13px; } .cand b { text-align: right; font-weight: 600; }
  .meter { height: 6px; border-radius: 99px; background: var(--surface-3); overflow: hidden; } .meter i { display: block; height: 100%; background: var(--warn); border-radius: inherit; } .meter i.ok { background: var(--ok); }
  @media (max-width: 720px) { .cand { grid-template-columns: 1fr 40px; } .meter { display: none; } }
</style>
