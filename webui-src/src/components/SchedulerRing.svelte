<script lang="ts">
  import { clock, useClock } from '../lib/clock.svelte';
  import { app } from '../lib/store.svelte';
  import { schedulerView } from '../lib/scheduler';
  import { countdown } from '../lib/format';

  useClock();
  let { size = 148 }: { size?: number } = $props();

  const view = $derived(schedulerView(app.status, clock.now));
  const r = $derived(size / 2 - 7);
  const circ = $derived(2 * Math.PI * r);
  const label = $derived(
    view.running ? 'Running' : view.remainingMs != null ? (view.remainingMs > 0 ? countdown(view.remainingMs) : '…') : '—',
  );
</script>

<div class="ring {view.tone}" style:width="{size}px" style:height="{size}px">
  <svg viewBox="0 0 {size} {size}" aria-hidden="true">
    <circle class="track" cx={size / 2} cy={size / 2} {r} />
    {#if view.running}
      <circle class="arc spin" cx={size / 2} cy={size / 2} {r} stroke-dasharray="{circ * 0.28} {circ}" />
    {:else if view.progress != null}
      <circle class="arc" cx={size / 2} cy={size / 2} {r} stroke-dasharray="{circ * view.progress} {circ}" transform="rotate(-90 {size / 2} {size / 2})" />
    {/if}
  </svg>
  <div class="mid">
    <b class="tnum">{label}</b>
    <small>{view.running ? 'cycle in progress' : 'until next cycle'}</small>
  </div>
</div>

<style>
  .ring { position: relative; flex: none; }
  svg { width: 100%; height: 100%; }
  circle { fill: none; stroke-width: 7; }
  .track { stroke: var(--surface-3); }
  .arc { stroke: var(--accent); stroke-linecap: round; transition: stroke-dasharray 1s linear; }
  .warn .arc { stroke: var(--warn); } .bad .arc { stroke: var(--bad); }
  .spin { transform-origin: center; animation: spin 1.4s linear infinite; transition: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .mid { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 2px; }
  .mid b { font: 650 28px/1 var(--font); letter-spacing: -0.04em; }
  .mid small { color: var(--text-3); font-size: 11.5px; }
</style>
