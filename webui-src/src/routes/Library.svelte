<script lang="ts">
  import { onMount } from 'svelte';
  import { app, attention } from '../lib/store.svelte';
  import { nav, parse, navigate, navigateKeepScroll, openAnimeView } from '../lib/router.svelte';
  import { api, q } from '../lib/api';
  import { titleOf, weekdayTime, plural } from '../lib/format';
  import type { Anime, Media } from '../lib/types';
  import Poster from '../components/Poster.svelte';
  import StateChip from '../components/StateChip.svelte';
  import EpisodeBar from '../components/EpisodeBar.svelte';
  import Icon from '../components/Icon.svelte';

  const route = $derived(parse(nav.path));
  type Filter = 'all' | 'attention' | 'airing' | 'uptodate';
  const filter = $derived((route.query.get('filter') as Filter) || 'all');
  const source = $derived((route.query.get('list') || 'watching') as string);
  let search = $state('');
  let sort = $state<'title' | 'next' | 'status'>('title');
  let view = $state<'grid' | 'list'>('grid');

  onMount(() => {
    try { const v = localStorage.getItem('animu.libraryView'); if (v === 'grid' || v === 'list') view = v; } catch { /* ignore */ }
  });
  function setView(v: 'grid' | 'list') { view = v; try { localStorage.setItem('animu.libraryView', v); } catch { /* ignore */ } }

  function setParam(key: string, value: string | null) {
    const p = new URLSearchParams(route.query);
    if (value == null || value === 'all' || value === 'watching') p.delete(key); else p.set(key, value);
    const qs = p.toString();
    navigateKeepScroll(`/library${route.id ? `/${route.id}` : ''}${qs ? `?${qs}` : ''}`, { replace: true });
  }

  const missingCount = (a: Anime) => {
    const aired = a.airedEpisodes ?? 0;
    let n = 0;
    for (let e = a.progress + 1; e <= aired; e++) if (!a.downloadedEpisodes.includes(e)) n++;
    return n;
  };
  const severity: Record<string, number> = { error: 0, not_found: 1, search_error: 2, backoff: 3, waiting_release: 4, downloaded: 5, pending: 6, up_to_date: 7 };

  const shown = $derived.by(() => {
    const term = search.trim().toLowerCase();
    let list = app.anime.filter((a) => {
      if (term) {
        const t = a.media.title;
        if (!`${t.romaji ?? ''} ${t.english ?? ''} ${a.media.alternativeTitle ?? ''}`.toLowerCase().includes(term)) return false;
      }
      if (filter === 'attention') return attention(a);
      if (filter === 'airing') return a.media.status === 'RELEASING';
      if (filter === 'uptodate') return a.state === 'up_to_date';
      return true;
    });
    list = [...list];
    if (sort === 'title') list.sort((x, y) => titleOf(x.media.title, app.titleLang).localeCompare(titleOf(y.media.title, app.titleLang)));
    else if (sort === 'next') list.sort((x, y) => (x.nextAirAt ? Date.parse(x.nextAirAt) : Infinity) - (y.nextAirAt ? Date.parse(y.nextAirAt) : Infinity));
    else list.sort((x, y) => (severity[x.state] ?? 9) - (severity[y.state] ?? 9));
    return list;
  });

  const counts = $derived({
    all: app.anime.length,
    attention: app.anime.filter(attention).length,
    airing: app.anime.filter((a) => a.media.status === 'RELEASING').length,
    uptodate: app.anime.filter((a) => a.state === 'up_to_date').length,
  });

  // --- other AniList lists ---
  interface ListEntry { id: number; mediaId: number; status: string; progress: number; score?: number; media: Media }
  let listEntries = $state<ListEntry[] | null>(null);
  let listError = $state('');
  $effect(() => {
    if (source === 'watching') { listEntries = null; return; }
    listEntries = null; listError = '';
    const ctrl = new AbortController();
    api.get<{ lists: { entries: ListEntry[] }[] }>(`/api/anilist/user-list${q({ userName: app.userName, type: 'ANIME', statusIn: source === 'rewatching' ? 'REPEATING' : source.toUpperCase() })}`, ctrl.signal)
      .then((r) => (listEntries = r.lists.flatMap((l) => l.entries)))
      .catch((e) => { if (!ctrl.signal.aborted) listError = e instanceof Error ? e.message : 'Could not load this list'; });
    return () => ctrl.abort();
  });

  const openShow = (id: number) => openAnimeView(id);

  const LISTS = [['watching', 'Watching'], ['rewatching', 'Rewatching'], ['planning', 'Planning'], ['paused', 'Paused'], ['completed', 'Completed'], ['dropped', 'Dropped']];
