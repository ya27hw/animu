<script lang="ts">
  import { untrack } from 'svelte';
  import { app, loadAnime } from '../lib/store.svelte';
  import { nav, parse, navigateKeepScroll } from '../lib/router.svelte';
  import { api, q, ApiError } from '../lib/api';
  import { ask } from '../lib/confirm.svelte';
  import { toast } from '../lib/toast.svelte';
  import { titleOf, plainText, weekdayTime, relative, tint, plural } from '../lib/format';
  import type { Anime, Media, NyaaResult } from '../lib/types';
  import Sheet from './Sheet.svelte';
  import Poster from './Poster.svelte';
  import StateChip from './StateChip.svelte';
  import EpisodeBar from './EpisodeBar.svelte';
  import Icon from './Icon.svelte';

  let { id, onclose }: { id: number | null; onclose: () => void } = $props();

  const anime = $derived<Anime | undefined>(app.anime.find((a) => a.mediaId === id));
  const route = $derived(parse(nav.path));
  const tab = $derived((route.query.get('tab') as 'episodes' | 'search' | 'overrides' | 'list') || 'episodes');
  const cover = $derived(anime?.media.coverImage);
  const color = $derived(tint(cover?.color));
  const title = $derived(anime ? titleOf(anime.media.title, app.titleLang) : '');

  function setTab(t: string, extra: Record<string, string> = {}) {
    const p = new URLSearchParams(route.query);
    p.set('tab', t);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    navigateKeepScroll(`${location.pathname}?${p.toString()}`, { replace: true });
  }

  // --- AniList detail (synopsis, score, banner), loaded lazily ---
  let detail = $state<Media | null>(null);
  $effect(() => {
    detail = null;
    if (id == null) return;
    const ctrl = new AbortController();
    api.get<{ media: Media }>(`/api/anilist/media/${id}`, ctrl.signal).then((r) => (detail = r.media)).catch(() => {});
    return () => ctrl.abort();
  });

  // --- episodes ---
  const aired = $derived(anime?.airedEpisodes ?? anime?.media.episodes ?? 0);
  const total = $derived(anime?.media.episodes ?? null);
  const episodeList = $derived.by(() => {
    const end = Math.max(aired, total ?? 0, ...(anime?.downloadedEpisodes ?? [0]));
    const start = Math.max(1, end - 71);
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i);
  });
  const missing = $derived(
    episodeList.filter((n) => n > (anime?.progress ?? 0) && n <= aired && !(anime?.downloadedEpisodes ?? []).includes(n)),
  );
  function epKind(n: number): 'seen' | 'have' | 'miss' | 'future' {
    if (!anime) return 'future';
    if (n > aired) return 'future';
    if (n <= anime.progress) return 'seen';
    return anime.downloadedEpisodes.includes(n) ? 'have' : 'miss';
  }

  // --- search ---
  let epInput = $state('');
  let searching = $state(false);
  let results = $state<NyaaResult[] | null>(null);
  let searchedFor = $state<string>('');
  let downloading = $state<string | null>(null);
  let downloadState = $state<Record<string, 'idle' | 'sending' | 'success' | 'error'>>({});
  $effect(() => { void id; results = null; epInput = ''; searchedFor = ''; downloadState = {}; });
  $effect(() => {
    if (tab === 'search' && !epInput) epInput = String(route.query.get('ep') ?? missing[0] ?? aired ?? '');
  });

  async function search() {
    if (!anime) return;
    searching = true; results = null; downloadState = {};
    try {
      const body = epInput ? { episode: Number(epInput) } : {};
      const res = await api.post<{ results: NyaaResult[] }>(`/api/anime/${anime.mediaId}/nyaa-search`, body);
      results = res.results; searchedFor = epInput;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Search failed', 'bad'); results = [];
    } finally { searching = false; }
  }

  async function download(r: NyaaResult) {
    if (!anime) return;
    downloading = r.link;
    downloadState[r.link] = 'sending';
    try {
      await api.post(`/api/anime/${anime.mediaId}/nyaa-download`, { link: r.link, episode: epInput ? Number(epInput) : null });
      downloadState[r.link] = 'success';
      toast(`Sent episode ${epInput || ''} to qBittorrent`.replace('  ', ' '), 'ok');
      await loadAnime();
    } catch (e) {
      downloadState[r.link] = 'error';
      const detailMsg = e instanceof ApiError && e.detail ? ` (${e.detail})` : '';
      toast((e instanceof Error ? e.message : 'Download failed') + detailMsg, 'bad');
    } finally { downloading = null; }
  }

  const group = (t: string) => t.match(/^\[([^\]]+)\]/)?.[1] ?? '';

  // --- overrides ---
  let form = $state({ alt: '', start: 0, group: '', jp: false, subs: false });
  let saving = $state(false);
  const resetForm = () => {
    if (!anime) return;
    form = {
      alt: anime.media.alternativeTitle ?? '', start: anime.media.startingEpisode ?? 0, group: anime.preferredReleaseGroup ?? '',
      jp: anime.requireJapaneseAudio, subs: anime.requireEnglishSubs,
    };
  };
  // Reset only when a different show opens (or the list first arrives), never on
  // the periodic library refresh: that replaces `anime` and would wipe edits.
  let formFor: number | null = null;
  $effect(() => {
    const key = anime ? anime.mediaId : null;
    if (key !== formFor) { formFor = key; untrack(resetForm); }
  });
  const dirty = $derived(!!anime && (form.alt !== (anime.media.alternativeTitle ?? '') || Number(form.start) !== (anime.media.startingEpisode ?? 0)
    || form.group !== (anime.preferredReleaseGroup ?? '') || form.jp !== anime.requireJapaneseAudio || form.subs !== anime.requireEnglishSubs));

  async function saveOverrides() {
    if (!anime) return;
    saving = true;
    try {
      const res = await api.patch<{ synced: boolean; warning: string | null }>(`/api/anime/${anime.mediaId}`, {
        alternativeTitle: form.alt, startingEpisode: Number(form.start) || 0, preferredReleaseGroup: form.group,
        requireJapaneseAudio: form.jp, requireEnglishSubs: form.subs,
      });
      toast(res.warning ?? 'Overrides saved', res.warning ? 'info' : 'ok');
      await loadAnime();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { saving = false; }
  }

  async function retryNow() {
    if (!anime) return;
    try { await api.patch(`/api/anime/${anime.mediaId}`, { retryNow: true }); toast('Back-off cleared. Searching again next cycle.', 'ok'); await loadAnime(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'bad'); }
  }

  async function resetCache() {
    if (!anime) return;
    const ok = await ask({
      title: 'Reset downloaded episodes?',
      body: `Animu will forget which episodes of ${title} it already downloaded and may fetch them again next cycle. Files on disk are not touched.`,
      confirmLabel: 'Reset', danger: true,
    });
    if (!ok) return;
    try { await api.post(`/api/anime/${anime.mediaId}/reset`); toast('Download cache reset', 'ok'); await loadAnime(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'bad'); }
  }

  async function ignoreShow() {
    if (!anime) return;
    const ok = await ask({ title: `Stop tracking ${title}?`, body: 'The scheduler will skip this show until you remove it from the ignore list in Settings.', confirmLabel: 'Ignore show', danger: true });
    if (!ok) return;
    try { await api.post('/api/ignored', { title: anime.media.title.romaji, mediaId: anime.mediaId }); toast('Show ignored', 'ok'); onclose(); await loadAnime(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'bad'); }
  }

  // --- AniList progress ---
  let listBusy = $state(false);
  async function setProgress(n: number) {
    if (!anime || n < 0) return;
    listBusy = true;
    try {
      await api.post('/api/anilist/list/update', { mediaId: anime.mediaId, status: 'CURRENT', progress: n });
      anime.progress = n; // optimistic: the cached list lags AniList by a couple of minutes
      toast(`Progress set to episode ${n}`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'AniList update failed. Is your account connected?', 'bad'); }
    finally { listBusy = false; }
  }

  const synopsis = $derived(plainText(detail?.description));
</script>

<Sheet open={id != null} {onclose} label={title || 'Show details'} width={640}>
  {#if !anime}
    <div class="empty"><div class="glyph"><Icon name="search" size={24} /></div><h2>Show not found</h2><p>This show is not on your Watching list.</p></div>
  {:else}
    <header class="hero" style:--tint={color}>
      {#if detail?.bannerImage || cover?.extraLarge}
        <img class="bg" src={detail?.bannerImage || cover?.extraLarge} alt="" />
      {/if}
      <div class="shade"></div>
      <div class="head">
        <div class="art"><Poster cover={cover} title={title} eager /></div>
        <div class="who">
          <div class="chips">
            {#if anime.media.format}<span class="chip glass">{anime.media.format}</span>{/if}
            {#if anime.media.status}<span class="chip glass">{anime.media.status.replaceAll('_', ' ').toLowerCase()}</span>{/if}
            {#if detail?.averageScore}<span class="chip glass"><Icon name="star" size={12} />{detail.averageScore}</span>{/if}
          </div>
          <h2 class="t">{title}</h2>
          {#if anime.media.alternativeTitle}<p class="alt">Searching as “{anime.media.alternativeTitle}”</p>
          {:else if anime.media.title.english && anime.media.title.english !== title}<p class="alt">{anime.media.title.english}</p>{/if}
          <div class="state"><StateChip state={anime.state} detail={anime.stateDetail} />{#if anime.stateDetail}<span class="why">{anime.stateDetail}</span>{/if}</div>
        </div>
      </div>
    </header>

    <div class="body">
      <div class="facts">
        <div><span class="k">Watched</span><b class="tnum">{anime.progress}{total ? ` / ${total}` : ''}</b></div>
        <div><span class="k">Downloaded</span><b class="tnum">{anime.downloadedEpisodes.length}</b></div>
        <div><span class="k">Aired</span><b class="tnum">{aired || '—'}</b></div>
        <div><span class="k">Next episode</span><b class="tnum">{anime.nextAirAt ? weekdayTime(anime.nextAirAt) : '—'}</b></div>
      </div>

      <div class="seg" role="tablist" aria-label="Show sections">
        {#each [['episodes', 'Episodes'], ['search', 'Find release'], ['overrides', 'Overrides'], ['list', 'AniList']] as [k, label]}
          <button role="tab" aria-selected={tab === k} onclick={() => setTab(k)}>{label}</button>
        {/each}
      </div>

      {#if tab === 'episodes'}
        <section class="stack" style="--gap:16px">
          <div class="legend">
            <span><i class="sw seen"></i>Watched</span><span><i class="sw have"></i>Downloaded</span><span><i class="sw miss"></i>Missing</span><span><i class="sw future"></i>Not aired</span>
          </div>
          <div class="eps">
            {#each episodeList as n (n)}
              {@const k = epKind(n)}
              <button class="ep {k}" title={k === 'miss' ? `Episode ${n} is missing. Find a release` : `Episode ${n}`}
                      disabled={k === 'future'} onclick={() => k === 'miss' && setTab('search', { ep: String(n) })}>{n}</button>
            {/each}
          </div>
          {#if missing.length}
            <div class="callout warn">
              <Icon name="alert" size={18} />
              <div><b>{plural(missing.length, 'episode')} missing</b><p>Episode{missing.length > 1 ? 's' : ''} {missing.slice(0, 8).join(', ')}{missing.length > 8 ? '…' : ''} {missing.length > 1 ? 'have' : 'has'} aired but {missing.length > 1 ? 'are' : 'is'} not downloaded.</p></div>
              <button class="btn btn-sm" onclick={() => setTab('search', { ep: String(missing[0]) })}>Find release</button>
            </div>
          {/if}
          {#if synopsis}<div class="syn"><h3>Synopsis</h3><p class="muted">{synopsis}</p></div>{/if}
        </section>

      {:else if tab === 'search'}
        <section class="stack" style="--gap:16px">
          <form class="searchrow" onsubmit={(e) => { e.preventDefault(); void search(); }}>
            <div class="field grow"><label for="ep">Episode</label><input id="ep" class="input tnum" type="number" min="0" bind:value={epInput} placeholder="Latest" /></div>
            <button class="btn btn-primary" type="submit" disabled={searching}><Icon name="search" size={16} />{searching ? 'Searching…' : 'Search Nyaa'}</button>
          </form>
          {#if searching}
            <div class="stack">{#each [0, 1, 2] as i}<div class="skeleton" style="height:84px"></div>{/each}</div>
          {:else if results}
            {#if results.length === 0}
              <div class="empty"><div class="glyph"><Icon name="search" size={22} /></div><b>No releases found</b><p>Nothing matched episode {searchedFor || 'latest'} for this show.</p></div>
            {:else}
              <ul class="results">
                {#each results as r, i (r.link)}
                  {@const st = downloadState[r.link] ?? 'idle'}
                  <li class="res card rise" style="--i:{i}">
                    <div class="rt">
                      <b class="clamp-2">{r.title}</b>
                      <div class="tags">
                        {#if group(r.title)}<span class="chip">{group(r.title)}</span>{/if}
                        {#if r.audioLabel}<span class="chip info">{r.audioLabel}</span>{/if}
                        {#if r.subtitleLabel}<span class="chip">{r.subtitleLabel}</span>{/if}
                        {#if r.score != null}<span class="chip ok tnum">match {r.score.toFixed(2)}</span>{/if}
                      </div>
                      <span class="faint meta tnum">{r.size} · {r.seeders} seeders · {relative(r.pubDate)}</span>
                    </div>
                    {#if st === 'success'}
                      <button class="btn btn-sm btn-success" disabled aria-label="Sent to qBittorrent">
                        <Icon name="check" size={14} stroke={2.6} />
                        <span>Sent</span>
                      </button>
                    {:else if st === 'sending' || downloading === r.link}
                      <button class="btn btn-sm btn-primary" disabled aria-label="Sending download to qBittorrent">
                        <span class="spin-sm" aria-hidden="true"></span>
                        <span>Sending…</span>
                      </button>
                    {:else if st === 'error'}
                      <button class="btn btn-sm btn-danger" onclick={() => download(r)} aria-label="Download failed. Click to retry">
                        <Icon name="alert" size={14} />
                        <span>Failed · Retry</span>
                      </button>
                    {:else}
                      <button class="btn btn-sm btn-primary" onclick={() => download(r)} disabled={downloading !== null} aria-label="Download release">
                        <Icon name="download" size={14} />
                        <span>Download</span>
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          {:else}
            <p class="muted">Pick an episode and search Nyaa. Results are scored against this show's title, release group and your audio/subtitle preferences.</p>
          {/if}
        </section>

      {:else if tab === 'overrides'}
        <section class="stack" style="--gap:18px">
          <div class="field"><label for="alt">Search title</label><input id="alt" class="input" bind:value={form.alt} placeholder={anime.media.title.romaji} />
            <p class="hint">Use this when releases are named differently from AniList (for example a shorter title or an added “S2”).</p></div>
          <div class="two">
            <div class="field"><label for="start">Episode offset</label><input id="start" class="input tnum" type="number" min="0" bind:value={form.start} />
              <p class="hint">For sequels that continue numbering (S2 starting at episode 13).</p></div>
            <div class="field"><label for="grp">Preferred release group</label><input id="grp" class="input" bind:value={form.group} placeholder="Any" /></div>
          </div>
          <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={form.jp} /><i></i></span><span><b>Require Japanese audio</b><small>Skip dubbed and dual-audio-only releases.</small></span></label>
          <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={form.subs} /><i></i></span><span><b>Require English subtitles</b><small>Skip releases that don't declare English subs.</small></span></label>
          <div class="row"><button class="btn btn-primary" disabled={!dirty || saving} onclick={saveOverrides}>{saving ? 'Saving…' : 'Save overrides'}</button>
            {#if dirty}<button class="btn btn-ghost" onclick={resetForm}>Discard</button>{/if}</div>
          <hr class="divider" />
          <div class="danger">
            <div><b>Search again now</b><p class="muted">Clear the back-off so the next cycle looks for missing episodes immediately.</p></div>
            <button class="btn" onclick={retryNow}><Icon name="refresh" size={15} />Retry</button>
          </div>
          <div class="danger">
            <div><b>Reset downloaded episodes</b><p class="muted">Forget what was downloaded. Use if files were deleted and you want them fetched again.</p></div>
            <button class="btn btn-danger" onclick={resetCache}>Reset</button>
          </div>
          <div class="danger">
            <div><b>Ignore this show</b><p class="muted">Stop the scheduler from searching for it.</p></div>
            <button class="btn btn-danger" onclick={ignoreShow}><Icon name="ban" size={15} />Ignore</button>
          </div>
        </section>

      {:else}
        <section class="stack" style="--gap:18px">
          <div class="card card-pad stack" style="--gap:14px">
            <div class="row between"><div><b>Watched progress</b><p class="muted">What AniList thinks you've watched.</p></div>
              <div class="stepper">
                <button class="icon-btn" disabled={listBusy || anime.progress <= 0} onclick={() => setProgress(anime.progress - 1)} aria-label="Decrease"><Icon name="minus" size={16} /></button>
                <b class="tnum">{anime.progress}</b>
                <button class="icon-btn" disabled={listBusy || (total != null && anime.progress >= total)} onclick={() => setProgress(anime.progress + 1)} aria-label="Increase"><Icon name="plus" size={16} /></button>
              </div></div>
            {#if aired > anime.progress}
              <button class="btn" disabled={listBusy} onclick={() => setProgress(aired)}><Icon name="check" size={15} />Mark everything aired as watched (episode {aired})</button>
            {/if}
          </div>
          <EpisodeBar total={total} aired={aired} downloaded={anime.downloadedEpisodes} progress={anime.progress} height={10} max={40} />
          <p class="hint">Changes are sent to AniList through Animu. Your token never reaches the browser.</p>
        </section>
      {/if}
    </div>
  {/if}
</Sheet>

<style>
  .hero { position: relative; padding: 70px 24px 22px; overflow: hidden; background: color-mix(in oklab, var(--tint) 30%, var(--bg-raised)); }
  .hero .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.4; filter: blur(2px) saturate(1.2); transform: scale(1.06); }
  .shade { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--bg-raised) 55%, transparent) 55%, var(--bg-raised) 100%); }
  .head { position: relative; display: flex; gap: 18px; align-items: flex-end; }
  .art { width: 112px; flex: none; border-radius: 12px; overflow: hidden; box-shadow: 0 14px 34px oklch(0 0 0 / 0.45); }
  .who { display: grid; gap: 8px; min-width: 0; padding-bottom: 2px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip.glass { background: oklch(0 0 0 / 0.38); color: #fff; border-color: transparent; backdrop-filter: blur(8px); text-transform: capitalize; }
  .t { font-size: clamp(20px, 3.4vw, 27px); line-height: 1.12; font-weight: 660; letter-spacing: -0.03em; text-wrap: balance; }
  .alt { color: var(--text-2); font-size: 13px; }
  .state { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .why { font-size: 12.5px; color: var(--text-2); }

  .body { padding: 6px 24px 36px; display: grid; gap: 20px; }
  .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
  .facts div { background: var(--surface); padding: 12px 14px; display: grid; gap: 2px; }
  .facts .k { font-size: 11.5px; color: var(--text-3); }
  .facts b { font: 620 15px/1.25 var(--font); letter-spacing: -0.02em; }

  .legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--text-2); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .sw.seen { background: color-mix(in oklab, var(--ok) 38%, var(--surface-3)); } .sw.have { background: var(--ok); } .sw.miss { background: var(--warn); } .sw.future { box-shadow: inset 0 0 0 1px var(--line-strong); }
  .eps { display: grid; grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)); gap: 6px; }
  .ep { height: 38px; border-radius: 9px; border: 1px solid transparent; font: 600 13px var(--font); font-variant-numeric: tabular-nums; cursor: default; transition: transform var(--t-fast), background var(--t-fast); }
  .ep.seen { background: color-mix(in oklab, var(--ok) 16%, var(--surface-2)); color: color-mix(in oklab, var(--ok) 60%, var(--text-2)); }
  .ep.have { background: var(--ok-soft); color: var(--ok); }
  .ep.miss { background: var(--warn-soft); color: var(--warn); border-color: color-mix(in oklab, var(--warn) 40%, transparent); cursor: pointer; }
  .ep.miss:hover { transform: translateY(-2px); background: color-mix(in oklab, var(--warn) 24%, transparent); }
  .ep.future { background: transparent; border-color: var(--line); color: var(--text-3); }

  .callout { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: var(--r); }
  .callout p { font-size: 13px; color: var(--text-2); margin-top: 2px; }
  .callout.warn { background: var(--warn-soft); color: var(--warn); } .callout.warn b { color: var(--text); }
  .callout div { flex: 1; min-width: 0; }
  .syn h3 { margin-bottom: 8px; } .syn p { line-height: 1.6; white-space: pre-line; }

  .searchrow { display: flex; gap: 10px; align-items: flex-end; }
  .results { display: grid; gap: 10px; }
  .res { display: flex; align-items: center; gap: 14px; padding: 14px; }
  .rt { display: grid; gap: 8px; min-width: 0; flex: 1; }
  .rt b { font-size: 13.5px; font-weight: 560; line-height: 1.35; word-break: break-word; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; }
  .meta { font-size: 12.5px; }

  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .toggle { display: flex; gap: 14px; align-items: center; cursor: pointer; }
  .toggle small { display: block; color: var(--text-3); font-size: 12.5px; margin-top: 1px; }
  .danger { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .danger p { font-size: 13px; margin-top: 2px; }
  .stepper { display: flex; align-items: center; gap: 6px; }
  .stepper b { min-width: 34px; text-align: center; font: 650 20px var(--font); }

  @media (max-width: 720px) {
    .hero { padding: 64px 18px 18px; } .body { padding-inline: 18px; }
    .art { width: 92px; } .facts { grid-template-columns: repeat(2, 1fr); } .two { grid-template-columns: 1fr; }
    .res { flex-direction: column; align-items: stretch; } .searchrow { flex-wrap: wrap; }
  }
</style>
