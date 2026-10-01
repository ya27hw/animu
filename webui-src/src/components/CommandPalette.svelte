<script lang="ts">
  import { tick } from 'svelte';
  import { palette, closePalette } from '../lib/palette.svelte';
  import { navigate } from '../lib/router.svelte';
  import { app, toggleTheme, theme } from '../lib/store.svelte';
  import { api, q } from '../lib/api';
  import { titleOf } from '../lib/format';
  import { toast } from '../lib/toast.svelte';
  import type { Media } from '../lib/types';
  import Icon from './Icon.svelte';
  import Poster from './Poster.svelte';

  interface Item { id: string; label: string; hint?: string; icon?: string; cover?: Media['coverImage']; group: string; run: () => void }

  let dlg = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let query = $state('');
  let active = $state(0);
  let remote = $state<Media[]>([]);
  let searching = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;

  $effect(() => {
    if (!dlg) return;
    if (palette.open && !dlg.open) {
      query = '';
      remote = [];
      active = 0;
      dlg.showModal();
      void tick().then(() => input?.focus());
    } else if (!palette.open && dlg.open) dlg.close();
  });

  const pages: Item[] = [
    { id: 'p-today', label: 'Today', icon: 'today', group: 'Go to', run: () => navigate('/') },
    { id: 'p-library', label: 'Library', icon: 'library', group: 'Go to', run: () => navigate('/library') },
    { id: 'p-discover', label: 'Discover', icon: 'discover', group: 'Go to', run: () => navigate('/discover') },
    { id: 'p-queue', label: 'Queue', icon: 'queue', group: 'Go to', run: () => navigate('/queue') },
    { id: 'p-history', label: 'History', icon: 'history', group: 'Go to', run: () => navigate('/history') },
    { id: 'p-activity', label: 'Activity', icon: 'activity', group: 'Go to', run: () => navigate('/activity') },
    { id: 'p-settings', label: 'Settings', icon: 'settings', group: 'Go to', run: () => navigate('/settings') },
  ];

  const actions = $derived<Item[]>([
    {
      id: 'a-run', label: 'Run scheduler cycle now', icon: 'refresh', group: 'Actions',
      run: async () => {
        try { await api.post('/api/scheduler/run'); toast('Cycle requested', 'ok'); }
        catch (e) { toast(e instanceof Error ? e.message : 'Could not start a cycle', 'bad'); }
      },
    },
    { id: 'a-theme', label: theme.mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: theme.mode === 'dark' ? 'sun' : 'moon', group: 'Actions', run: toggleTheme },
  ]);

  const norm = (s: string) => s.toLowerCase();

  const local = $derived.by<Item[]>(() => {
    const term = norm(query.trim());
    const shows = app.anime
      .filter((a) => !term || norm(titleOf(a.media.title, app.titleLang)).includes(term) || norm(a.media.title.english ?? '').includes(term))
      .slice(0, term ? 6 : 0)
      .map<Item>((a) => ({
        id: `s-${a.mediaId}`, label: titleOf(a.media.title, app.titleLang), hint: 'In your library', cover: a.media.coverImage, group: 'Library',
        run: () => navigate(`/library/${a.mediaId}`),
      }));
    const match = (i: Item) => !term || norm(i.label).includes(term);
    return [...shows, ...pages.filter(match), ...actions.filter(match)];
  });

  const remoteItems = $derived<Item[]>(remote.slice(0, 6).map((m) => ({
    id: `r-${m.id}`, label: titleOf(m.title, app.titleLang), hint: [m.format, m.seasonYear].filter(Boolean).join(' · '), cover: m.coverImage, group: 'On AniList',
    run: () => navigate(`/discover/${m.id}`),
  })));

  const items = $derived([...local, ...remoteItems]);

  $effect(() => {
    const term = query.trim();
    clearTimeout(timer);
    ctrl?.abort();
    if (term.length < 3) { remote = []; searching = false; return; }
    searching = true;
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try {
        const res = await api.get<{ media: Media[] }>(`/api/anilist/search${q({ q: term, perPage: 6 })}`, ctrl.signal);
        remote = res.media ?? [];
      } catch { /* superseded or offline */ }
      finally { searching = false; }
    }, 260);
  });

  $effect(() => { void items.length; if (active >= items.length) active = Math.max(0, items.length - 1); });

  function choose(it: Item | undefined) {
    if (!it) return;
    closePalette();
    it.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); scrollActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); scrollActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]); }
  }
  function scrollActive() { void tick().then(() => dlg?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })); }

  // Group headers: render a header whenever the group changes.
  const rows = $derived(items.map((it, i) => ({ it, i, header: i === 0 || items[i - 1].group !== it.group })));
