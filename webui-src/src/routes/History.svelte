<script lang="ts">
  import { onMount } from 'svelte';
  import { api, q } from '../lib/api';
  import { ask } from '../lib/confirm.svelte';
  import { toast } from '../lib/toast.svelte';
  import { dayLabel, clock as fmtClock, plural } from '../lib/format';
  import type { HistoryItem } from '../lib/types';
  import Poster from '../components/Poster.svelte';
  import Icon from '../components/Icon.svelte';

  const PAGE = 60;
  let items = $state<HistoryItem[]>([]);
  let total = $state(0);
  let loaded = $state(false);
  let loadingMore = $state(false);
  let search = $state('');
  let busy = $state<string | null>(null);

  async function load(more = false) {
    if (more) loadingMore = true;
    try {
      const res = await api.get<{ count: number; history: HistoryItem[] }>(`/api/history${q({ limit: PAGE, offset: more ? items.length : 0 })}`);
      items = more ? [...items, ...res.history] : res.history;
      total = res.count;
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not load history', 'bad'); }
    finally { loaded = true; loadingMore = false; }
  }
  onMount(() => { void load(); });

  const filtered = $derived.by(() => {
    const term = search.trim().toLowerCase();
    return term ? items.filter((h) => `${h.anime_title ?? ''} ${h.title}`.toLowerCase().includes(term)) : items;
  });
  const groups = $derived.by(() => {
    const out: { label: string; rows: HistoryItem[] }[] = [];
    for (const h of filtered) {
      const label = dayLabel(h.added_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(h); else out.push({ label, rows: [h] });
    }
    return out;
  });

  async function act(h: HistoryItem, action: 'delete' | 'rerun' | 'ignore-redownload') {
    if (action === 'ignore-redownload') {
      const ok = await ask({ title: 'Ignore and re-download?', body: 'This release is added to the ignore list and Animu looks for a different one for the same episode.', confirmLabel: 'Ignore & re-download', danger: true });
      if (!ok) return;
    }
    busy = h.id;
    try {
      const res = await api.del<{ message?: string }>(`/api/history/${h.id}${q({ action })}`);
      items = items.filter((x) => x.id !== h.id); total = Math.max(0, total - 1);
      toast(res.message ?? (action === 'delete' ? 'Removed from history' : action === 'rerun' ? 'Will search again next cycle' : 'Done'), 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'Action failed', 'bad'); }
    finally { busy = null; }
  }

  async function clearAll() {
    const ok = await ask({ title: 'Clear all history?', body: 'This removes the list of past downloads. Files and qBittorrent are not affected.', confirmLabel: 'Clear history', danger: true });
    if (!ok) return;
    try { await api.del('/api/history'); items = []; total = 0; toast('History cleared', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not clear', 'bad'); }
  }

  const ep = (h: HistoryItem) => (h.episode != null && h.episode !== '' ? `Episode ${h.episode}` : '');
</script>

<div class="page">
  <header class="page-head">
    <div>
      <h1>History</h1>
      <p class="sub">{loaded ? `${plural(total, 'download')} added to qBittorrent.` : 'Loading…'}</p>
    </div>
    <div class="page-actions">
      <label class="searchbox"><Icon name="search" size={15} /><input bind:value={search} placeholder="Search history…" aria-label="Search history" /></label>
      <button class="btn btn-danger" onclick={clearAll} disabled={!items.length}><Icon name="trash" size={15} />Clear</button>
    </div>
  </header>

  {#if !loaded}
    <div class="stack">{#each [0, 1, 2, 3] as i}<div class="skeleton" style="height:72px"></div>{/each}</div>
  {:else if groups.length === 0}
    <div class="empty card"><div class="glyph"><Icon name="history" size={26} /></div><h2>{search ? 'No matches' : 'No history yet'}</h2><p>{search ? 'Try a different search.' : 'Downloads Animu adds will be listed here.'}</p></div>
  {:else}
    {#each groups as g (g.label)}
      <section class="day">
        <h2 class="dl">{g.label}<span class="count tnum">{g.rows.length}</span></h2>
        <ul class="card">
          {#each g.rows as h (h.id)}
            <li>
              <span class="th"><Poster cover={h.cover_image ? { large: h.cover_image } : null} title={h.anime_title ?? h.title} /></span>
              <div class="body">
                <div class="line"><b class="clamp-1">{h.anime_title ?? h.title}</b>{#if ep(h)}<span class="chip">{ep(h)}</span>{/if}{#if h.source === 'manual'}<span class="chip info">Manual</span>{/if}</div>
                <span class="faint clamp-1 rel">{h.title}</span>
                <span class="faint tnum meta">{h.size ?? ''}{h.seeders && h.seeders !== 'N/A' ? ` · ${h.seeders} seeders` : ''} · {fmtClock(h.added_at)}</span>
              </div>
              <div class="acts">
                <button class="btn btn-sm btn-ghost" onclick={() => act(h, 'rerun')} disabled={busy === h.id} title="Forget this download and search again"><Icon name="refresh" size={14} />Re-run</button>
                <button class="btn btn-sm btn-ghost" onclick={() => act(h, 'ignore-redownload')} disabled={busy === h.id} title="Ignore this release and find another"><Icon name="ban" size={14} />Ignore</button>
                <button class="icon-btn sm" onclick={() => act(h, 'delete')} disabled={busy === h.id} aria-label="Delete entry"><Icon name="trash" size={15} /></button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
    {#if items.length < total && !search}
      <div class="more"><button class="btn" onclick={() => load(true)} disabled={loadingMore}>{loadingMore ? 'Loading…' : `Load more (${total - items.length} left)`}</button></div>
    {/if}
  {/if}
</div>

<style>
  .searchbox { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--bg-raised); color: var(--text-3); min-width: 220px; }
  .searchbox:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .searchbox input { flex: 1; min-width: 0; border: 0; background: none; color: var(--text); font: inherit; }
  .searchbox input:focus { outline: none; box-shadow: none; }
  .day + .day { margin-top: 28px; }
  .dl { margin-bottom: 12px; font-size: 13px; font-weight: 600; color: var(--text-2); letter-spacing: 0; display: flex; align-items: baseline; gap: 8px; }
  .dl .count { font-weight: 500; }
  ul { overflow: hidden; }
  li { display: flex; align-items: center; gap: 14px; padding: 12px 14px; }
  li + li { border-top: 1px solid var(--line); }
  .th { width: 38px; flex: none; }
  .body { display: grid; gap: 3px; min-width: 0; flex: 1; }
  .line { display: flex; align-items: center; gap: 8px; min-width: 0; } .line b { font-weight: 600; }
  .rel, .meta { font-size: 12.5px; }
  .acts { display: flex; align-items: center; gap: 2px; flex: none; opacity: 0.0; transition: opacity var(--t-fast); }
  li:hover .acts, li:focus-within .acts { opacity: 1; }
  .more { display: grid; place-items: center; margin-top: 24px; }
  @media (hover: none), (max-width: 900px) { .acts { opacity: 1; } }
  @media (max-width: 720px) {
    .searchbox { min-width: 0; flex: 1; }
    li { flex-wrap: wrap; }
    .body { flex-basis: calc(100% - 60px); }
    .acts { width: 100%; justify-content: flex-end; }
  }
</style>