</script>

<div class="page">
  <header class="page-head">
    <div>
      <h1>Library</h1>
      <p class="sub">{source === 'watching' ? `${plural(app.anime.length, 'show')} Animu is keeping up with.` : 'Browse the rest of your AniList lists.'}</p>
    </div>
    <div class="page-actions">
      <div class="seg" role="group" aria-label="View">
        <button aria-pressed={view === 'grid'} onclick={() => setView('grid')} aria-label="Grid view"><Icon name="grid" size={16} /></button>
        <button aria-pressed={view === 'list'} onclick={() => setView('list')} aria-label="List view"><Icon name="list" size={16} /></button>
      </div>
    </div>
  </header>

  <div class="tools">
    <div class="seg" role="tablist" aria-label="AniList list">
      {#each LISTS as [k, label]}<button role="tab" aria-selected={source === k} onclick={() => setParam('list', k)}>{label}</button>{/each}
    </div>
  </div>
  {#if source === 'watching'}
    <div class="tools">
      <div class="seg" role="group" aria-label="Filter">
        {#each [['all', 'All'], ['attention', 'Needs attention'], ['airing', 'Airing'], ['uptodate', 'Up to date']] as [k, label]}
          <button aria-pressed={filter === k} onclick={() => setParam('filter', k)}>{label}<span class="n tnum">{counts[k as keyof typeof counts]}</span></button>
        {/each}
      </div>
      <div class="grow"></div>
      <label class="searchbox"><Icon name="search" size={15} /><input bind:value={search} placeholder="Filter shows…" aria-label="Filter shows" /></label>
      <select class="select sort" bind:value={sort} aria-label="Sort">
        <option value="title">A to Z</option><option value="next">Next airing</option><option value="status">Needs attention first</option>
      </select>
    </div>
  {/if}

  {#if source === 'watching'}
    {#if !app.animeLoaded}
      <div class="grid">{#each Array(10) as _, i}<div class="skeleton" style="aspect-ratio: 2/3.55"></div>{/each}</div>
    {:else if app.animeError && app.anime.length === 0}
      <div class="empty"><div class="glyph"><Icon name="alert" size={24} /></div><h2>Couldn't load your library</h2><p>{app.animeError}</p></div>
    {:else if shown.length === 0}
      <div class="empty"><div class="glyph"><Icon name="library" size={24} /></div><h2>{search || filter !== 'all' ? 'No shows match' : 'Your library is empty'}</h2>
        <p>{search || filter !== 'all' ? 'Try a different filter or search term.' : 'Add shows to your AniList Watching list, or find something in Discover.'}</p>
        {#if !search && filter === 'all'}<a class="btn btn-primary" href="/discover" onclick={(e) => { e.preventDefault(); navigate('/discover'); }}>Browse Discover</a>{/if}</div>
    {:else if view === 'grid'}
      <div class="grid">
        {#each shown as a, i (a.mediaId)}
          {@const miss = missingCount(a)}
          <button class="show rise" style="--i:{Math.min(i, 14)}" onclick={() => openShow(a.mediaId)} aria-label={titleOf(a.media.title, app.titleLang)}>
            <div class="art">
              <Poster cover={a.media.coverImage} title={titleOf(a.media.title)} />
              <div class="over">
                <span class="st"><StateChip state={a.state} detail={a.stateDetail} compact /></span>
                {#if a.airedEpisodes}<span class="epb tnum">EP {a.airedEpisodes}{a.media.episodes ? `/${a.media.episodes}` : ''}</span>{/if}
              </div>
            </div>
            <div class="info">
              <b class="clamp-2">{titleOf(a.media.title, app.titleLang)}</b>
              <EpisodeBar total={a.media.episodes} aired={a.airedEpisodes} downloaded={a.downloadedEpisodes} progress={a.progress} />
              <span class="sub tnum {miss ? 'warn' : ''}">
                {#if miss}{plural(miss, 'episode')} missing
                {:else if a.nextAirAt}Next {weekdayTime(a.nextAirAt)}
                {:else}Up to date{/if}
              </span>
            </div>
          </button>
        {/each}
      </div>
    {:else}
      <ul class="rows card">
        {#each shown as a (a.mediaId)}
          {@const miss = missingCount(a)}
          <li>
            <button class="r" onclick={() => openShow(a.mediaId)}>
              <span class="th"><Poster cover={a.media.coverImage} title={titleOf(a.media.title)} /></span>
              <span class="nm"><b class="clamp-1">{titleOf(a.media.title, app.titleLang)}</b><small class="faint tnum">{a.media.format ?? ''} · watched {a.progress}{a.media.episodes ? `/${a.media.episodes}` : ''}</small></span>
              <span class="bar"><EpisodeBar total={a.media.episodes} aired={a.airedEpisodes} downloaded={a.downloadedEpisodes} progress={a.progress} /></span>
              <span class="miss tnum {miss ? 'warn' : 'faint'}">{miss ? `${miss} missing` : a.nextAirAt ? weekdayTime(a.nextAirAt) : '—'}</span>
              <StateChip state={a.state} detail={a.stateDetail} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    {#if listError}
      <div class="empty"><div class="glyph"><Icon name="alert" size={24} /></div><h2>Couldn't load this list</h2><p>{listError}</p></div>
    {:else if listEntries === null}
      <div class="grid">{#each Array(10) as _}<div class="skeleton" style="aspect-ratio: 2/3.1"></div>{/each}</div>
    {:else if listEntries.length === 0}
      <div class="empty"><div class="glyph"><Icon name="library" size={24} /></div><h2>Nothing here</h2><p>No titles in this list.</p></div>
    {:else}
      <div class="grid">
        {#each listEntries as e, i (e.mediaId)}
          <button class="show rise" style="--i:{Math.min(i, 14)}" onclick={() => openAnimeView(e.mediaId)}>
            <div class="art"><Poster cover={e.media.coverImage} title={titleOf(e.media.title)} /></div>
            <div class="info"><b class="clamp-2">{titleOf(e.media.title, app.titleLang)}</b>
              <span class="sub tnum">{e.progress ? `Watched ${e.progress}${e.media.episodes ? `/${e.media.episodes}` : ''}` : e.media.episodes ? `${e.media.episodes} episodes` : ''}{e.score ? ` · ★ ${e.score}` : ''}</span></div>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .tools + .tools { margin-bottom: 24px; }
  .seg .n { margin-left: 7px; color: var(--text-3); font-size: 11.5px; }
  .seg button[aria-pressed='true'] .n { color: var(--accent); }
  .searchbox { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--bg-raised); color: var(--text-3); min-width: 200px; }
  .searchbox:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .searchbox input { flex: 1; min-width: 0; border: 0; background: none; color: var(--text); font: inherit; }
  .searchbox input:focus { outline: none; box-shadow: none; }
  .sort { width: auto; height: 36px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 22px 18px; }
  .show { display: grid; gap: 11px; align-content: start; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; color: inherit; }
  .art { position: relative; border-radius: var(--r); overflow: hidden; box-shadow: var(--shadow-1); transition: transform var(--t) var(--ease), box-shadow var(--t) var(--ease); }
  .show:hover .art { transform: translateY(-4px); box-shadow: 0 16px 34px oklch(0 0 0 / 0.38); }
  .show:focus-visible .art { box-shadow: var(--ring); }
  .over { position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: space-between; padding: 8px; background: linear-gradient(180deg, oklch(0 0 0 / 0.38), transparent 38%); pointer-events: none; }
  .st :global(.chip) { background: oklch(0.15 0.01 285 / 0.72); backdrop-filter: blur(6px); border-color: transparent; padding: 0 7px; }
  .epb { font: 650 11px var(--font); letter-spacing: 0.03em; padding: 4px 7px; border-radius: 7px; color: #fff; background: oklch(0.15 0.01 285 / 0.72); backdrop-filter: blur(6px); }
  .info { display: grid; gap: 7px; padding: 0 2px; }
  .info b { font-size: 13.5px; line-height: 1.3; font-weight: 600; letter-spacing: -0.01em; }
  .info .sub { font-size: 12px; color: var(--text-3); }
  .info .sub.warn { color: var(--warn); font-weight: 560; }

  .rows { overflow: hidden; }
  .rows li + li { border-top: 1px solid var(--line); }
  .r { display: grid; grid-template-columns: 40px minmax(150px, 1.2fr) minmax(140px, 1fr) 110px auto; align-items: center; gap: 16px; width: 100%; padding: 10px 16px; border: 0; background: none; cursor: pointer; text-align: left; color: inherit; transition: background var(--t-fast); }
  .r:hover { background: var(--surface-2); }
  .nm { display: grid; min-width: 0; } .nm small { font-size: 12px; }
  .miss { font-size: 12.5px; text-align: right; } .miss.warn { color: var(--warn); font-weight: 560; }

  @media (max-width: 900px) { .r { grid-template-columns: 40px 1fr auto; } .bar, .miss { display: none; } }
  @media (max-width: 720px) { .grid { grid-template-columns: repeat(2, 1fr); gap: 18px 12px; } .searchbox { flex: 1; min-width: 0; } .tools .grow { display: none; } }
</style>
