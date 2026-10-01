<script lang="ts">
  let { total = null, aired = null, downloaded = [], progress = 0, height = 6, max = 26 }: {
    total?: number | null;
    aired?: number | null;
    downloaded?: number[];
    progress?: number;
    height?: number;
    max?: number;
  } = $props();

  type Seg = { n: number; kind: 'seen' | 'have' | 'miss' | 'future' };

  const segs = $derived.by<Seg[]>(() => {
    const have = new Set(downloaded);
    const last = Math.max(aired ?? 0, total ?? 0, ...(downloaded.length ? [Math.max(...downloaded)] : [0]), 1);
    const cap = total ?? last;
    // Long runners: show the most recent window instead of hundreds of slivers.
    const end = Math.min(cap, Math.max(aired ?? 0, 1) + 2);
    const start = Math.max(1, end - max + 1);
    const out: Seg[] = [];
    for (let n = start; n <= end; n++) {
      if (aired != null && n > aired) out.push({ n, kind: 'future' });
      else if (n <= progress) out.push({ n, kind: 'seen' });
      else if (have.has(n)) out.push({ n, kind: 'have' });
      else out.push({ n, kind: 'miss' });
    }
    return out;
  });
</script>

<div class="bar" style:--h="{height}px" role="img" aria-label="Episode status">
  {#each segs as s (s.n)}
    <i class={s.kind} title="Episode {s.n}: {s.kind === 'seen' ? 'watched' : s.kind === 'have' ? 'downloaded' : s.kind === 'miss' ? 'missing' : 'not aired yet'}"></i>
  {/each}
</div>

<style>
  .bar { display: flex; gap: 2px; height: var(--h); width: 100%; }
  i { flex: 1 1 0; min-width: 2px; border-radius: 2px; background: var(--surface-3); transition: background var(--t) var(--ease); }
  i.seen { background: color-mix(in oklab, var(--ok) 38%, var(--surface-3)); }
  i.have { background: var(--ok); }
  i.miss { background: var(--warn); }
  i.future { background: transparent; box-shadow: inset 0 0 0 1px var(--line-strong); }
</style>
