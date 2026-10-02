<script lang="ts">
  import { onMount } from 'svelte';
  import { openAnimeView } from '../lib/router.svelte';
  import { app } from '../lib/store.svelte';
  import { api, q } from '../lib/api';
  import { titleOf } from '../lib/format';
  import type { Media } from '../lib/types';
  import Rail from '../components/Rail.svelte';
  import MediaCard from '../components/MediaCard.svelte';
  import Icon from '../components/Icon.svelte';

  const openMedia = (m: Media) => openAnimeView(m.id);

  // --- search & filters ---
  let term = $state('');
  let sort = $state('POPULARITY_DESC');
  let format = $state('');
  let status = $state('');
  let genre = $state('');
  let season = $state('');

  let results = $state<Media[] | null>(null);
  let searching = $state(false);
  let searchError = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;

  const hasFilters = $derived(Boolean(format || status || genre || season || sort !== 'POPULARITY_DESC'));
  const isSearchActive = $derived(Boolean(term.trim().length >= 2 || hasFilters));

  function clearFilters() {
    sort = 'POPULARITY_DESC';
    format = '';
    status = '';
    genre = '';
    season = '';
  }

  function clearAll() {
    term = '';
    clearFilters();
  }

  async function fetchSearch(signal?: AbortSignal) {
    const t = term.trim();
    if (!t && !hasFilters) {
      results = null;
      searching = false;
      searchError = '';
      return;
    }
    searching = true;
    searchError = '';
    try {
      const res = await api.get<{ media: Media[] }>(
        `/api/anilist/search${q({
          q: t || undefined,
          sort,
          format: format || undefined,
          status: status || undefined,
          genre: genre || undefined,
          season: season || undefined,
          perPage: 30,
        })}`,
        signal,
      );
      results = res.media ?? [];
    } catch (e) {
      if (signal?.aborted) return;
      searchError = e instanceof Error ? e.message : 'Search failed';
      results = [];
    } finally {
      if (!signal?.aborted) searching = false;
    }
  }

  $effect(() => {
    // track reactive states
    const _t = term;
    const _s = sort;
    const _f = format;
    const _st = status;
    const _g = genre;
    const _se = season;
    const active = isSearchActive;

    clearTimeout(timer);
    ctrl?.abort();

    if (!active) {
      results = null;
      searching = false;
      searchError = '';
      return;
    }

    searching = true;
    timer = setTimeout(() => {
      ctrl = new AbortController();
      void fetchSearch(ctrl.signal);
    }, 280);
  });

  // --- sequels you haven't picked up ---
  interface Sequels { sequels: (Media & { parentMedia?: Media })[]; groups: Record<string, Media[]>; counts: Record<string, number> }
  let sequels = $state<Sequels | null>(null);
  let seqGroup = $state<'finished' | 'airing' | 'upcoming'>('airing');
  onMount(() => {
    api.get<Sequels>(`/api/anilist/completed-sequels${q({ userName: app.userName })}`).then((r) => {
      sequels = r;
      seqGroup = (['airing', 'finished', 'upcoming'] as const).find((g) => (r.counts?.[g] ?? 0) > 0) ?? 'airing';
    }).catch(() => (sequels = { sequels: [], groups: {}, counts: {} }));
  });
  const seqItems = $derived((sequels?.groups?.[seqGroup] ?? []) as (Media & { parentMedia?: Media })[]);
</script>

