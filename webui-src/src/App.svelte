<script lang="ts">
  import { onMount } from 'svelte';
  import { nav, parse, navigate } from './lib/router.svelte';
  import { initTheme, loadStatus, loadAnime, loadDownloads, poll } from './lib/store.svelte';
  import { openPalette } from './lib/palette.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import TabBar from './components/TabBar.svelte';
  import Toasts from './components/Toasts.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import Today from './routes/Today.svelte';

  // Everything except the landing page is split into its own chunk and only
  // fetched on first visit, which keeps the initial download small.
  const lazy = {
    library: () => import('./routes/Library.svelte'),
    discover: () => import('./routes/Discover.svelte'),
    queue: () => import('./routes/Queue.svelte'),
    history: () => import('./routes/History.svelte'),
    activity: () => import('./routes/Activity.svelte'),
    settings: () => import('./routes/Settings.svelte'),
  } as const;

  const route = $derived(parse(nav.path));

  const TITLES: Record<string, string> = {
    today: 'Today', library: 'Library', discover: 'Discover', queue: 'Queue', history: 'History', activity: 'Activity', settings: 'Settings',
  };
  $effect(() => {
    const t = TITLES[route.name];
    document.title = t ? `${t} · Animu Control Panel` : 'Animu Control Panel';
  });

  onMount(() => {
    initTheme();
    // The Queue page polls downloads faster itself; skip the global poll there.
    const stops = [poll(loadStatus, 5000), poll(loadAnime, 30000), poll(() => { if (parse(nav.path).name !== 'queue') void loadDownloads(); }, 6000)];

    let pendingG = false;
    let gTimer: ReturnType<typeof setTimeout>;
    const GO: Record<string, string> = { t: '/', l: '/library', d: '/discover', q: '/queue', h: '/history', a: '/activity', s: '/settings' };
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); openPalette(); return; }
      if (pendingG) {
        pendingG = false; clearTimeout(gTimer);
        const dest = GO[e.key.toLowerCase()];
        if (dest) { e.preventDefault(); navigate(dest); }
        return;
      }
      if (e.key === 'g') { pendingG = true; gTimer = setTimeout(() => (pendingG = false), 900); }
    }
    window.addEventListener('keydown', onKey);
    return () => { stops.forEach((s) => s()); window.removeEventListener('keydown', onKey); };
  });
</script>

<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <Sidebar />
  <main id="main" tabindex="-1">
    {#key route.name}
      <div class="view">
        {#if route.name === 'today'}<Today />
        {:else if route.name in lazy}
          {#await lazy[route.name as keyof typeof lazy]()}
            <div class="page"><div class="skeleton" style="height:36px;width:220px;margin-bottom:26px"></div><div class="skeleton" style="height:320px"></div></div>
          {:then mod}
            {@const Page = mod.default}
            <Page />
          {:catch}
            <div class="page"><div class="empty"><div class="glyph">!</div><h2>Couldn't load this page</h2><p>Check your connection and reload.</p></div></div>
          {/await}
        {:else}
          <div class="page"><div class="empty"><div class="glyph">404</div><h2>Page not found</h2><a class="btn btn-primary" href="/" onclick={(e) => { e.preventDefault(); navigate('/'); }}>Back to Today</a></div></div>
        {/if}
      </div>
    {/key}
  </main>
</div>
<TabBar />
<CommandPalette />
<ConfirmDialog />
<Toasts />

<style>
  .shell { display: flex; min-height: 100dvh; }
  main { flex: 1; min-width: 0; }
  .view { animation: enter 0.4s var(--ease); }
  @keyframes enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .skip { position: fixed; left: 12px; top: -48px; z-index: 200; padding: 10px 14px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font-weight: 600; transition: top 0.2s; }
  .skip:focus { top: 12px; }
  @media (max-width: 720px) { main { padding-bottom: calc(var(--tab-h) + env(safe-area-inset-bottom)); } }
</style>
