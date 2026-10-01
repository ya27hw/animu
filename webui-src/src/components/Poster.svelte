<script lang="ts">
  import type { CoverImage } from '../lib/types';
  import { initials, tint } from '../lib/format';

  let { cover, title = '', ratio = '2 / 3', radius = 'var(--r-sm)', eager = false }: {
    cover?: CoverImage | null;
    title?: string;
    ratio?: string;
    radius?: string;
    eager?: boolean;
  } = $props();

  let loaded = $state(false);
  let failed = $state(false);
  const src = $derived(cover?.large || cover?.medium || cover?.extraLarge || '');
  const srcset = $derived(cover?.large && cover?.extraLarge ? `${cover.large} 1x, ${cover.extraLarge} 2x` : undefined);
  const color = $derived(tint(cover?.color));
</script>

<div class="poster" style:--c={color} style:aspect-ratio={ratio} style:border-radius={radius}>
  <span class="ph" aria-hidden="true">{initials(title)}</span>
  {#if src && !failed}
    <img
      {src}
      {srcset}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      class:loaded
      onload={() => (loaded = true)}
      onerror={() => (failed = true)}
    />
  {/if}
</div>

<style>
  .poster {
    position: relative; overflow: hidden; width: 100%;
    background: linear-gradient(160deg, color-mix(in oklab, var(--c) 55%, var(--surface-2)), color-mix(in oklab, var(--c) 18%, var(--surface)));
    isolation: isolate;
  }
  .ph {
    position: absolute; inset: 0; display: grid; place-items: center;
    font: 650 clamp(18px, 28%, 34px) var(--font); letter-spacing: -0.02em; color: color-mix(in oklab, var(--c) 40%, white); opacity: 0.8;
  }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.4s var(--ease); }
  img.loaded { opacity: 1; }
</style>
