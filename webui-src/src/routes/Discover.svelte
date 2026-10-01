<script lang="ts">
  import { onMount } from 'svelte';
  import { nav, parse, navigateKeepScroll } from '../lib/router.svelte';
  import { app } from '../lib/store.svelte';
  import { api, q } from '../lib/api';
  import { titleOf, plural } from '../lib/format';
  import type { Media } from '../lib/types';
  import Rail from '../components/Rail.svelte';
  import MediaCard from '../components/MediaCard.svelte';
  import MediaSheet from '../components/MediaSheet.svelte';
  import Icon from '../components/Icon.svelte';

  const route = $derived(parse(nav.path));
  const openMedia = (m: Media) => navigateKeepScroll(`/discover/${m.id}`);
  const closeSheet = () => navigateKeepScroll('/discover');

  // --- search ---
  let term = $state('');
  let results = $state<Media[] | null>(null);
  let searching = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;
  $effect(() => {
    const t = term.trim();
    clearTimeout(timer); ctrl?.abort();
    if (t.length < 2) { results = null; searching = false; return; }
    searching = true;
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try { results = (await api.get<{ media: Media[] }>(`/api/anilist/search${q({ q: t, perPage: 30 })}`, ctrl.signal)).media ?? []; }
      catch { /* superseded */ }
      finally { searching = false; }
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

  <label class="big"><Icon name="search" size={20} /><input bind:value={term} placeholder="Search AniList…" aria-label="Search AniList" />
    {#if searching}<span class="spin" aria-hidden="true"></span>{:else if term}<button class="icon-btn sm" onclick={() => (term = '')} aria-label="Clear"><Icon name="x" size={15} /></button>{/if}</label>

  {#if results !== null}
    <section class="section">
      <div class="section-head"><h2>Results<span class="count tnum">{results.length}</span></h2></div>
      {#if results.length === 0}
        <div class="empty"><div class="glyph"><Icon name="search" size={24} /></div><h2>Nothing found</h2><p>No titles matched “{term}”.</p></div>
      {:else}
        <div class="grid">{#each results as m (m.id)}<MediaCard media={m} onopen={openMedia} width={0} />{/each}</div>
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

{#if route.id != null}<MediaSheet id={route.id} onclose={closeSheet} />{/if}

<style>
  .big { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 16px; border: 1px solid var(--line-strong); border-radius: 16px; background: var(--bg-raised); color: var(--text-3); transition: border-color var(--t-fast), box-shadow var(--t-fast); }
  .big:focus-within { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); color: var(--text-2); }
  .big input { flex: 1; min-width: 0; height: 100%; border: 0; background: none; color: var(--text); font: 500 16px var(--font); }
  .big input:focus { outline: none; box-shadow: none; }
  .spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line-strong); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .seg .n { margin-left: 7px; color: var(--text-3); font-size: 11.5px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 22px 16px; }
  .grid :global(.mc) { width: auto !important; }
</style>