</script>

<dialog bind:this={dlg} class="palette" aria-label="Command palette" onclose={() => palette.open && closePalette()}
        onclick={(e) => e.target === dlg && closePalette()}>
  <div class="box">
    <div class="field-row">
      <Icon name="search" size={18} />
      <input bind:this={input} bind:value={query} onkeydown={onKey} placeholder="Search your library, AniList, or jump to a page…" spellcheck="false" autocomplete="off" aria-label="Search" />
      {#if searching}<span class="spin" aria-hidden="true"></span>{/if}
      <span class="kbd">esc</span>
    </div>
    <ul class="results" role="listbox">
      {#each rows as { it, i, header } (it.id)}
        {#if header}<li class="group" role="presentation">{it.group}</li>{/if}
        <li role="option" aria-selected={i === active} data-active={i === active}>
          <button class="res" class:on={i === active} onmousemove={() => (active = i)} onclick={() => choose(it)}>
            {#if it.cover}
              <span class="thumb"><Poster cover={it.cover} title={it.label} ratio="2 / 3" radius="6px" /></span>
            {:else}
              <span class="ico"><Icon name={it.icon ?? 'search'} size={16} /></span>
            {/if}
            <span class="lbl clamp-1">{it.label}</span>
            {#if it.hint}<span class="hint">{it.hint}</span>{/if}
          </button>
        </li>
      {/each}
      {#if items.length === 0}
        <li class="none">{searching ? 'Searching…' : 'No matches'}</li>
      {/if}
    </ul>
  </div>
</dialog>

<style>
  .palette {
    margin: 11vh auto 0; padding: 0; border: 1px solid var(--line-strong); border-radius: 18px; width: min(640px, calc(100vw - 24px));
    background: var(--surface); color: var(--text); box-shadow: var(--shadow-2); overflow: hidden;
  }
  .palette[open] { animation: pop 0.28s var(--ease); }
  .palette::backdrop { background: var(--scrim); backdrop-filter: blur(4px); }
  .box { display: grid; max-height: min(560px, 76dvh); }
  .field-row { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 56px; border-bottom: 1px solid var(--line); color: var(--text-3); }
  .field-row input { flex: 1; min-width: 0; height: 100%; border: 0; background: none; color: var(--text); font: 500 16px var(--font); }
  .field-row input:focus { outline: none; box-shadow: none; }
  .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line-strong); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  .results { overflow-y: auto; padding: 6px; }
  .group { padding: 10px 10px 6px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); }
  .res { display: flex; align-items: center; gap: 12px; width: 100%; height: 48px; padding: 0 10px; border: 0; border-radius: 10px; background: none; cursor: pointer; text-align: left; }
  .res.on { background: var(--surface-3); }
  .thumb { width: 28px; flex: none; }
  .ico { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--surface-2); color: var(--text-2); flex: none; }
  .lbl { flex: 1; font-weight: 520; }
  .hint { color: var(--text-3); font-size: 12.5px; white-space: nowrap; }
  .none { padding: 28px; text-align: center; color: var(--text-3); }
  @keyframes pop { from { opacity: 0; transform: translateY(-8px) scale(0.98); } to { opacity: 1; transform: none; } }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
