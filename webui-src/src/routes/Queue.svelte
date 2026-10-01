<script lang="ts">
  import { onMount } from 'svelte';
  import { app, loadDownloads, poll } from '../lib/store.svelte';
  import { api } from '../lib/api';
  import { ask } from '../lib/confirm.svelte';
  import { toast } from '../lib/toast.svelte';
  import { bytes, speed, eta, plural } from '../lib/format';
  import ProgressBar from '../components/ProgressBar.svelte';
  import Icon from '../components/Icon.svelte';
  import type { Torrent } from '../lib/types';

  onMount(() => poll(loadDownloads, 2500));

  const totalSpeed = $derived(app.downloads.reduce((n, t) => n + (t.dlspeed || 0), 0));
  const KIND: Record<string, { label: string; chip: string; tone: 'accent' | 'ok' | 'warn' | 'bad' }> = {
    downloading: { label: 'Downloading', chip: 'accent', tone: 'accent' },
    stalled: { label: 'Stalled', chip: 'warn', tone: 'warn' },
    checking: { label: 'Checking', chip: 'info', tone: 'accent' },
    queued: { label: 'Queued', chip: '', tone: 'accent' },
    paused: { label: 'Paused', chip: '', tone: 'warn' },
    stopped: { label: 'Stopped', chip: '', tone: 'warn' },
    error: { label: 'Error', chip: 'bad', tone: 'bad' },
  };
  const kindOf = (t: Torrent) => KIND[t.statusKind] ?? { label: t.statusLabel || t.state, chip: '', tone: 'accent' as const };

  let busy = $state<string | null>(null);

  async function retry(t: Torrent) {
    busy = t.hash;
    try { const r = await api.post<{ message?: string }>(`/api/downloads/${t.hash}/retry`); toast(r.message ?? 'Resumed', 'ok'); await loadDownloads(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not resume', 'bad'); }
    finally { busy = null; }
  }

  async function remove(t: Torrent) {
    const ok = await ask({ title: 'Remove from qBittorrent?', body: `${t.name} will be removed from the queue. Downloaded files are kept.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    busy = t.hash;
    try { await api.del(`/api/downloads/${t.hash}`); toast('Removed from the queue', 'ok'); await loadDownloads(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not remove', 'bad'); }
    finally { busy = null; }
  }
</script>

<div class="page">
  <header class="page-head">
    <div>
      <h1>Queue</h1>
      <p class="sub">{#if app.downloadsLoaded}{plural(app.downloads.length, 'torrent')} in progress{totalSpeed ? ` · ${speed(totalSpeed)} total` : ''}.{:else}Connecting to qBittorrent…{/if}</p>
    </div>
  </header>

  {#if !app.downloadsLoaded}
    <div class="stack">{#each [0, 1, 2] as i}<div class="skeleton" style="height:96px"></div>{/each}</div>
  {:else if app.downloads.length === 0}
    <div class="empty card"><div class="glyph"><Icon name="download" size={26} /></div><h2>The queue is empty</h2><p>Episodes that are downloading, queued or need attention show up here.</p></div>
  {:else}
    <ul class="stack" style="--gap:12px">
      {#each app.downloads as t, i (t.hash)}
        {@const k = kindOf(t)}
        <li class="t card rise" style="--i:{Math.min(i, 8)}">
          <div class="top">
            <div class="nm"><b class="clamp-2">{t.name}</b>
              <div class="meta"><span class="chip {k.chip}">{k.label}</span>
                {#if t.size}<span class="faint tnum">{bytes(t.downloaded ?? t.progress * t.size)} of {bytes(t.size)}</span>{/if}
                {#if t.num_seeds != null}<span class="faint tnum">{t.num_seeds} seeds</span>{/if}</div></div>
            <div class="acts">
              {#if ['paused', 'stopped', 'error'].includes(t.statusKind) || t.state === 'missingFiles'}
                <button class="btn btn-sm" onclick={() => retry(t)} disabled={busy === t.hash}><Icon name="refresh" size={14} />{t.state === 'missingFiles' ? 'Recheck' : 'Resume'}</button>
              {/if}
              <button class="icon-btn" onclick={() => remove(t)} disabled={busy === t.hash} aria-label="Remove {t.name}" title="Remove from qBittorrent"><Icon name="trash" size={17} /></button>
            </div>
          </div>
          <ProgressBar value={t.progress} tone={k.tone} height={8} indeterminate={t.statusKind === 'checking' && t.progress === 0} />
          <div class="stats tnum">
            <b>{Math.round(t.progress * 100)}%</b>
            <span class="faint">{speed(t.dlspeed)}</span>
            <span class="faint">ETA {eta(t.eta)}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .t { padding: 16px 18px; display: grid; gap: 14px; }
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .nm { display: grid; gap: 9px; min-width: 0; }
  .nm b { font-weight: 580; letter-spacing: -0.01em; word-break: break-word; }
  .meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12.5px; }
  .acts { display: flex; gap: 6px; flex: none; }
  .stats { display: flex; gap: 18px; font-size: 13px; }
  .stats b { font-weight: 640; min-width: 42px; }
</style>
