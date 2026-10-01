<script lang="ts">
  import { nav, parse, link } from '../lib/router.svelte';
  import { app, theme, toggleTheme } from '../lib/store.svelte';
  import { clock, useClock } from '../lib/clock.svelte';
  import { schedulerView } from '../lib/scheduler';
  import { openPalette } from '../lib/palette.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';

  useClock();

  const route = $derived(parse(nav.path));
  const sched = $derived(schedulerView(app.status, clock.now));

  const ITEMS = [
    { to: '/', name: 'today', label: 'Today', icon: 'today' },
    { to: '/library', name: 'library', label: 'Library', icon: 'library' },
    { to: '/discover', name: 'discover', label: 'Discover', icon: 'discover' },
    { to: '/queue', name: 'queue', label: 'Queue', icon: 'queue' },
    { to: '/history', name: 'history', label: 'History', icon: 'history' },
    { to: '/activity', name: 'activity', label: 'Activity', icon: 'activity' },
  ] as const;
</script>

<aside class="rail" aria-label="Primary">
  <a class="brand" href="/" onclick={(e) => link(e, '/')} aria-label="Animu home">
    <Logo size={30} />
    <span class="wordmark">Animu</span>
  </a>

  <button class="search" onclick={openPalette} aria-label="Search or jump to…">
    <Icon name="search" size={16} />
    <span class="lbl">Search…</span>
    <span class="kbds"><span class="kbd">⌘</span><span class="kbd">K</span></span>
  </button>

  <nav>
    {#each ITEMS as it}
      <a href={it.to} class="item" class:active={route.name === it.name} aria-current={route.name === it.name ? 'page' : undefined}
         onclick={(e) => link(e, it.to)} title={it.label}>
        <Icon name={it.icon} size={19} />
        <span class="lbl">{it.label}</span>
        {#if it.name === 'queue' && app.downloads.length > 0}
          <span class="badge tnum">{app.downloads.length}</span>
        {/if}
      </a>
    {/each}
  </nav>

  <div class="spacer"></div>

  <a href="/activity" class="sched {sched.tone}" onclick={(e) => link(e, '/activity')} title="Scheduler status">
    <span class="dot {sched.tone === 'idle' ? '' : sched.tone} {sched.running ? 'pulse' : ''}"></span>
    <span class="txt">
      <b class="tnum">{sched.title}</b>
      <small>{sched.sub}</small>
    </span>
  </a>

  <div class="foot">
    <a href="/settings" class="item" class:active={route.name === 'settings'} onclick={(e) => link(e, '/settings')} title="Settings">
      <Icon name="settings" size={19} /><span class="lbl">Settings</span>
    </a>
    <button class="icon-btn" onclick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
      <Icon name={theme.mode === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  </div>
</aside>

<style>
  .rail {
    position: sticky; top: 0; height: 100dvh; width: var(--rail); flex: none;
    display: flex; flex-direction: column; gap: 6px; padding: 16px 12px 14px;
    background: var(--bg-raised); border-right: 1px solid var(--line);
  }
  .brand { display: flex; align-items: center; gap: 11px; padding: 4px 8px 14px; }
  .wordmark { font: 680 19px/1 var(--font); letter-spacing: -0.04em; }
  .search {
    display: flex; align-items: center; gap: 9px; height: 38px; padding: 0 10px; margin-bottom: 10px;
    border: 1px solid var(--line-strong); border-radius: 10px; background: var(--bg); color: var(--text-3); cursor: pointer; text-align: left;
    transition: border-color var(--t-fast), color var(--t-fast);
  }
  .search:hover { color: var(--text-2); border-color: var(--text-3); }
  .search .lbl { flex: 1; font-size: 13.5px; }
  .kbds { display: flex; gap: 3px; }
  nav { display: grid; gap: 2px; }
  .item {
    position: relative; display: flex; align-items: center; gap: 12px; height: 40px; padding: 0 12px;
    border-radius: 10px; color: var(--text-2); font-weight: 540; font-size: 14px; letter-spacing: -0.01em;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .item:hover { background: var(--surface-2); color: var(--text); }
  .item.active { background: var(--surface-2); color: var(--text); }
  .item.active::before { content: ''; position: absolute; left: -12px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); }
  .item.active :global(svg) { color: var(--accent); }
  .badge { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center; font-size: 11.5px; font-weight: 640; background: var(--accent-soft); color: var(--accent); }
  .spacer { flex: 1; }
  .sched {
    display: flex; align-items: center; gap: 11px; padding: 11px 12px; border-radius: 12px;
    background: var(--surface); border: 1px solid var(--line); margin-bottom: 6px;
  }
  .sched:hover { border-color: var(--line-strong); }
  .sched .dot { color: var(--text-3); }
  .sched.ok .dot { color: var(--ok); } .sched.warn .dot { color: var(--warn); } .sched.bad .dot { color: var(--bad); }
  .txt { display: grid; min-width: 0; line-height: 1.3; }
  .txt b { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .txt small { color: var(--text-3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .foot { display: flex; align-items: center; gap: 4px; }
  .foot .item { flex: 1; }

  /* compact rail */
  @media (max-width: 1100px) {
    .rail { width: var(--rail-mini); padding-inline: 10px; align-items: stretch; }
    .wordmark, .lbl, .kbds, .txt, .badge { display: none; }
    .brand { justify-content: center; padding-inline: 0; }
    .search { justify-content: center; padding: 0; }
    .item { justify-content: center; padding: 0; }
    .item.active::before { left: -10px; }
    .sched { justify-content: center; padding: 12px 0; }
    .foot { flex-direction: column; }
    .foot .item { flex: none; width: 100%; }
  }
  @media (max-width: 720px) { .rail { display: none; } }
</style>
