<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { titleOf } from '../lib/format';
  import type { Media } from '../lib/types';
  import Poster from './Poster.svelte';
  import Icon from './Icon.svelte';

  let { media, onopen, width = 150, sub = '' }: { media: Media; onopen: (m: Media) => void; width?: number; sub?: string } = $props();

  const inLibrary = $derived(app.animeLoaded ? app.anime.some((a) => a.mediaId === media.id) : (media.localState?.tracked ?? false));
  const onList = $derived(inLibrary || !!media.mediaListEntry);
  const listTitle = $derived(
    inLibrary
      ? 'In your library'
      : media.mediaListEntry?.status
        ? `On your list (${media.mediaListEntry.status.replaceAll('_', ' ').toLowerCase()})`
        : 'On your AniList'
  );
  const meta = $derived(sub || [media.format, media.episodes ? `${media.episodes} ep` : null].filter(Boolean).join(' · '));
</script>

<button class="mc" style:width="{width}px" onclick={() => onopen(media)}>
  <div class="art">
    <Poster cover={media.coverImage} title={titleOf(media.title)} />
    {#if onList}<span class="in" title={listTitle} aria-label={listTitle}><Icon name="check" size={12} stroke={2.6} /></span>{/if}
    {#if media.averageScore}<span class="score tnum"><Icon name="star" size={10} />{(media.averageScore / 10).toFixed(1)}</span>{/if}
  </div>
  <b class="clamp-2">{titleOf(media.title, app.titleLang)}</b>
  <span class="meta faint">{meta}</span>
</button>

<style>
  .mc { display: grid; gap: 7px; align-content: start; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; color: inherit; }
  .art { position: relative; border-radius: var(--r-sm); overflow: hidden; box-shadow: var(--shadow-1); transition: transform var(--t) var(--ease), box-shadow var(--t) var(--ease); }
  .mc:hover .art { transform: translateY(-3px); box-shadow: 0 14px 30px oklch(0 0 0 / 0.38); }
  .mc:focus-visible .art { box-shadow: var(--ring); }
  .in { position: absolute; top: 7px; right: 7px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--ok); color: oklch(0.2 0.05 158); box-shadow: 0 2px 8px oklch(0 0 0 / 0.4); }
  .score { position: absolute; left: 7px; bottom: 7px; display: inline-flex; align-items: center; gap: 3px; padding: 3px 6px; border-radius: 6px; font: 650 11px var(--font); color: #fff; background: oklch(0.15 0.01 285 / 0.72); backdrop-filter: blur(6px); }
  b { font-size: 13px; line-height: 1.28; font-weight: 600; letter-spacing: -0.01em; }
  .meta { font-size: 12px; }
</style>
