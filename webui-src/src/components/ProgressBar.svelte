<script lang="ts">
  let { value, tone = 'accent', height = 6, indeterminate = false }: {
    value: number; tone?: 'accent' | 'ok' | 'warn' | 'bad'; height?: number; indeterminate?: boolean;
  } = $props();
</script>

<div class="track" style:--h="{height}px" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(value * 100)}>
  <i class={tone} class:ind={indeterminate} style:width="{Math.max(0, Math.min(1, value)) * 100}%"></i>
</div>

<style>
  .track { height: var(--h); border-radius: 999px; background: var(--surface-3); overflow: hidden; }
  i { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width 0.8s var(--ease); }
  i.ok { background: var(--ok); } i.warn { background: var(--warn); } i.bad { background: var(--bad); }
  i.ind { width: 40% !important; animation: slide 1.3s var(--ease) infinite; }
  @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
</style>