<div class="page">
  <header class="page-head">
    <div>
      <h1>Discover</h1>
      <p class="sub">Find something new and add it to your Watching list. Animu takes it from there.</p>
    </div>
  </header>

  <label class="big">
    <Icon name="search" size={20} />
    <input bind:value={term} placeholder="Search AniList…" aria-label="Search AniList" />
    {#if searching}
      <span class="spin" aria-hidden="true"></span>
    {:else if term}
      <button class="icon-btn sm" onclick={() => (term = '')} aria-label="Clear"><Icon name="x" size={15} /></button>
    {/if}
  </label>

  <div class="filters-bar" role="toolbar" aria-label="Search filters and sorting">
    <div class="filter-field">
      <label class="filter-lbl" for="filter-sort">Sort</label>
      <select id="filter-sort" class="select sm" bind:value={sort} aria-label="Sort by">
        <option value="POPULARITY_DESC">Most popular</option>
        <option value="TRENDING_DESC">Trending</option>
        <option value="SCORE_DESC">Highest rated</option>
        <option value="START_DATE_DESC">Release date</option>
        <option value="TITLE_ROMAJI">Title (A–Z)</option>
      </select>
    </div>

    <div class="filter-field">
      <label class="filter-lbl" for="filter-format">Format</label>
      <select id="filter-format" class="select sm" bind:value={format} aria-label="Filter by format">
        <option value="">All formats</option>
        <option value="TV">TV Show</option>
        <option value="MOVIE">Movie</option>
        <option value="OVA">OVA</option>
        <option value="ONA">ONA</option>
        <option value="SPECIAL">Special</option>
      </select>
    </div>

    <div class="filter-field">
      <label class="filter-lbl" for="filter-status">Status</label>
      <select id="filter-status" class="select sm" bind:value={status} aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="RELEASING">Airing</option>
        <option value="FINISHED">Finished</option>
        <option value="NOT_YET_RELEASED">Upcoming</option>
      </select>
    </div>

    <div class="filter-field">
      <label class="filter-lbl" for="filter-genre">Genre</label>
      <select id="filter-genre" class="select sm" bind:value={genre} aria-label="Filter by genre">
        <option value="">All genres</option>
        <option value="Action">Action</option>
        <option value="Adventure">Adventure</option>
        <option value="Comedy">Comedy</option>
        <option value="Drama">Drama</option>
        <option value="Fantasy">Fantasy</option>
        <option value="Horror">Horror</option>
        <option value="Mecha">Mecha</option>
        <option value="Mystery">Mystery</option>
        <option value="Psychological">Psychological</option>
        <option value="Romance">Romance</option>
        <option value="Sci-Fi">Sci-Fi</option>
        <option value="Slice of Life">Slice of Life</option>
        <option value="Sports">Sports</option>
        <option value="Supernatural">Supernatural</option>
        <option value="Thriller">Thriller</option>
      </select>
    </div>

    <div class="filter-field">
      <label class="filter-lbl" for="filter-season">Season</label>
      <select id="filter-season" class="select sm" bind:value={season} aria-label="Filter by season">
        <option value="">All seasons</option>
        <option value="WINTER">Winter</option>
        <option value="SPRING">Spring</option>
        <option value="SUMMER">Summer</option>
        <option value="FALL">Fall</option>
      </select>
    </div>

    {#if hasFilters}
      <button class="btn btn-ghost btn-sm reset-btn" onclick={clearFilters} aria-label="Reset filters">
        <Icon name="x" size={13} />Reset filters
      </button>
    {/if}
  </div>

  {#if isSearchActive}
    <section class="section">
      <div class="section-head">
        <h2>Results {#if results !== null}<span class="count tnum">{results.length}</span>{/if}</h2>
        {#if searching}
          <div class="searching-badge"><span class="spin-sm"></span>Searching AniList…</div>
        {/if}
      </div>

      {#if searching && results === null}
        <div class="grid">
          {#each Array(12) as _}
            <div class="skel-card">
              <div class="skeleton poster"></div>
              <div class="skeleton text"></div>
              <div class="skeleton text sub"></div>
            </div>
          {/each}
        </div>
      {:else if searchError}
        <div class="empty">
          <div class="glyph"><Icon name="alert" size={24} /></div>
          <h2>Search failed</h2>
          <p>{searchError}</p>
          <button class="btn btn-primary" onclick={() => fetchSearch()}>Retry search</button>
        </div>
      {:else if results !== null && results.length === 0}
        <div class="empty">
          <div class="glyph"><Icon name="search" size={24} /></div>
          <h2>Nothing found</h2>
          <p>{term ? `No titles matched “${term}”.` : 'No titles matched your selected filters.'}</p>
          {#if hasFilters || term}
            <button class="btn btn-primary" onclick={clearAll}>Clear search & filters</button>
          {/if}
        </div>
      {:else if results !== null}
        <div class="grid">
          {#each results as m (m.id)}
            <MediaCard media={m} onopen={openMedia} width={0} />
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    {#if sequels && (sequels.counts?.total ?? 0) > 0}
      <section class="section">
        <div class="section-head">
          <div><h2>Next seasons you haven't added</h2><p class="faint" style="font-size:13px;margin-top:2px">Sequels to shows you've finished.</p></div>
          <div class="seg" role="tablist">
            {#each [['airing', 'Airing'], ['upcoming', 'Upcoming'], ['finished', 'Finished']] as [k, label]}
              <button role="tab" aria-selected={seqGroup === k} onclick={() => (seqGroup = k as typeof seqGroup)}>{label}<span class="n tnum">{sequels.counts?.[k] ?? 0}</span></button>
            {/each}
          </div>
        </div>
        <div class="hrail bleed">
          {#each seqItems as m (m.id)}<MediaCard media={m} onopen={openMedia} width={160} sub={m.parentMedia ? `Sequel to ${titleOf(m.parentMedia.title)}` : ''} />{:else}<p class="muted">Nothing in this group.</p>{/each}
        </div>
      </section>
    {/if}
    <Rail title="Trending now" type="trending" onopen={openMedia} />
    <Rail title="This season" type="seasonal" onopen={openMedia} blurb="Currently airing." />
    <Rail title="Coming up" type="upcoming" onopen={openMedia} blurb="Next season's most anticipated." />
    <Rail title="All-time popular" type="popular" onopen={openMedia} />
    <Rail title="Highest rated" type="top" onopen={openMedia} />
  {/if}
</div>

<style>
  .big { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 16px; border: 1px solid var(--line-strong); border-radius: 16px; background: var(--bg-raised); color: var(--text-3); transition: border-color var(--t-fast), box-shadow var(--t-fast); }
  .big:focus-within { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); color: var(--text-2); }
  .big input { flex: 1; min-width: 0; height: 100%; border: 0; background: none; color: var(--text); font: 500 16px var(--font); }
  .big input:focus { outline: none; box-shadow: none; }
  .spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line-strong); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .filters-bar { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 14px; margin-bottom: 24px; }
  .filter-field { display: grid; gap: 4px; }
  .filter-lbl { font-size: 11.5px; font-weight: 560; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
  .select.sm { height: 34px; padding-left: 10px; padding-right: 28px; font-size: 13px; border-radius: var(--r-sm); background-position: right 8px center; }
  .reset-btn { height: 34px; align-self: flex-end; }
  .searching-badge { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-3); font-weight: 500; }
  .skel-card { display: grid; gap: 8px; }
  .skel-card .poster { aspect-ratio: 2/2.9; border-radius: var(--r-sm); width: 100%; }
  .skel-card .text { height: 14px; width: 85%; }
  .skel-card .text.sub { height: 12px; width: 50%; }
  .seg .n { margin-left: 7px; color: var(--text-3); font-size: 11.5px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 22px 16px; }
  .grid :global(.mc) { width: auto !important; }
</style>
