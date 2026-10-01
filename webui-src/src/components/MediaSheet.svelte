<script lang="ts">
  import { app, loadAnime } from '../lib/store.svelte';
  import { api } from '../lib/api';
  import { navigate } from '../lib/router.svelte';
  import { toast } from '../lib/toast.svelte';
  import { titleOf, plainText, weekdayTime, tint } from '../lib/format';
  import type { Media } from '../lib/types';
  import Sheet from './Sheet.svelte';
  import Poster from './Poster.svelte';
  import Icon from './Icon.svelte';

  let { id, onclose }: { id: number | null; onclose: () => void } = $props();

  let media = $state<Media | null>(null);
  let error = $state('');
  let adding = $state(false);
  let added = $state(false);

  $effect(() => {
    media = null; error = ''; added = false;
    if (id == null) return;
    const ctrl = new AbortController();
    api.get<{ media: Media }>(`/api/anilist/media/${id}`, ctrl.signal)
      .then((r) => (media = r.media))
      .catch((e) => { if (!ctrl.signal.aborted) error = e instanceof Error ? e.message : 'Could not load this title'; });
    return () => ctrl.abort();
  });

  const tracked = $derived(app.anime.some((a) => a.mediaId === id) || !!media?.localState?.tracked);
  const title = $derived(media ? titleOf(media.title, app.titleLang) : '');
  const color = $derived(tint(media?.coverImage?.color));
  const synopsis = $derived(plainText(media?.description));
  const next = $derived(media?.nextAiringEpisode?.airingAt ? media.nextAiringEpisode.airingAt * 1000
    : media?.nextAiringEpisode?.timeUntilAiring != null ? Date.now() + media.nextAiringEpisode.timeUntilAiring * 1000 : null);

  async function add() {
    if (!media) return;
    adding = true;
    try {
      await api.post('/api/anilist/list/update', { mediaId: media.id, status: 'CURRENT', progress: 0 });
      added = true;
      toast(`${title} added to your Watching list`, 'ok');
      // Have the scheduler look for it right away rather than at the next tick.
      api.post('/api/scheduler/run').catch(() => {});
      setTimeout(loadAnime, 1500);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add. Is your AniList account connected?', 'bad');
    } finally { adding = false; }
  }
</script>

<Sheet open={id != null} {onclose} label={title || 'Title details'} width={600}>
  {#if error}
    <div class="empty"><div class="glyph"><Icon name="alert" size={24} /></div><h2>Couldn't load this title</h2><p>{error}</p></div>
  {:else if !media}
    <div class="loading"><div class="skeleton" style="height:230px;border-radius:0"></div><div class="pad stack"><div class="skeleton" style="height:28px;width:70%"></div><div class="skeleton" style="height:90px"></div></div></div>
  {:else}
    <header class="hero" style:--tint={color}>
      {#if media.bannerImage || media.coverImage?.extraLarge}<img class="bg" src={media.bannerImage || media.coverImage?.extraLarge} alt="" />{/if}
      <div class="shade"></div>
      <div class="head">
        <div class="art"><Poster cover={media.coverImage} title={title} eager /></div>
        <div class="who">
          <div class="chips">
            {#if media.format}<span class="chip glass">{media.format}</span>{/if}
            {#if media.status}<span class="chip glass">{media.status.replaceAll('_', ' ').toLowerCase()}</span>{/if}
            {#if media.averageScore}<span class="chip glass"><Icon name="star" size={12} />{media.averageScore}</span>{/if}
          </div>
          <h2 class="t">{title}</h2>
          {#if media.title.english && media.title.english !== title}<p class="alt">{media.title.english}</p>{/if}
        </div>
      </div>
    </header>
    <div class="body">
      <div class="facts">
        <div><span class="k">Episodes</span><b class="tnum">{media.episodes ?? '—'}</b></div>
        <div><span class="k">Season</span><b>{media.season ? `${media.season.toLowerCase()} ${media.seasonYear ?? ''}` : '—'}</b></div>
        <div><span class="k">Next episode</span><b class="tnum">{next ? weekdayTime(next) : '—'}</b></div>
      </div>

      <div class="cta">
        {#if tracked || added}
          <span class="chip ok"><Icon name="check" size={13} stroke={2.4} />{added ? 'Added to Watching' : 'In your library'}</span>
          {#if tracked}<button class="btn" onclick={() => navigate(`/library/${media!.id}`)}>Open in Library<Icon name="chevron-right" size={15} /></button>{/if}
        {:else}
          <button class="btn btn-primary btn-lg" onclick={add} disabled={adding}><Icon name="plus" size={17} />{adding ? 'Adding…' : 'Add to Watching'}</button>
          <p class="hint">Adds it to your AniList Watching list and starts looking for episodes.</p>
        {/if}
      </div>

      {#if media.genres?.length}
        <div class="chips">{#each media.genres as g}<span class="chip">{g}</span>{/each}</div>
      {/if}
      {#if synopsis}<div><h3>Synopsis</h3><p class="muted syn">{synopsis}</p></div>{/if}
    </div>
  {/if}
</Sheet>

<style>
  .hero { position: relative; padding: 70px 24px 22px; overflow: hidden; background: color-mix(in oklab, var(--tint) 30%, var(--bg-raised)); }
  .hero .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.4; filter: blur(2px) saturate(1.2); transform: scale(1.06); }
  .shade { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--bg-raised) 55%, transparent) 55%, var(--bg-raised) 100%); }
  .head { position: relative; display: flex; gap: 18px; align-items: flex-end; }
  .art { width: 112px; flex: none; border-radius: 12px; overflow: hidden; box-shadow: 0 14px 34px oklch(0 0 0 / 0.45); }
  .who { display: grid; gap: 8px; min-width: 0; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip.glass { background: oklch(0 0 0 / 0.38); color: #fff; border-color: transparent; backdrop-filter: blur(8px); text-transform: capitalize; }
  .t { font-size: clamp(20px, 3.4vw, 27px); line-height: 1.12; font-weight: 660; letter-spacing: -0.03em; text-wrap: balance; }
  .alt { color: var(--text-2); font-size: 13px; }
  .body { padding: 6px 24px 36px; display: grid; gap: 20px; }
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
  .facts div { background: var(--surface); padding: 12px 14px; display: grid; gap: 2px; }
  .facts .k { font-size: 11.5px; color: var(--text-3); } .facts b { font: 620 15px/1.25 var(--font); letter-spacing: -0.02em; text-transform: capitalize; }
  .cta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .syn { line-height: 1.65; white-space: pre-line; margin-top: 8px; }
  .loading .pad { padding: 24px; }
  @media (max-width: 720px) { .hero { padding: 64px 18px 18px; } .body { padding-inline: 18px; } .art { width: 92px; } }
</style>
