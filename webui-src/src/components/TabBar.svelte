<script lang="ts">
  import { nav, parse, link } from '../lib/router.svelte';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  const route = $derived(parse(nav.path));
  let more = $state(false);

  const TABS = [
    { to: '/', name: 'today', label: 'Today', icon: 'today' },
    { to: '/library', name: 'library', label: 'Library', icon: 'library' },
    { to: '/discover', name: 'discover', label: 'Discover', icon: 'discover' },
    { to: '/queue', name: 'queue', label: 'Queue', icon: 'queue' },
  ] as const;
  const MORE = [
    { to: '/history', name: 'history', label: 'History', icon: 'history' },
    { to: '/activity', name: 'activity', label: 'Activity', icon: 'activity' },
    { to: '/settings', name: 'settings', label: 'Settings', icon: 'settings' },
  ] as const;
  const moreActive = $derived(MORE.some((m) => m.name === route.name));

  function go(e: MouseEvent, to: string) {
    more = false;
    link(e, to);
  }
</script>

{#if more}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => (more = false)}></div>
  <div class="more card" role="menu">
    {#each MORE as m}
      <a href={m.to} role="menuitem" class="m" class:active={route.name === m.name} onclick={(e) => go(e, m.to)}>
        <Icon name={m.icon} size={19} />{m.label}
      </a>
    {/each}
  </div>
{/if}

<nav class="tabs" aria-label="Primary">
  {#each TABS as t}
    <a href={t.to} class:active={route.name === t.name} aria-current={route.name === t.name ? 'page' : undefined} onclick={(e) => go(e, t.to)}>
      <span class="ic">
        <Icon name={t.icon} size={21} />
        {#if t.name === 'queue' && app.downloads.length}<i class="pip"></i>{/if}
      </span>
      <span>{t.label}</span>
    </a>
  {/each}
  <button class:active={moreActive || more} onclick={() => (more = !more)} aria-expanded={more} aria-label="More">
    <span class="ic"><Icon name="more" size={21} /></span>
    <span>More</span>
  </button>
</nav>

<style>
  .tabs {
    display: none; position: fixed; z-index: 40; left: 0; right: 0; bottom: 0;
    height: calc(var(--tab-h) + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom);
    background: color-mix(in oklab, var(--bg-raised) 92%, transparent); backdrop-filter: blur(14px);
    border-top: 1px solid var(--line); grid-template-columns: repeat(5, 1fr);
  }
  .tabs a, .tabs button {
    display: grid; place-items: center; align-content: center; gap: 3px; border: 0; background: none; cursor: pointer;
    color: var(--text-3); font-size: 11px; font-weight: 560; letter-spacing: 0;
  }
  .tabs .active { color: var(--accent); }
  .ic { position: relative; display: grid; place-items: center; }
  .pip { position: absolute; top: -2px; right: -5px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--bg-raised); }
  .scrim { position: fixed; inset: 0; z-index: 38; }
  .more { position: fixed; z-index: 39; right: 12px; bottom: calc(var(--tab-h) + 10px + env(safe-area-inset-bottom)); padding: 6px; min-width: 190px; animation: pop 0.25s var(--ease); }
  .m { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 12px; border-radius: 10px; font-weight: 540; }
  .m:hover, .m.active { background: var(--surface-2); }
  .m.active { color: var(--accent); }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: none; } }
  @media (max-width: 720px) { .tabs { display: grid; } }
</style>
