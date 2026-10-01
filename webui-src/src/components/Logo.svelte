<script lang="ts">
  let { size = 30 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="oklch(0.84 0.15 55)" />
      <stop offset="1" stop-color="oklch(0.7 0.19 30)" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="18" fill="url(#lg)" />
  <path d="M24 17.5v29a2 2 0 0 0 3 1.7l23-14.5a2 2 0 0 0 0-3.4L27 15.8a2 2 0 0 0-3 1.7z" fill="oklch(0.2 0.03 40)" />
</svg>
