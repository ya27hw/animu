<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import { app, theme, toggleTheme, setTitleLang, loadStatus } from '../lib/store.svelte';
  import { toast } from '../lib/toast.svelte';
  import { ask } from '../lib/confirm.svelte';
  import { relative } from '../lib/format';
  import type { Config } from '../lib/types';
  import Icon from '../components/Icon.svelte';

  let original = $state<Config | null>(null);
  let draft = $state<Config>({});
  let secrets = $state<Record<string, string>>({ password: '', webhook: '', proxyPassword: '' });
  let loadError = $state('');
  let saving = $state(false);
  let testing = $state<string | null>(null);
  let active = $state('account');

  // text-backed fields
  let excludeText = $state('');
  let tierText = $state('');

  async function loadConfig() {
    try {
      const cfg = await api.get<Config>('/api/config');
      original = cfg;
      draft = JSON.parse(JSON.stringify(cfg));
      excludeText = (cfg.excludeReleaseGroups ?? []).join(', ');
      tierText = Object.entries(cfg.releaseGroupTierOverrides ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
      secrets = { password: '', webhook: '', proxyPassword: '' };
    } catch (e) { loadError = e instanceof Error ? e.message : 'Could not load settings'; }
  }

  // --- AniList auth ---
  interface AuthState { authenticated: boolean; needsReauth: boolean; userName: string; tokenExpiry: { present: boolean; expired: boolean; expiresAt: string | null; daysRemaining: number | null } }
  let auth = $state<AuthState | null>(null);
  let code = $state('');
  let pinUrl = $state('');
  let connecting = $state(false);
  const loadAuth = () => api.get<AuthState>('/api/anilist/auth/state').then((r) => (auth = r)).catch(() => {});

  async function getCode() {
    try {
      const r = await api.get<{ authUrl: string }>('/api/anilist/auth/pin');
      pinUrl = r.authUrl;
      window.open(r.authUrl, '_blank', 'noopener');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not start sign-in. Is anilistClientId set in profile.json?', 'bad'); }
  }
  async function connect() {
    connecting = true;
    try { await api.post('/api/anilist/auth/callback', { code: code.trim() }); toast('AniList connected', 'ok'); code = ''; pinUrl = ''; await loadAuth(); void loadStatus(); }
    catch (e) { toast(e instanceof Error ? e.message : 'That code was not accepted', 'bad'); }
    finally { connecting = false; }
  }
  async function disconnect() {
    if (!(await ask({ title: 'Disconnect AniList?', body: 'Animu will stop being able to update your list (progress, adding shows) until you sign in again.', confirmLabel: 'Disconnect', danger: true }))) return;
    await api.post('/api/anilist/auth/clear').catch(() => {});
    await loadAuth(); void loadStatus();
  }

  // --- ignore list ---
  interface Ignored { id: string; title: string; media_id: number | null; added_at: string }
  let ignored = $state<Ignored[]>([]);
  let ignoreInput = $state('');
  const loadIgnored = () => api.get<{ ignored: Ignored[] }>('/api/ignored').then((r) => (ignored = r.ignored)).catch(() => {});
  async function addIgnored() {
    if (!ignoreInput.trim()) return;
    await api.post('/api/ignored', { title: ignoreInput.trim() }).then(() => { ignoreInput = ''; return loadIgnored(); }).catch((e) => toast(e.message, 'bad'));
  }
  async function removeIgnored(i: Ignored) { await api.del(`/api/ignored/${encodeURIComponent(i.id)}`).then(loadIgnored).catch((e) => toast(e.message, 'bad')); }

  onMount(() => {
    void loadConfig(); void loadAuth(); void loadIgnored();
    // Highlight the nav item for the section currently in view.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) active = (e.target as HTMLElement).dataset.sec ?? active;
    }, { rootMargin: '-20% 0px -65% 0px' });
    document.querySelectorAll('[data-sec]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  });

  // --- dirty tracking ---
  const parsedExclude = $derived(excludeText.split(',').map((s) => s.trim()).filter(Boolean));
  const parsedTiers = $derived.by(() => {
    const out: Record<string, string | number> = {};
    for (const line of tierText.split('\n')) {
      const [k, ...rest] = line.split('=');
      const v = rest.join('=').trim();
      if (k.trim() && v) out[k.trim()] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    }
    return out;
  });
  const changes = $derived.by(() => {
    const out: Config = {};
    if (!original) return out;
    for (const [k, v] of Object.entries(draft)) {
      if (k === 'excludeReleaseGroups' || k === 'releaseGroupTierOverrides') continue;
      if (JSON.stringify(v) !== JSON.stringify(original[k])) out[k] = v;
    }
    if (JSON.stringify(parsedExclude) !== JSON.stringify(original.excludeReleaseGroups ?? [])) out.excludeReleaseGroups = parsedExclude;
    if (JSON.stringify(parsedTiers) !== JSON.stringify(original.releaseGroupTierOverrides ?? {})) out.releaseGroupTierOverrides = parsedTiers;
    for (const [k, v] of Object.entries(secrets)) if (v) out[k] = v;
    return out;
  });
  const dirty = $derived(Object.keys(changes).length > 0);

  async function save() {
    saving = true;
    try {
      await api.patch('/api/config', changes);
      toast('Settings saved and applied', 'ok');
      await loadConfig(); void loadStatus();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { saving = false; }
  }
  function discard() {
    if (!original) return;
    draft = JSON.parse(JSON.stringify(original));
    excludeText = (original.excludeReleaseGroups ?? []).join(', ');
    tierText = Object.entries(original.releaseGroupTierOverrides ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
    secrets = { password: '', webhook: '', proxyPassword: '' };
  }

  async function test(kind: 'qbittorrent' | 'proxy' | 'discord') {
    testing = kind;
    try {
      const body = kind === 'qbittorrent' ? { qbitUrl: draft.qbit_url, username: draft.username, password: secrets.password }
        : kind === 'proxy' ? { proxyAddress: draft.proxyAddress, proxyPort: draft.proxyPort }
        : { webhook: secrets.webhook };
      const r = await api.post<{ ok: boolean; message?: string; error?: string }>(`/api/test/${kind}`, body);
      toast(r.ok ? (r.message ?? 'Connection successful') : (r.error ?? r.message ?? 'Test failed'), r.ok ? 'ok' : 'bad');
    } catch (e) { toast(e instanceof Error ? e.message : 'Test failed', 'bad'); }
    finally { testing = null; }
  }

  const SECTIONS = [
    ['account', 'AniList', 'user'], ['downloads', 'qBittorrent', 'download'], ['releases', 'Releases', 'film'], ['scheduler', 'Scheduler', 'clock'],
    ['network', 'Network', 'globe'], ['notify', 'Notifications', 'bell'], ['ignore', 'Ignore list', 'ban'], ['interface', 'Interface', 'sparkles'],
  ] as const;
  const go = (id: string) => { active = id; document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
</script>

<div class="page">
  <header class="page-head"><div><h1>Settings</h1><p class="sub">Connections, release preferences and how often Animu looks for new episodes.</p></div></header>

  {#if loadError}
    <div class="empty card"><div class="glyph"><Icon name="alert" size={24} /></div><h2>Couldn't load settings</h2><p>{loadError}</p></div>
  {:else if !original}
    <div class="stack">{#each [0, 1, 2] as i}<div class="skeleton" style="height:140px"></div>{/each}</div>
  {:else}
    <div class="layout">
      <nav class="nav" aria-label="Settings sections">
        {#each SECTIONS as [id, label, icon]}
          <button class:on={active === id} onclick={() => go(id)}><Icon name={icon} size={16} />{label}</button>
        {/each}
      </nav>

      <div class="sections">
        <section id="sec-account" data-sec="account" class="card pad">
          <header><h2>AniList</h2><p class="muted">Used to read your Watching list and to update progress. The token stays on the server.</p></header>
          <div class="authrow">
            <span class="dot {auth?.authenticated ? 'ok' : 'warn'}"></span>
            <div class="grow"><b>{auth?.authenticated ? `Connected${auth.userName ? ` as ${auth.userName}` : ''}` : 'Not connected'}</b>
              <p class="faint">{#if auth?.tokenExpiry?.present}{auth.tokenExpiry.expired ? 'Token expired. Sign in again.' : `Token expires ${relative(auth.tokenExpiry.expiresAt)} (${auth.tokenExpiry.daysRemaining} days)`}{:else}Sign in to let Animu update your list.{/if}</p></div>
            {#if auth?.authenticated}<button class="btn btn-ghost" onclick={disconnect}>Disconnect</button>{/if}
          </div>
          <div class="grid2">
            <div class="field"><label for="user">AniList username</label><input id="user" class="input" bind:value={draft.aniUserName} autocomplete="off" /></div>
          </div>
          <div class="pin">
            <div class="row" style="flex-wrap:wrap"><button class="btn" onclick={getCode}><Icon name="external" size={15} />{auth?.authenticated ? 'Sign in again' : 'Get sign-in code'}</button>
              <span class="hint">Opens AniList. Approve access, then paste the code it shows.</span></div>
            {#if pinUrl}<div class="row"><input class="input mono" bind:value={code} placeholder="Paste the code from AniList" aria-label="Authorization code" /><button class="btn btn-primary" disabled={!code.trim() || connecting} onclick={connect}>{connecting ? 'Connecting…' : 'Connect'}</button></div>{/if}
          </div>
        </section>

        <section id="sec-downloads" data-sec="downloads" class="card pad">
          <header><h2>qBittorrent</h2><p class="muted">Where torrents are sent and where finished episodes live.</p></header>
          <div class="grid2">
            <div class="field span2"><label for="qurl">Web UI address</label><input id="qurl" class="input mono" bind:value={draft.qbit_url} placeholder="http://localhost:8080" /></div>
            <div class="field"><label for="qu">Username</label><input id="qu" class="input" bind:value={draft.username} autocomplete="off" /></div>
            <div class="field"><label for="qp">Password</label><input id="qp" class="input" type="password" bind:value={secrets.password} placeholder="Leave blank to keep the saved password" autocomplete="new-password" /></div>
            <div class="field"><label for="rd">Library folder</label><input id="rd" class="input mono" bind:value={draft.rootDir} /></div>
            <div class="field"><label for="ard">Alternate folder</label><input id="ard" class="input mono" bind:value={draft.altRootDir} /><p class="hint">Used for titles that match the trigger genre.</p></div>
          </div>
          <div><button class="btn" onclick={() => test('qbittorrent')} disabled={testing === 'qbittorrent' || !secrets.password}><Icon name="zap" size={15} />{testing === 'qbittorrent' ? 'Testing…' : 'Test connection'}</button>
            {#if !secrets.password}<span class="hint" style="margin-left:10px">Enter the password to test.</span>{/if}</div>
        </section>

        <section id="sec-releases" data-sec="releases" class="card pad">
          <header><h2>Releases</h2><p class="muted">How Animu picks between releases on Nyaa.</p></header>
          <div class="grid2">
            <div class="field"><label for="res">Preferred resolution</label>
              <select id="res" class="select" bind:value={draft.resolution}><option value="2160">2160p (4K)</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option></select></div>
            <div class="field"><label for="trig">Trigger genre</label><input id="trig" class="input" bind:value={draft.triggerGenre} /><p class="hint">Shows with this genre use the alternate Nyaa URL and folder.</p></div>
            <div class="field"><label for="nyaa">Nyaa address</label><input id="nyaa" class="input mono" bind:value={draft.nyaaUrl} /></div>
            <div class="field"><label for="anyaa">Alternate Nyaa address</label><input id="anyaa" class="input mono" bind:value={draft.altNyaaUrl} /></div>
            <div class="field span2"><label for="ex">Excluded release groups</label><input id="ex" class="input" bind:value={excludeText} placeholder="Comma separated, e.g. Judas, EMBER" /></div>
            <div class="field span2"><label for="tiers">Release group ranking overrides</label><textarea id="tiers" class="textarea mono" bind:value={tierText} rows="3" placeholder="SubsPlease=S&#10;Erai-raws=A"></textarea><p class="hint">One <span class="mono">Group=Tier</span> per line (S, A, B, C, D or a score).</p></div>
          </div>
          <div class="toggles">
            <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={draft.preferReleaseGroup} /><i></i></span><span><b>Prefer trusted release groups</b><small>Rank groups by reputation before seeders.</small></span></label>
            <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={draft.preferUncensored} /><i></i></span><span><b>Prefer uncensored releases</b><small>When both exist, take the uncensored one.</small></span></label>
            <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={draft.preferJapaneseDub} /><i></i></span><span><b>Prefer Japanese audio</b><small>Prefer releases that keep the original audio.</small></span></label>
            <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={draft.requireEnglishSubs} /><i></i></span><span><b>Require English subtitles</b><small>Skip releases without declared English subs, for every show.</small></span></label>
          </div>
        </section>

        <section id="sec-scheduler" data-sec="scheduler" class="card pad">
          <header><h2>Scheduler</h2><p class="muted">How often Animu checks for new episodes. Cycles also run when a show is expected to air.</p></header>
          <div class="grid2">
            <div class="field"><label for="int">Peak interval (minutes)</label><input id="int" class="input tnum" type="number" min="5" max="720" bind:value={draft.interval} /><p class="hint">Used from 12:00 to 04:59.</p></div>
            <div class="field"><label for="off">Off-peak interval (minutes)</label><input id="off" class="input tnum" type="number" min="5" max="720" bind:value={draft.offpeakInterval} /><p class="hint">Used overnight and in the morning.</p></div>
          </div>
          <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={draft.setCompletedToRewatching} /><i></i></span><span><b>Mark finished shows as Rewatching</b><small>When every episode of a finished show is downloaded, set it to Rewatching on AniList.</small></span></label>
        </section>

        <section id="sec-network" data-sec="network" class="card pad">
          <header><h2>Network</h2><p class="muted">Route Nyaa and torrent downloads through a proxy.</p></header>
          <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={draft.useProxy} /><i></i></span><span><b>Use a proxy for Nyaa</b><small>Needed where Nyaa is blocked.</small></span></label>
          <div class="grid2">
            <div class="field"><label for="pa">Proxy address</label><input id="pa" class="input mono" bind:value={draft.proxyAddress} /></div>
            <div class="field"><label for="pp">Proxy port</label><input id="pp" class="input tnum" type="number" bind:value={draft.proxyPort} /></div>
          </div>
          <div><button class="btn" onclick={() => test('proxy')} disabled={testing === 'proxy'}><Icon name="zap" size={15} />{testing === 'proxy' ? 'Testing…' : 'Test proxy'}</button></div>
        </section>

        <section id="sec-notify" data-sec="notify" class="card pad">
          <header><h2>Notifications</h2><p class="muted">Discord messages when downloads start or searches keep failing.</p></header>
          <div class="field"><label for="wh">Discord webhook URL</label><input id="wh" class="input mono" type="password" bind:value={secrets.webhook} placeholder="Leave blank to keep the saved webhook" autocomplete="off" /></div>
          <div class="toggles">
            <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={draft.discordEnableDownload} /><i></i></span><span><b>Announce new downloads</b></span></label>
            <label class="toggle"><span class="switch"><input type="checkbox" bind:checked={draft.discordEnableFail} /><i></i></span><span><b>Alert when a show can't be found</b></span></label>
          </div>
          <div class="grid2"><div class="field"><label for="thr">Alert after consecutive failures</label><input id="thr" class="input tnum" type="number" min="1" max="10" bind:value={draft.discordFailThreshold} /></div></div>
          <div><button class="btn" onclick={() => test('discord')} disabled={testing === 'discord' || !secrets.webhook}><Icon name="send" size={15} />{testing === 'discord' ? 'Sending…' : 'Send test message'}</button>
            {#if !secrets.webhook}<span class="hint" style="margin-left:10px">Enter a webhook to test it.</span>{/if}</div>
        </section>

        <section id="sec-ignore" data-sec="ignore" class="card pad">
          <header><h2>Ignore list</h2><p class="muted">Shows the scheduler never searches for.</p></header>
          <form class="row" onsubmit={(e) => { e.preventDefault(); void addIgnored(); }}><input class="input" bind:value={ignoreInput} placeholder="Add a title to ignore" aria-label="Title to ignore" /><button class="btn" type="submit" disabled={!ignoreInput.trim()}><Icon name="plus" size={15} />Add</button></form>
          {#if ignored.length === 0}<p class="muted">Nothing is ignored.</p>
          {:else}<ul class="ig">{#each ignored as i (i.id)}<li><span class="grow clamp-1">{i.title || `Media ${i.media_id}`}</span>{#if i.media_id}<span class="chip">ID {i.media_id}</span>{/if}<button class="icon-btn sm" onclick={() => removeIgnored(i)} aria-label="Stop ignoring {i.title}"><Icon name="x" size={15} /></button></li>{/each}</ul>{/if}
        </section>

        <section id="sec-interface" data-sec="interface" class="card pad">
          <header><h2>Interface</h2><p class="muted">Stored in this browser only.</p></header>
          <div class="grid2">
            <div class="field"><span class="label">Theme</span>
              <div class="seg" role="group" aria-label="Theme"><button aria-pressed={theme.mode === 'dark'} onclick={() => theme.mode !== 'dark' && toggleTheme()}><Icon name="moon" size={14} /> Dark</button><button aria-pressed={theme.mode === 'light'} onclick={() => theme.mode !== 'light' && toggleTheme()}><Icon name="sun" size={14} /> Light</button></div></div>
            <div class="field"><span class="label">Title language</span>
              <div class="seg" role="group" aria-label="Title language"><button aria-pressed={app.titleLang === 'romaji'} onclick={() => setTitleLang('romaji')}>Romaji</button><button aria-pressed={app.titleLang === 'english'} onclick={() => setTitleLang('english')}>English</button></div></div>
          </div>
          <p class="hint">Shortcuts: <span class="kbd">⌘K</span> or <span class="kbd">/</span> search · <span class="kbd">g</span> then <span class="kbd">t</span> <span class="kbd">l</span> <span class="kbd">d</span> <span class="kbd">q</span> <span class="kbd">h</span> <span class="kbd">a</span> <span class="kbd">s</span> to jump between pages.</p>
        </section>
      </div>
    </div>
  {/if}
</div>

{#if dirty}
  <div class="savebar" role="region" aria-label="Unsaved changes">
    <span class="msg"><span class="dot warn"></span>You have unsaved changes</span>
    <button class="btn btn-ghost" onclick={discard}>Discard</button>
    <button class="btn btn-primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
  </div>
{/if}

<style>
  .layout { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 32px; align-items: start; }
  .nav { position: sticky; top: 24px; display: grid; gap: 2px; }
  .nav button { display: flex; align-items: center; gap: 11px; height: 38px; padding: 0 12px; border: 0; border-radius: 10px; background: none; color: var(--text-2); font-weight: 540; cursor: pointer; text-align: left; }
  .nav button:hover { background: var(--surface-2); color: var(--text); } .nav button.on { background: var(--surface-2); color: var(--text); } .nav button.on :global(svg) { color: var(--accent); }
  .sections { display: grid; gap: 20px; max-width: 760px; }
  .pad { padding: 22px; display: grid; gap: 18px; scroll-margin-top: 20px; }
  header h2 { font-size: 17px; } header p { margin-top: 3px; font-size: 13.5px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .span2 { grid-column: 1 / -1; }
  .toggles { display: grid; gap: 16px; }
  .toggle { display: flex; align-items: center; gap: 14px; cursor: pointer; } .toggle b { font-weight: 560; } .toggle small { display: block; color: var(--text-3); font-size: 12.5px; margin-top: 1px; }
  .authrow { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: var(--r-sm); background: var(--bg-raised); border: 1px solid var(--line); }
  .authrow p { font-size: 12.5px; }
  .pin { display: grid; gap: 12px; }
  .ig li { display: flex; align-items: center; gap: 10px; padding: 8px 4px; } .ig li + li { border-top: 1px solid var(--line); }
  .savebar { position: fixed; z-index: 30; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 18px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line-strong); box-shadow: var(--shadow-2); animation: up 0.35s var(--ease); }
  .savebar .msg { display: flex; align-items: center; gap: 9px; font-weight: 540; margin-right: 8px; }
  @keyframes up { from { opacity: 0; transform: translate(-50%, 14px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .nav { position: static; display: flex; overflow-x: auto; scrollbar-width: none; padding-bottom: 6px; } .nav button { flex: none; } }
  @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } .savebar { bottom: calc(var(--tab-h) + 12px + env(safe-area-inset-bottom)); left: 12px; right: 12px; transform: none; } @keyframes up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } } .savebar .msg { display: none; } .savebar { justify-content: flex-end; } }
</style>
