<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import type { Media } from '../lib/types';
  import MediaCard from './MediaCard.svelte';
  import Icon from './Icon.svelte';

  let { title, type, onopen, blurb = '' }: { title: string; type: string; onopen: (m: Media) => void; blurb?: string } = $props();

  let host = $state<HTMLElement>();
  let scroller = $state<HTMLElement>();
  let items = $state<Media[] | null>(null);
  let error = $state('');

  async function load() {
    try {
      const res = await api.get<{ media: Media[] }>(`/api/anilist/discover?type=${type}&perPage=20`);
      items = res.media ?? [];
    } catch (e) { error = e instanceof Error ? e.message : 'Could not load'; items = []; }
  }

  // Fetch only when the rail is near the viewport: five parallel AniList
  // queries on page open used to be what made Discover slow.
  onMount(() => {
    if (!host) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); void load(); }
    }, { rootMargin: '300px' });
    io.observe(host);
    return () => io.disconnect();
  });

  const nudge = (dir: 1 | -1) => scroller?.scrollBy({ left: dir * (scroller.clientWidth * 0.85), behavior: 'smooth' });
</script>

<section bind:this={host} class="rail-sec">
  <div class="section-head">
    <div><h2>{title}</h2>{#if blurb}<p class="faint blurb">{blurb}</p>{/if}</div>
    <div class="nav"><button class="icon-btn sm" onclick={() => nudge(-1)} aria-label="Scroll left"><Icon name="chevron-left" size={16} /></button><button class="icon-btn sm" onclick={() => nudge(1)} aria-label="Scroll right"><Icon name="chevron-right" size={16} /></button></div>
  </div>
  <div class="hrail bleed" bind:this={scroller}>
    {#if items === null}
      {#each Array(9) as _}<div class="sk"><div class="skeleton" style="aspect-ratio:2/3;width:150px"></div><div class="skeleton" style="height:12px;width:120px;margin-top:8px"></div></div>{/each}
    {:else if error}
      <p class="muted">{error}</p>
    {:else}
      {#each items as m (m.id)}<MediaCard media={m} {onopen} />{/each}
    {/if}
  </div>
</section>

<style>
  .rail-sec { margin-top: 34px; }
  .blurb { font-size: 13px; margin-top: 2px; }
  .nav { display: flex; gap: 4px; }
  @media (max-width: 720px) { .nav { display: none; } }
</style>
