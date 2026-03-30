import http, { IncomingMessage, ServerResponse } from "http";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { URL } from "url";
import anilist from "@ani/anilist";
import DB from "@db/db";
import schedule from "@scheduler/schedule";
import Nyaa from "@nyaa/nyaa";
import qbit from "@qbit/qbit";
import { aniUserName, triggerGenre } from "profile.json";

type AnimeApiItem = {
  mediaId: number;
  progress: number;
  downloadedEpisodes: number[];
  media: any;
};

type AnimePatchPayload = {
  alternativeTitle?: string;
  startingEpisode?: number;
  resetDownloadedEpisodes?: boolean;
};

type LogKey = "combined" | "out" | "error";

type LogApiResponse = {
  selected: LogKey;
  available: Array<{ key: LogKey; label: string }>;
  path: string;
  lines: number;
  content: string;
};

type NyaaSearchPayload = {
  episode?: number;
};

type NyaaDownloadPayload = {
  link?: string;
  episode?: number;
};

class WebUI {
  private server: http.Server | null;
  private port: number;
  private host: string;
  private dbReady: boolean;

  /**
   * Creates the Web UI server controller and reads host/port from env overrides.
   */
  constructor() {
    this.server = null;
    this.port = Number(process.env.ANIMU_WEB_PORT || 3210);
    this.host = process.env.ANIMU_WEB_HOST || "0.0.0.0";
    this.dbReady = false;
  }

  /**
   * Ensures Firebase auth is initialized before DB reads/writes.
   */
  private async ensureDbReady() {
    if (!this.dbReady) {
      await DB.logIn();
      this.dbReady = true;
    }
  }

  /**
   * Sends a JSON response with no-store caching.
   * @param res Node response object.
   * @param status HTTP status code.
   * @param data Serializable response payload.
   */
  private sendJson(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  }

  /**
   * Sends the single-page application HTML.
   * @param res Node response object.
   * @param html Fully rendered HTML document.
   */
  private sendHtml(res: ServerResponse, html: string) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  }

  /**
   * Reads and parses a JSON request body.
   * @param req Incoming HTTP request.
   * @returns Parsed JSON object or an empty object when the body is empty.
   */
  private async readJsonBody(req: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  }

  /**
   * Resolves the preferred display title for a rendered anime card.
   * @param item Anime item merged from AniList and Firestore.
   * @returns Best available title.
   */
  private getAnimeCardTitle(item: any) {
    if (!item || !item.media || !item.media.title) return "Unknown";
    return (
      item.media.alternativeTitle ||
      item.media.title.english ||
      item.media.title.romaji ||
      item.media.title.native ||
      "Unknown"
    );
  }

  /**
   * Sorts titles so alphabetic A-Z starters come first, then numbers/symbols/quotes.
   * @param title Romaji title text.
   */
  private getRomajiSortBucket(title: string): number {
    const trimmed = (title || "").trim();
    return /^[A-Za-z]/.test(trimmed) ? 0 : 1;
  }

  /**
   * Fetches AniList watching data and merges user overrides from Firestore.
   * @returns Sorted anime list for the frontend.
   */
  private async getAnimeList(): Promise<AnimeApiItem[]> {
    await this.ensureDbReady();
    const list = await anilist.getAnimeUserList();
    const merged = await Promise.all(
      list.map(async (anime) => {
        const entry = await DB.getByMediaId(String(anime.mediaId));
        const media = {
          ...anime.media,
          alternativeTitle:
            entry && entry.media ? entry.media.alternativeTitle : undefined,
          startingEpisode:
            entry && entry.media && typeof entry.media.startingEpisode === "number"
              ? entry.media.startingEpisode
              : 0,
        };

        return {
          mediaId: anime.mediaId,
          progress: anime.progress,
          downloadedEpisodes: (entry && entry.downloadedEpisodes) || [],
          media,
        } as AnimeApiItem;
      })
    );

    return merged.sort((a, b) => {
      const aRaw = a.media?.title?.romaji || "";
      const bRaw = b.media?.title?.romaji || "";
      const aBucket = this.getRomajiSortBucket(aRaw);
      const bBucket = this.getRomajiSortBucket(bRaw);
      if (aBucket !== bBucket) return aBucket - bBucket;
      const aTitle = aRaw.toLowerCase();
      const bTitle = bRaw.toLowerCase();
      if (aTitle < bTitle) return -1;
      if (aTitle > bTitle) return 1;
      return a.mediaId - b.mediaId;
    });
  }

  /**
   * Applies editable anime settings stored by the scheduler.
   * @param mediaId AniList media ID.
   * @param payload Patch payload from the web form.
   */
  private async updateAnimeSettings(
    mediaId: string,
    payload: AnimePatchPayload
  ): Promise<void> {
    await this.ensureDbReady();

    const updateData: Record<string, any> = {};

    if (typeof payload.alternativeTitle === "string") {
      updateData["media.alternativeTitle"] = payload.alternativeTitle.trim();
    }

    if (typeof payload.startingEpisode === "number") {
      updateData["media.startingEpisode"] = Number.isFinite(payload.startingEpisode)
        ? Math.max(0, Math.trunc(payload.startingEpisode))
        : 0;
    }

    if (payload.resetDownloadedEpisodes) {
      updateData.downloadedEpisodes = [];
      schedule.clearOfflineDB(mediaId);
    }

    if (Object.keys(updateData).length === 0) return;

    await DB.modifyAnimeEntry(mediaId, updateData);
  }

  /**
   * Fetches and merges a single anime entry by AniList media ID.
   * @param mediaId AniList media ID.
   */
  private async getAnimeByMediaId(mediaId: number): Promise<AnimeApiItem | null> {
    const anime = (await this.getAnimeList()).find((x) => x.mediaId === mediaId);
    return anime || null;
  }

  /**
   * Computes the highest episode that has already aired for an anime.
   * Includes configured starting-episode offset.
   * @param anime Anime entry merged from AniList + Firestore.
   */
  private getMaxAiredEpisode(anime: AnimeApiItem): number {
    const offset =
      typeof anime.media?.startingEpisode === "number" ? anime.media.startingEpisode : 0;

    if (anime.media?.nextAiringEpisode?.episode) {
      return Math.max(0, anime.media.nextAiringEpisode.episode - 1 + offset);
    }

    if (typeof anime.media?.episodes === "number") {
      return Math.max(0, anime.media.episodes + offset);
    }

    return Math.max(0, (anime.progress || 0) + offset);
  }

  /**
   * Queries Nyaa for ranked single-episode candidates using the app's existing logic.
   * @param mediaId AniList media ID.
   * @param episode Absolute episode number to search for.
   */
  private async searchNyaaCandidates(mediaId: number, episode: number) {
    const anime = await this.getAnimeByMediaId(mediaId);
    if (!anime) {
      throw new Error(`Anime ${mediaId} not found in watching list`);
    }

    const startingEpisode =
      typeof anime.media?.startingEpisode === "number" ? anime.media.startingEpisode : 0;
    const altTitle =
      typeof anime.media?.alternativeTitle === "string"
        ? anime.media.alternativeTitle
        : undefined;
    const candidates = await Nyaa.searchEpisodeCandidates(
      {
        mediaId: anime.mediaId,
        progress: anime.progress,
        media: anime.media,
      } as any,
      episode,
      startingEpisode,
      altTitle
    );

    return {
      mediaId,
      episode,
      title: this.getAnimeCardTitle(anime),
      count: candidates.length,
      results: candidates.slice(0, 25).map((item) => ({
        title: item.title,
        link: item.link,
        seeders: item["nyaa:seeders"],
        size: item["nyaa:size"],
        pubDate: item.pubDate,
        score: Number(item.score.toFixed(3)),
      })),
    };
  }

  private async searchNyaaCandidatesByTitle(mediaId: number) {
    const anime = await this.getAnimeByMediaId(mediaId);
    if (!anime) {
      throw new Error(`Anime ${mediaId} not found in watching list`);
    }

    const startingEpisode =
      typeof anime.media?.startingEpisode === "number" ? anime.media.startingEpisode : 0;
    const altTitle =
      typeof anime.media?.alternativeTitle === "string"
        ? anime.media.alternativeTitle
        : undefined;
    const candidates = await Nyaa.searchTitleCandidates(
      {
        mediaId: anime.mediaId,
        progress: anime.progress,
        media: anime.media,
      } as any,
      startingEpisode,
      altTitle
    );

    return {
      mediaId,
      episode: null,
      title: this.getAnimeCardTitle(anime),
      count: candidates.length,
      results: candidates.slice(0, 25).map((item) => ({
        title: item.title,
        link: item.link,
        seeders: item["nyaa:seeders"],
        size: item["nyaa:size"],
        pubDate: item.pubDate,
        score: Number(item.score.toFixed(3)),
      })),
    };
  }

  /**
   * Sends a selected Nyaa torrent to qBittorrent as a manual request/download.
   * @param mediaId AniList media ID.
   * @param payload Nyaa result link and episode number.
   */
  private async downloadNyaaCandidate(mediaId: number, payload: NyaaDownloadPayload) {
    const anime = await this.getAnimeByMediaId(mediaId);
    if (!anime) throw new Error(`Anime ${mediaId} not found in watching list`);

    const link = typeof payload.link === "string" ? payload.link.trim() : "";
    if (!link) throw new Error("Missing torrent link");

    const episode =
      typeof payload.episode === "number" ? payload.episode : undefined;
    if (episode !== undefined && (!Number.isFinite(episode) || episode < 1)) {
      throw new Error("Invalid episode");
    }

    const saveTitle = this.getAnimeCardTitle(anime);
    const ok = await qbit.addCheckTorrent(
      link,
      saveTitle,
      episode === undefined ? undefined : Math.trunc(episode),
      Nyaa.shouldUseProxyDownload({
        mediaId: anime.mediaId,
        progress: anime.progress,
        media: anime.media,
      } as any),
    );
    if (!ok) throw new Error("qBittorrent rejected the torrent request");

    return {
      ok: true,
      mediaId,
      episode: episode === undefined ? null : Math.trunc(episode),
      title: saveTitle,
    };
  }

  private async setAnimeToRewatching(mediaId: number): Promise<void> {
    const ok = await anilist.setAnimeToRewatching(mediaId);
    if (!ok) {
      throw new Error("AniList rejected the rewatching update");
    }
  }

  /**
   * Returns the application log files exposed in the Web UI.
   * Paths are relative to the repo root `logs/` directory.
   */
  private getLogFileMap(): Record<LogKey, { label: string; filePath: string }> {
    const rootDir = path.resolve(__dirname, "..", "..");
    const logsDir = path.join(rootDir, "logs");
    return {
      combined: { label: "Combined", filePath: path.join(logsDir, "animu.log") },
      out: { label: "Stdout", filePath: path.join(logsDir, "animu-out.log") },
      error: { label: "Stderr", filePath: path.join(logsDir, "animu-error.log") },
    };
  }

  /**
   * Returns candidate file paths for a given log source, including PM2 defaults.
   * @param key Log source key.
   */
  private getLogCandidates(key: LogKey): string[] {
    const local = this.getLogFileMap()[key].filePath;
    const pm2LogsDir = path.join(os.homedir(), ".pm2", "logs");
    const namesByKey: Record<LogKey, string[]> = {
      combined: ["Animu.log", "animu.log", "Animu-combined.log", "animu-combined.log"],
      out: ["Animu-out.log", "animu-out.log"],
      error: ["Animu-error.log", "animu-error.log", "Animu-err.log", "animu-err.log"],
    };

    return [
      local,
      ...namesByKey[key].map((name) => path.join(pm2LogsDir, name)),
    ];
  }

  /**
   * Resolves the best log file path to read, preferring existing non-empty files.
   * @param key Log source key.
   */
  private async resolveLogFilePath(key: LogKey): Promise<string> {
    const candidates = this.getLogCandidates(key);
    let firstExisting: string | null = null;

    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) continue;
        if (!firstExisting) firstExisting = candidate;
        if (stat.size > 0) return candidate;
      } catch {
        continue;
      }
    }

    return firstExisting || candidates[0];
  }

  /**
   * Ensures the local `logs/` directory and expected PM2 log files exist.
   */
  private async ensureLogFilesExist(): Promise<void> {
    const files = this.getLogFileMap();
    const entries = Object.values(files);
    if (entries.length === 0) return;

    const logsDir = path.dirname(entries[0].filePath);
    await fs.mkdir(logsDir, { recursive: true });

    await Promise.all(
      entries.map(async (entry) => {
        try {
          await fs.access(entry.filePath);
        } catch {
          await fs.writeFile(entry.filePath, "", "utf8");
        }
      })
    );
  }

  /**
   * Reads a log file and returns the last N lines.
   * @param filePath Absolute log file path.
   * @param maxLines Number of trailing lines to return.
   */
  private async readLogTail(filePath: string, maxLines: number): Promise<string> {
    const chunkSize = 64 * 1024;
    try {
      const handle = await fs.open(filePath, "r");
      try {
        const stat = await handle.stat();
        if (stat.size === 0) return "";

        let position = stat.size;
        let text = "";
        let newlineCount = 0;

        while (position > 0 && newlineCount <= maxLines + 1) {
          const readSize = Math.min(chunkSize, position);
          position -= readSize;

          const buffer = Buffer.alloc(readSize);
          await handle.read(buffer, 0, readSize, position);

          text = buffer.toString("utf8") + text;
          newlineCount = (text.match(/\n/g) || []).length;
        }

        const normalized = text.replace(/\r\n/g, "\n");
        const lines = normalized.split("\n");
        return lines.slice(-maxLines).join("\n").trimEnd();
      } finally {
        await handle.close();
      }
    } catch (error: any) {
      if (error && error.code === "ENOENT") {
        return `Log file not found: ${filePath}`;
      }
      throw error;
    }
  }

  /**
   * Formats PM2 JSON log lines into `timestamp message` for display.
   * Falls back to the original line if parsing fails.
   * @param content Raw tailed log content.
   */
  private formatLogContent(content: string): string {
    if (!content) return content;

    const lines = content.split(/\r?\n/);
    const formatted = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";

      try {
        const parsed = JSON.parse(trimmed) as Record<string, any>;
        if (!parsed || typeof parsed !== "object") return line;

        const timestamp =
          parsed.timestamp ||
          parsed.time ||
          parsed.date ||
          parsed["log_date"] ||
          parsed["@timestamp"] ||
          "";

        const message =
          parsed.message ??
          parsed.msg ??
          parsed.data ??
          parsed.log ??
          parsed.err ??
          "";

        const tsText = timestamp ? String(timestamp) : "";
        const msgText =
          typeof message === "string" ? message : JSON.stringify(message);

        if (!tsText && !msgText) return line;
        if (!tsText) return msgText;
        if (!msgText) return tsText;
        return `${tsText} ${msgText}`;
      } catch {
        return line;
      }
    });

    return formatted.join("\n");
  }

  /**
   * Builds the frontend payload for the logs viewer.
   * @param url Request URL with `name` and `lines` query params.
   */
  private async getLogsPayload(url: URL): Promise<LogApiResponse> {
    await this.ensureLogFilesExist();
    const files = this.getLogFileMap();
    const requested = (url.searchParams.get("name") || "combined") as LogKey;
    const selected: LogKey = files[requested] ? requested : "combined";
    const linesRaw = Number(url.searchParams.get("lines") || 50);
    const lines = Number.isFinite(linesRaw)
      ? Math.min(1000, Math.max(20, Math.trunc(linesRaw)))
      : 50;

    const file = files[selected];
    const resolvedPath = await this.resolveLogFilePath(selected);
    const rawContent = await this.readLogTail(resolvedPath, lines);
    const content = this.formatLogContent(rawContent);

    return {
      selected,
      available: (Object.keys(files) as LogKey[]).map((key) => ({
        key,
        label: files[key].label,
      })),
      path: resolvedPath,
      lines,
      content,
    };
  }

  /**
   * Handles all `/api/*` routes used by the single-page frontend.
   * @param req Incoming request.
   * @param res Outgoing response.
   * @param url Parsed request URL.
   */
  private async routeApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    try {
      if (req.method === "GET" && url.pathname === "/api/anime") {
        const anime = await this.getAnimeList();
        this.sendJson(res, 200, {
          userName: aniUserName,
          count: anime.length,
          anime,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/logs") {
        const logs = await this.getLogsPayload(url);
        this.sendJson(res, 200, logs);
        return;
      }

      const nyaaMatch = url.pathname.match(/^\/api\/anime\/(\d+)\/nyaa-search$/);
      if (nyaaMatch && req.method === "POST") {
        const body = (await this.readJsonBody(req)) as NyaaSearchPayload;
        const mediaId = Number(nyaaMatch[1]);
        const episode = typeof body.episode === "number" ? body.episode : undefined;
        if (episode !== undefined && (!Number.isFinite(episode) || episode < 1)) {
          this.sendJson(res, 400, { error: "Invalid episode" });
          return;
        }
        const response = episode !== undefined
          ? await this.searchNyaaCandidates(mediaId, Math.trunc(episode))
          : await this.searchNyaaCandidatesByTitle(mediaId);
        this.sendJson(res, 200, response);
        return;
      }

      const nyaaDownloadMatch = url.pathname.match(
        /^\/api\/anime\/(\d+)\/nyaa-download$/
      );
      if (nyaaDownloadMatch && req.method === "POST") {
        const body = (await this.readJsonBody(req)) as NyaaDownloadPayload;
        const response = await this.downloadNyaaCandidate(
          Number(nyaaDownloadMatch[1]),
          body
        );
        this.sendJson(res, 200, response);
        return;
      }

      const rewatchingMatch = url.pathname.match(/^\/api\/anime\/(\d+)\/rewatching$/);
      if (rewatchingMatch && req.method === "POST") {
        await this.setAnimeToRewatching(Number(rewatchingMatch[1]));
        this.sendJson(res, 200, { ok: true });
        return;
      }

      const animeMatch = url.pathname.match(/^\/api\/anime\/(\d+)$/);
      if (animeMatch && req.method === "PATCH") {
        const body = (await this.readJsonBody(req)) as AnimePatchPayload;
        await this.updateAnimeSettings(animeMatch[1], body);
        this.sendJson(res, 200, { ok: true });
        return;
      }

      if (animeMatch && req.method === "POST" && url.pathname.endsWith("/reset")) {
        await this.updateAnimeSettings(animeMatch[1], {
          resetDownloadedEpisodes: true,
        });
        this.sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        this.sendJson(res, 200, { ok: true });
        return;
      }

      this.sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      console.error("Web UI API error:", error);
      this.sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  }

  /**
   * Returns the entire HTML shell and client-side script for the Web UI.
   */
  private getIndexHtml() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Animu Control Panel</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
    :root{
      --bg:#08111f;
      --panel:#101c2f;
      --panel-2:#162540;
      --line:#263a5f;
      --text:#ecf3ff;
      --muted:#9fb0d0;
      --accent:#7cf0cc;
      --accent-2:#56a4ff;
      --danger:#ff7a90;
      --shadow:0 18px 40px rgba(0,0,0,.35);
      --radius:20px;
    }
    html{
      background:#060b15;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      color:var(--text);
      font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background:
        radial-gradient(900px 500px at -10% -10%, rgba(124,240,204,.18), transparent 60%),
        radial-gradient(900px 600px at 110% 10%, rgba(86,164,255,.2), transparent 55%),
        linear-gradient(180deg, #070d18, #091223 40%, #060b15 100%);
      min-height:100vh;
      overscroll-behavior: none;
    }
    button, input, select, textarea, label, h1, h2, h3, p, span, div {
      font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .shell{
      max-width:1200px;
      margin:0 auto;
      padding:24px 16px 48px;
    }
    .hero{
      display:flex;
      justify-content:space-between;
      gap:16px;
      align-items:center;
      padding:20px;
      background:linear-gradient(145deg, rgba(16,28,47,.95), rgba(12,20,35,.92));
      border:1px solid rgba(255,255,255,.07);
      border-radius:24px;
      box-shadow:var(--shadow);
      backdrop-filter: blur(8px);
      margin-bottom:16px;
    }
    .hero h1{
      margin:0;
      font-size:clamp(1.2rem,2vw,2rem);
      letter-spacing:.02em;
    }
    .hero p{
      margin:6px 0 0;
      color:var(--muted);
      font-size:.95rem;
    }
    .actions{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
    }
    button,.btn{
      border:1px solid transparent;
      border-radius:12px;
      padding:10px 14px;
      color:var(--text);
      background:var(--panel-2);
      cursor:pointer;
      font-weight:600;
      transition:.18s ease;
    }
    button:hover{transform:translateY(-1px); border-color:rgba(255,255,255,.14)}
    .btn-primary{
      background:linear-gradient(135deg, var(--accent-2), #65d8ff);
      color:#06111f;
      box-shadow:0 8px 22px rgba(86,164,255,.35);
    }
    .toolbar{margin-bottom:10px;}
    .search{
      background:rgba(16,28,47,.9);
      border:1px solid rgba(255,255,255,.08);
      border-radius:14px;
      color:var(--text);
      padding:12px 14px;
      width:100%;
      outline:none;
    }
    .search:focus{border-color:rgba(124,240,204,.45); box-shadow:0 0 0 4px rgba(124,240,204,.12)}
    .summary-line{
      margin:0 0 14px;
      color:var(--muted);
      font-size:.88rem;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      flex-wrap:wrap;
    }
    .page-controls{
      display:flex;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
    }
    .page-pill{
      padding:6px 10px;
      border-radius:999px;
      border:1px solid rgba(255,255,255,.08);
      background:rgba(255,255,255,.03);
      color:var(--muted);
      font-size:.78rem;
    }
    .grid{
      display:grid;
      grid-template-columns:repeat(auto-fill,minmax(150px, 180px));
      gap:16px;
      align-items:start;
      justify-content:center;
    }
    .card{
      position:relative;
      border:none;
      background:transparent;
      box-shadow:none;
      padding:0;
      display:grid;
      gap:10px;
    }
    .poster-trigger{
      width:100%;
      display:grid;
      grid-template-rows:auto auto;
      gap:10px;
      background:transparent;
      border:none;
      padding:0;
      text-align:left;
      color:inherit;
      cursor:pointer;
    }
    .cover{
      width:100%;
      aspect-ratio:2 / 3;
      height:auto;
      display:block;
      border-radius:14px;
      object-fit:cover;
      background:#0b1321;
      border:1px solid rgba(255,255,255,.06);
    }
    .cover-censored{
      filter:blur(28px) saturate(.7);
      transform:scale(1.08);
      transform-origin:center;
    }
    .title{
      margin:0;
      font-size:.92rem;
      line-height:1.25;
      text-align:center;
    }
    .subtitle{
      margin:0;
      color:var(--muted);
      font-size:.75rem;
      text-align:center;
    }
    .detail-panel{
      border-top:1px solid rgba(255,255,255,.07);
      padding-top:10px;
      display:grid;
      gap:8px;
    }
    .meta{
      display:flex;
      flex-wrap:wrap;
      gap:7px;
      margin-bottom:4px;
    }
    .chip{
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.08);
      color:var(--muted);
      border-radius:999px;
      padding:4px 8px;
      font-size:.75rem;
    }
    .progress{
      height:8px;
      background:rgba(255,255,255,.05);
      border-radius:999px;
      overflow:hidden;
      margin-bottom:8px;
    }
    .progress > span{
      display:block;
      height:100%;
      background:linear-gradient(90deg,var(--accent), var(--accent-2));
    }
    .row{
      display:flex;
      justify-content:space-between;
      gap:10px;
      color:var(--muted);
      font-size:.82rem;
    }
    .detail-actions{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:8px;
    }
    .detail-page{
      display:grid;
      gap:16px;
      max-width:1200px;
      margin:0 auto;
      width:100%;
      justify-items:center;
    }
    .detail-dialog{
      width:min(1160px, calc(100vw - 18px));
    }
    .detail-shell{
      position:relative;
      display:grid;
      gap:12px;
    }
    .detail-top{
      width:min(1100px, 100%);
      display:grid;
      gap:8px;
    }
    .back-btn{
      justify-self:start;
    }
    .detail-layout{
      display:grid;
      grid-template-columns:minmax(260px, 360px) minmax(0, 1fr);
      gap:18px;
      align-items:start;
      padding:14px;
      border-radius:22px;
      border:1px solid rgba(255,255,255,.08);
      background:linear-gradient(160deg, rgba(16,28,47,.96), rgba(9,16,28,.98));
      box-shadow:var(--shadow);
      width:min(1100px, 100%);
      margin:0 auto;
    }
    .detail-poster{
      width:100%;
      aspect-ratio:2 / 3;
      object-fit:cover;
      border-radius:16px;
      border:1px solid rgba(255,255,255,.08);
      background:#0b1321;
    }
    .detail-info{
      display:grid;
      gap:12px;
    }
    .detail-title{
      margin:0;
      font-size:clamp(1.2rem, 2.2vw, 2rem);
      line-height:1.2;
      font-weight:800;
      letter-spacing:.01em;
    }
    .detail-subtitle{
      margin:0;
      color:var(--muted);
      font-size:.9rem;
    }
    .action-btn{
      border:1px solid rgba(255,255,255,.09);
      background:rgba(255,255,255,.03);
      border-radius:10px;
      padding:9px 10px;
      font-size:.8rem;
      font-weight:700;
      text-align:center;
    }
    .empty,.loading,.error{
      padding:22px;
      border-radius:16px;
      border:1px solid rgba(255,255,255,.07);
      background:rgba(16,28,47,.9);
      color:var(--muted);
    }
    .loading-spinner-wrap{
      position:fixed;
      inset:0;
      display:grid;
      place-items:center;
      background:rgba(6,10,18,.18);
      z-index:15;
      pointer-events:none;
    }
    .loading-spinner{
      width:62px;
      height:62px;
      border-radius:999px;
      border:4px solid rgba(255,255,255,.14);
      border-top-color:var(--accent);
      border-right-color:var(--accent-2);
      animation:spin .9s linear infinite;
      box-shadow:
        0 0 0 8px rgba(124,240,204,.05),
        0 10px 30px rgba(0,0,0,.35);
    }
    @keyframes spin{
      to{transform:rotate(360deg)}
    }
    dialog{
      width:min(560px, calc(100vw - 20px));
      border:none;
      border-radius:22px;
      padding:0;
      background:transparent;
    }
    dialog::backdrop{background:rgba(1,4,10,.72); backdrop-filter: blur(3px)}
    .modal{
      background:linear-gradient(165deg, #101d31, #0a1322);
      border:1px solid rgba(255,255,255,.08);
      border-radius:22px;
      padding:18px;
      box-shadow:var(--shadow);
      color:var(--text);
    }
    .modal h2{margin:0 0 6px; font-size:1.05rem; color:var(--text)}
    .modal p{margin:0 0 14px; color:var(--muted); font-size:.9rem}
    .form-grid{display:grid; gap:12px}
    label{display:grid; gap:6px; color:var(--muted); font-size:.82rem}
    input, textarea{
      width:100%;
      border:1px solid rgba(255,255,255,.09);
      background:rgba(255,255,255,.03);
      color:var(--text);
      border-radius:12px;
      padding:10px 12px;
      outline:none;
      font:inherit;
    }
    input:focus, textarea:focus{border-color:rgba(124,240,204,.42); box-shadow:0 0 0 4px rgba(124,240,204,.12)}
    .modal-actions{
      display:flex;
      justify-content:space-between;
      gap:10px;
      margin-top:14px;
      flex-wrap:wrap;
    }
    .danger{
      border-color:rgba(255,122,144,.3);
      background:rgba(255,122,144,.08);
      color:#ffd9df;
    }
    .status{
      min-height:20px;
      color:var(--muted);
      font-size:.85rem;
      margin-top:8px;
    }
    .muted{color:var(--muted)}
    .ok-icon{
      display:inline-block;
      background:transparent;
      border:none;
      color:inherit;
      font-size:.9rem;
      margin-left:6px;
      vertical-align:middle;
    }
    .fab{
      position:fixed;
      right:18px;
      bottom:18px;
      z-index:20;
      width:56px;
      height:56px;
      border-radius:18px;
      padding:0;
      display:grid;
      place-items:center;
      font-size:1.15rem;
      background:linear-gradient(145deg,#13243d,#0d1728);
      border:1px solid rgba(255,255,255,.09);
      box-shadow:0 14px 30px rgba(0,0,0,.35);
    }
    .logs-dialog{
      width:min(980px, calc(100vw - 18px));
    }
    .logs-shell{
      position:relative;
      display:grid;
      gap:12px;
    }
    .icon-close{
      position:absolute;
      top:12px;
      right:12px;
      width:34px;
      height:34px;
      border-radius:10px;
      padding:0;
      display:grid;
      place-items:center;
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.08);
      font-size:14px;
    }
    .logs-toolbar{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      align-items:center;
      justify-content:space-between;
    }
    .logs-controls{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      align-items:center;
    }
    select{
      border:1px solid rgba(255,255,255,.09);
      background:rgba(255,255,255,.03);
      color:var(--text);
      border-radius:12px;
      padding:10px 12px;
    }
    .log-path{
      font-size:.78rem;
      color:var(--muted);
      word-break:break-all;
    }
    .log-panel{
      border:1px solid rgba(255,255,255,.08);
      border-radius:16px;
      background:#03070d;
      padding:0;
      overflow:hidden;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.03);
    }
    .log-output{
      margin:0;
      padding:14px;
      max-height:60vh;
      overflow:auto;
      white-space:pre-wrap;
      word-break:break-word;
      line-height:1.35;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size:.78rem;
      color:#b4ffb8;
      background:
        linear-gradient(rgba(255,255,255,.02), rgba(255,255,255,0) 18px),
        #020508;
      text-shadow:0 0 10px rgba(86,255,123,.06);
      scrollbar-color:#1c3857 #07101d;
    }
    .nyaa-dialog{
      width:min(980px, calc(100vw - 18px));
    }
    .nyaa-shell{
      position:relative;
      display:grid;
      gap:12px;
    }
    .nyaa-controls{
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
      justify-content:space-between;
    }
    .nyaa-controls-left{
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
    }
    .results-list{
      display:grid;
      gap:10px;
      max-height:58vh;
      overflow:auto;
      padding-right:2px;
    }
    .result-item{
      border:1px solid rgba(255,255,255,.08);
      border-radius:14px;
      background:linear-gradient(160deg, rgba(255,255,255,.03), rgba(255,255,255,.015));
      padding:12px;
      display:grid;
      gap:8px;
    }
    .result-title{
      color:var(--text);
      text-decoration:none;
      font-weight:600;
      line-height:1.25;
      word-break:break-word;
    }
    .result-title:hover{color:var(--accent)}
    .result-meta{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      color:var(--muted);
      font-size:.78rem;
    }
    .result-actions{
      display:flex;
      justify-content:flex-end;
      gap:8px;
      flex-wrap:wrap;
    }
    .tiny-btn{
      padding:8px 10px;
      border-radius:10px;
      border:1px solid rgba(255,255,255,.1);
      background:rgba(5,10,16,.35);
      color:var(--text);
      font-weight:700;
      font-size:.78rem;
    }
    .score-chip{
      color:#c7ffef;
      border-color:rgba(124,240,204,.22);
      background:rgba(124,240,204,.08);
    }
    @media (max-width:640px){
      .hero{align-items:flex-start; flex-direction:column}
      .toolbar{grid-template-columns:1fr}
      .grid{
        grid-template-columns:repeat(3, minmax(0, 1fr));
        gap:10px;
      }
      .title{
        font-size:.78rem;
      }
      .detail-top{width:100%}
      .detail-layout{grid-template-columns:1fr}
      .detail-poster{
        width:min(220px, 70vw);
        justify-self:center;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero" id="heroSection">
      <div>
        <h1>Animu Control Panel</h1>
        <p>Watching list from AniList for <strong id="userName">${aniUserName}</strong>. Edit per-title overrides used by your bot/scheduler.</p>
      </div>
      <div class="actions">
        <button id="refreshBtn" class="btn-primary">🔄 Refresh</button>
      </div>
    </section>
    <section class="toolbar" id="toolbar">
      <input id="searchInput" class="search" type="search" placeholder="Search title, alt title, media ID..." />
    </section>
    <div class="summary-line" id="summaryRow">
      <div id="summaryText">Loading...</div>
    </div>
    <div id="feedback"></div>
    <main id="app" class="grid"></main>
  </div>
  <button id="logsFab" class="fab" type="button" title="View logs" aria-label="View logs">📝</button>

  <dialog id="settingsDialog">
    <form class="modal" id="settingsForm" method="dialog">
      <h2 id="modalTitle">Anime Settings</h2>
      <p id="modalSubtitle">Adjust overrides used by the scheduler.</p>
      <div class="form-grid">
        <label>
          Alternative Title (Nyaa search override)
          <input id="altTitleInput" name="alternativeTitle" type="text" maxlength="200" />
        </label>
        <label>
          Starting Episode Offset
          <input id="startingEpisodeInput" name="startingEpisode" type="number" min="0" step="1" />
        </label>
      </div>
      <div class="status" id="modalStatus"></div>
      <div class="modal-actions">
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" id="resetDownloadedBtn" class="danger">Reset Downloaded Episodes</button>
          <button type="button" id="setRewatchingBtn">Move to Rewatching</button>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" id="cancelBtn">Cancel</button>
          <button type="submit" id="saveBtn" class="btn-primary">Save Changes</button>
        </div>
      </div>
    </form>
  </dialog>
  <dialog id="detailDialog" class="detail-dialog">
    <div class="modal detail-shell" id="detailShell">
      <button id="closeDetailBtnTop" class="icon-close" type="button" aria-label="Close anime details">❌</button>
      <div id="detailContent"></div>
    </div>
  </dialog>
  <dialog id="logsDialog" class="logs-dialog">
    <div class="modal logs-shell" id="logsShell">
      <button id="closeLogsBtnTop" class="icon-close" type="button" aria-label="Close logs">❌</button>
      <div>
        <h2>Application Logs</h2>
        <p>Tail your PM2 log files from the Web UI.</p>
      </div>
      <div class="logs-toolbar">
        <div class="logs-controls">
          <label style="display:flex; align-items:center; gap:8px;">
            <span>Source</span>
            <select id="logSourceSelect"></select>
          </label>
          <label style="display:flex; align-items:center; gap:8px;">
            <span>Lines</span>
            <select id="logLinesSelect">
              <option value="50" selected>50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="400">400</option>
              <option value="800">800</option>
            </select>
          </label>
          <button id="refreshLogsBtn" type="button">🔄 Refresh Logs</button>
        </div>
      </div>
      <div class="log-path" id="logPathText"></div>
      <div class="status" id="logsStatus"></div>
      <div class="log-panel">
        <pre id="logOutput" class="log-output">Loading...</pre>
      </div>
    </div>
  </dialog>
  <dialog id="nyaaDialog" class="nyaa-dialog">
    <div class="modal nyaa-shell" id="nyaaShell">
      <button id="closeNyaaBtnTop" class="icon-close" type="button" aria-label="Close Nyaa search">❌</button>
      <div>
        <h2 id="nyaaModalTitle">Nyaa Episode Search</h2>
        <p id="nyaaModalSubtitle">Pick an episode or search by title only.</p>
      </div>
      <div class="nyaa-controls">
        <div class="nyaa-controls-left">
          <label style="display:flex; align-items:center; gap:8px;">
            <span>Episode</span>
            <select id="nyaaEpisodeSelect"></select>
          </label>
          <button id="runNyaaSearchBtn" type="button" class="btn-primary">🔎 Search Nyaa</button>
        </div>
      </div>
      <div class="status" id="nyaaStatus"></div>
      <div class="results-list" id="nyaaResults"></div>
    </div>
  </dialog>

  <script>
    const state = {
      anime: [],
      loading: false,
      query: "",
      selected: null,
      detailSelected: null,
      logs: {
        selected: "combined",
        lines: 50,
        available: [],
      },
      nyaa: {
        selectedAnime: null,
        selectedEpisode: null,
      },
    };

    const els = {
      app: document.getElementById("app"),
      feedback: document.getElementById("feedback"),
      userName: document.getElementById("userName"),
      heroSection: document.getElementById("heroSection"),
      toolbar: document.getElementById("toolbar"),
      summaryRow: document.getElementById("summaryRow"),
      summaryText: document.getElementById("summaryText"),
      refreshBtn: document.getElementById("refreshBtn"),
      searchInput: document.getElementById("searchInput"),
      dialog: document.getElementById("settingsDialog"),
      form: document.getElementById("settingsForm"),
      modalTitle: document.getElementById("modalTitle"),
      modalSubtitle: document.getElementById("modalSubtitle"),
      modalStatus: document.getElementById("modalStatus"),
      altTitleInput: document.getElementById("altTitleInput"),
      startingEpisodeInput: document.getElementById("startingEpisodeInput"),
      resetDownloadedBtn: document.getElementById("resetDownloadedBtn"),
      setRewatchingBtn: document.getElementById("setRewatchingBtn"),
      cancelBtn: document.getElementById("cancelBtn"),
      saveBtn: document.getElementById("saveBtn"),
      detailDialog: document.getElementById("detailDialog"),
      detailShell: document.getElementById("detailShell"),
      closeDetailBtnTop: document.getElementById("closeDetailBtnTop"),
      detailContent: document.getElementById("detailContent"),
      logsFab: document.getElementById("logsFab"),
      logsDialog: document.getElementById("logsDialog"),
      logsShell: document.getElementById("logsShell"),
      logSourceSelect: document.getElementById("logSourceSelect"),
      logLinesSelect: document.getElementById("logLinesSelect"),
      refreshLogsBtn: document.getElementById("refreshLogsBtn"),
      closeLogsBtnTop: document.getElementById("closeLogsBtnTop"),
      logPathText: document.getElementById("logPathText"),
      logsStatus: document.getElementById("logsStatus"),
      logOutput: document.getElementById("logOutput"),
      nyaaDialog: document.getElementById("nyaaDialog"),
      nyaaShell: document.getElementById("nyaaShell"),
      closeNyaaBtnTop: document.getElementById("closeNyaaBtnTop"),
      nyaaModalTitle: document.getElementById("nyaaModalTitle"),
      nyaaModalSubtitle: document.getElementById("nyaaModalSubtitle"),
      nyaaEpisodeSelect: document.getElementById("nyaaEpisodeSelect"),
      runNyaaSearchBtn: document.getElementById("runNyaaSearchBtn"),
      nyaaStatus: document.getElementById("nyaaStatus"),
      nyaaResults: document.getElementById("nyaaResults"),
    };

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function fmtDate(endDate) {
      if (!endDate || !endDate.year) return "Unknown";
      const m = endDate.month || 1;
      const d = endDate.day || 1;
      return new Date(endDate.year, m - 1, d).toLocaleDateString();
    }

    function nextAiringText(media) {
      if (!media || !media.nextAiringEpisode) return "No upcoming episode";
      const next = media.nextAiringEpisode;
      const when = new Date(Date.now() + Math.max(0, (next.timeUntilAiring || 0)) * 1000);
      const dateText = when.toLocaleDateString(undefined, {
        weekday: "short",
        day: "2-digit",
        month: "short",
      });
      return "EP " + next.episode + " • " + dateText;
    }

    function totalEpisodes(media) {
      return Number.isFinite(media?.episodes) ? media.episodes : "?";
    }

    function getDisplayTitle(item) {
      return item.media.title?.romaji || "Unknown";
    }

    function matchesQuery(item, query) {
      if (!query) return true;
      const hay = [
        item.mediaId,
        item.media.title?.romaji,
        item.media.title?.english,
        item.media.title?.native,
        item.media.alternativeTitle,
        ...(item.media.synonyms || []),
      ].join(" ").toLowerCase();
      return hay.includes(query.toLowerCase());
    }

    function setFeedback(message, type) {
      if (!message) {
        els.feedback.innerHTML = "";
        return;
      }
      const cls = type === "error" ? "error" : "loading";
      els.feedback.innerHTML = '<div class="' + cls + '">' + escapeHtml(message) + "</div>";
    }

    function getFilteredAnime() {
      return state.anime.filter((item) => matchesQuery(item, state.query));
    }

    function renderMainGrid(filtered) {
      els.heroSection.style.display = "";
      els.toolbar.style.display = "";
      els.summaryRow.style.display = "";

      if (!filtered.length) {
        els.app.innerHTML = '<div class="empty">No titles match your search.</div>';
        return;
      }

      els.app.innerHTML = filtered.map((item) => {
        const media = item.media || {};
        const title = getDisplayTitle(item);
        const isTriggered = Array.isArray(media.genres) && media.genres.includes(${JSON.stringify(triggerGenre)});
        return '<article class="card">' +
          '<button class="poster-trigger" data-action="open-detail" data-id="' + item.mediaId + '" aria-label="Open details for ' + escapeHtml(title) + '">' +
            '<img class="cover' + (isTriggered ? ' cover-censored' : '') + '" loading="lazy" alt="' + escapeHtml(title) + ' cover" src="' + escapeHtml(media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || "") + '">' +
            '<div>' +
              '<h3 class="title">' + escapeHtml(title) + '</h3>' +
            '</div>' +
          '</button>' +
        '</article>';
      }).join("");
    }

    function renderDetailModalContent(item) {
      const media = item.media || {};
      const title = getDisplayTitle(item);
      const total = totalEpisodes(media);
      const progressPct = typeof media.episodes === "number" && media.episodes > 0
        ? Math.min(100, Math.round((item.progress / media.episodes) * 100))
        : 0;
      const downloadedCount = Array.isArray(item.downloadedEpisodes) ? item.downloadedEpisodes.length : 0;
      const isFullyDownloaded = typeof media.episodes === "number" && media.episodes > 0 && downloadedCount >= media.episodes;
      const nextText = nextAiringText(media);

      els.detailContent.innerHTML =
          '<div class="detail-page">' +
            '<div class="detail-top">' +
              '<div class="detail-subtitle">🎬 ' + escapeHtml(title) + '</div>' +
            '</div>' +
            '<div class="detail-layout">' +
            '<img class="detail-poster" alt="' + escapeHtml(title) + ' cover" src="' + escapeHtml(media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || "") + '">' +
            '<div class="detail-info">' +
              '<div>' +
                '<h2 class="detail-title">' + escapeHtml(title) + '</h2>' +
                '<p class="detail-subtitle">🆔 <a href="https://anilist.co/anime/' + item.mediaId + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;">' + item.mediaId + '</a></p>' +
              '</div>' +
              '<div class="meta">' +
                '<span class="chip">📺 ' + escapeHtml(media.format || "Unknown") + '</span>' +
                '<span class="chip">📡 ' + escapeHtml(media.status || "Unknown") + '</span>' +
                '<span class="chip">↕️ Offset ' + (media.startingEpisode || 0) + '</span>' +
              '</div>' +
              '<div class="progress"><span style="width:' + progressPct + '%"></span></div>' +
              '<div class="row"><span>📈 Progress</span><span>' + item.progress + ' / ' + total + '</span></div>' +
              '<div class="row"><span>✅ Downloaded</span><span>' + downloadedCount + (isFullyDownloaded ? '<span class="ok-icon">✅</span>' : '') + '</span></div>' +
              '<div class="row"><span>🗓️ Next</span><span>' + escapeHtml(nextText) + '</span></div>' +
              '<div class="detail-actions">' +
                '<button class="action-btn" data-action="settings" data-id="' + item.mediaId + '" type="button">⚙️ Settings</button>' +
                '<button class="action-btn" data-action="nyaa" data-id="' + item.mediaId + '" type="button">📥 Request</button>' +
              '</div>' +
            '</div>' +
            '</div>' +
          '</div>';
    }

    function openDetailModal(mediaId) {
      const item = state.anime.find((a) => String(a.mediaId) === String(mediaId));
      if (!item) return;
      state.detailSelected = item.mediaId;
      renderDetailModalContent(item);
      if (typeof els.detailDialog.showModal === "function") els.detailDialog.showModal();
    }

    function closeDetailModal() {
      if (els.detailDialog.open) els.detailDialog.close();
      state.detailSelected = null;
    }

    function render() {
      const filtered = getFilteredAnime();
      els.summaryText.textContent = filtered.length + " / " + state.anime.length + " titles";

      if (state.loading && state.anime.length === 0) {
        els.app.innerHTML = '<div class="loading-spinner-wrap" aria-label="Loading anime list"><div class="loading-spinner" role="status" aria-hidden="true"></div></div>';
        return;
      }

      renderMainGrid(filtered);
    }

    function buildEpisodeOptions(item) {
      const total = Number.isFinite(item.media?.episodes) ? item.media.episodes : Math.max(12, (item.progress || 0) + 6);
      const offset = Number.isFinite(item.media?.startingEpisode) ? item.media.startingEpisode : 0;
      const maxEpisode = Math.max(0, total + offset);
      const startAt = Math.max(1, Math.min(Math.max(1, maxEpisode), (item.progress || 0) + 1 + offset));
      const options = [];
      for (let ep = 1; ep <= maxEpisode; ep++) {
        options.push({ value: ep, selected: ep === startAt });
      }
      return options;
    }

    function openNyaaSearch(mediaId) {
      const item = state.anime.find((a) => String(a.mediaId) === String(mediaId));
      if (!item) return;
      state.nyaa.selectedAnime = item;
      state.nyaa.selectedEpisode = null;
      els.nyaaModalTitle.textContent = "Nyaa Search • " + getDisplayTitle(item);
      els.nyaaModalSubtitle.textContent = "Media ID " + item.mediaId + " • Select an episode or use title-only search";
      const options = buildEpisodeOptions(item);
      els.nyaaEpisodeSelect.disabled = false;
      els.runNyaaSearchBtn.disabled = false;
      els.nyaaEpisodeSelect.innerHTML =
        '<option value="">Title only</option>' +
        options.map((opt) =>
          '<option value="' + opt.value + '"' + (opt.selected ? " selected" : "") + '>Episode ' + opt.value + '</option>'
        ).join("");
      els.nyaaEpisodeSelect.value = "";
      els.nyaaStatus.textContent = "";
      els.nyaaResults.innerHTML =
        '<div class="empty">📦 Select "Title only" or an episode, then click Search Nyaa.</div>';
      if (typeof els.nyaaDialog.showModal === "function") els.nyaaDialog.showModal();
    }

    function closeNyaaSearch() {
      if (els.nyaaDialog.open) els.nyaaDialog.close();
      state.nyaa.selectedAnime = null;
      state.nyaa.selectedEpisode = null;
    }

    function renderNyaaResults(data) {
      const results = Array.isArray(data.results) ? data.results : [];
      const hasEpisode = Number.isFinite(Number(data.episode)) && Number(data.episode) > 0;
      if (!results.length) {
        els.nyaaResults.innerHTML = hasEpisode
          ? '<div class="empty">No ranked candidates found for this episode.</div>'
          : '<div class="empty">No ranked candidates found for this title.</div>';
        return;
      }
      function scoreStyle(scoreValue) {
        const s = Number(scoreValue);
        const ratio = Math.max(0, Math.min(1, (Number.isFinite(s) ? s : 0) / 4));
        const hue = Math.round(ratio * 120); // 0 red -> 120 green
        const borderHue = Math.round(ratio * 120);
        return 'background: linear-gradient(135deg, hsla(' + hue + ', 70%, 45%, 0.18), rgba(255,255,255,0.02) 55%, rgba(0,0,0,0.08)); border-color: hsla(' + borderHue + ', 70%, 55%, 0.28);';
      }
      els.nyaaResults.innerHTML = results.map((item, idx) =>
        '<div class="result-item" style="' + scoreStyle(item.score) + '">' +
          '<a class="result-title" href="' + escapeHtml(item.link || "#") + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.title || "Untitled") + '</a>' +
          '<div class="result-meta">' +
            '<span class="chip score-chip">#' + (idx + 1) + ' • Score ' + escapeHtml(item.score) + '</span>' +
            '<span class="chip">🌱 ' + escapeHtml(item.seeders || "0") + ' seeders</span>' +
            '<span class="chip">📦 ' + escapeHtml(item.size || "?") + '</span>' +
            '<span class="chip">🕒 ' + escapeHtml(new Date(item.pubDate).toLocaleString()) + '</span>' +
          '</div>' +
          '<div class="result-actions">' +
            '<button class="tiny-btn" type="button" data-action="nyaa-download" data-link="' + encodeURIComponent(item.link || "") + '" data-episode="' + escapeHtml(data.episode ?? "") + '">📥 Download</button>' +
          '</div>' +
        '</div>'
      ).join("");
    }

    async function runNyaaDownload(link, episode) {
      const selectedAnime = state.nyaa.selectedAnime;
      if (!selectedAnime) return;
      const hasEpisode = episode !== undefined && episode !== null && episode !== "";
      const ep = hasEpisode ? Number(episode) : null;
      if (!link || (hasEpisode && !Number.isFinite(ep))) return;
      els.nyaaStatus.textContent = "📥 Sending request to qBittorrent...";
      try {
        const res = await fetch("/api/anime/" + selectedAnime.mediaId + "/nyaa-download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(hasEpisode ? { link, episode: ep } : { link }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Download request failed");
        els.nyaaStatus.textContent = hasEpisode
          ? "✅ Requested episode " + ep + " download"
          : "✅ Requested title-only torrent download";
      } catch (err) {
        els.nyaaStatus.textContent = err.message || "Download request failed";
      }
    }

    async function runNyaaSearch() {
      const selectedAnime = state.nyaa.selectedAnime;
      if (!selectedAnime) return;
      const selectedValue = els.nyaaEpisodeSelect.value;
      const hasEpisode = selectedValue !== "";
      const episode = hasEpisode ? Number(selectedValue) : null;
      if (hasEpisode && (!Number.isFinite(episode) || episode < 1)) return;
      state.nyaa.selectedEpisode = hasEpisode ? episode : null;
      els.runNyaaSearchBtn.disabled = true;
        els.nyaaStatus.textContent = "🔎 Searching Nyaa and ranking results...";
      try {
        const res = await fetch("/api/anime/" + selectedAnime.mediaId + "/nyaa-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(hasEpisode ? { episode } : {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Nyaa search failed");
        els.nyaaStatus.textContent = "✅ " + (data.count || 0) + " ranked result(s)";
        renderNyaaResults(data);
      } catch (err) {
        els.nyaaStatus.textContent = err.message || "Nyaa search failed";
        els.nyaaResults.innerHTML = "";
      } finally {
        els.runNyaaSearchBtn.disabled = false;
      }
    }

    function renderLogSourceOptions(options) {
      els.logSourceSelect.innerHTML = (options || []).map((item) =>
        '<option value="' + escapeHtml(item.key) + '">' + escapeHtml(item.label) + '</option>'
      ).join("");
      els.logSourceSelect.value = state.logs.selected;
    }

    function openLogs() {
      els.logsStatus.textContent = "";
      if (typeof els.logsDialog.showModal === "function") els.logsDialog.showModal();
      fetchLogs();
    }

    function closeLogs() {
      if (els.logsDialog.open) els.logsDialog.close();
    }

    async function fetchLogs() {
      els.refreshLogsBtn.disabled = true;
      els.logsStatus.textContent = "Loading logs...";
      try {
        const params = new URLSearchParams({
          name: state.logs.selected,
          lines: String(state.logs.lines),
        });
        const res = await fetch("/api/logs?" + params.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load logs");
        state.logs.selected = data.selected || state.logs.selected;
        state.logs.lines = data.lines || state.logs.lines;
        state.logs.available = Array.isArray(data.available) ? data.available : [];
        renderLogSourceOptions(state.logs.available);
        els.logLinesSelect.value = String(state.logs.lines);
        els.logPathText.textContent = data.path || "";
        els.logOutput.textContent = data.content || "(empty)";
        els.logsStatus.textContent = "Updated";
      } catch (err) {
        els.logsStatus.textContent = err.message || "Failed to load logs";
      } finally {
        els.refreshLogsBtn.disabled = false;
      }
    }

    async function fetchAnime() {
      const isInitialLoad = state.anime.length === 0;
      state.loading = true;
      if (!isInitialLoad) setFeedback("Refreshing AniList watching list...", "info");
      render();
      try {
        const res = await fetch("/api/anime");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load anime");
        state.anime = Array.isArray(data.anime) ? data.anime : [];
        if (data.userName) els.userName.textContent = data.userName;
        setFeedback("");
      } catch (err) {
        setFeedback(err.message || "Failed to load anime", "error");
      } finally {
        state.loading = false;
        render();
      }
    }

    function openSettings(mediaId) {
      const item = state.anime.find((a) => String(a.mediaId) === String(mediaId));
      if (!item) return;
      state.selected = item;
      const title = getDisplayTitle(item);
      els.modalTitle.textContent = title;
      els.modalSubtitle.textContent = "Media ID " + item.mediaId + " • " + (item.media.title?.romaji || "Unknown");
      els.altTitleInput.value = item.media.alternativeTitle || "";
      els.startingEpisodeInput.value = Number.isFinite(item.media.startingEpisode) ? String(item.media.startingEpisode) : "0";
      els.modalStatus.textContent = "";
      if (typeof els.dialog.showModal === "function") els.dialog.showModal();
    }

    function closeSettings() {
      if (els.dialog.open) els.dialog.close();
      state.selected = null;
    }

    async function saveSettings() {
      if (!state.selected) return;
      const mediaId = state.selected.mediaId;
      els.saveBtn.disabled = true;
      els.modalStatus.textContent = "Saving...";
      try {
        const payload = {
          alternativeTitle: els.altTitleInput.value,
          startingEpisode: Number(els.startingEpisodeInput.value || 0),
        };
        const res = await fetch("/api/anime/" + mediaId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to save");
        els.modalStatus.textContent = "Saved";
        await fetchAnime();
      } catch (err) {
        els.modalStatus.textContent = err.message || "Failed to save";
      } finally {
        els.saveBtn.disabled = false;
      }
    }

    async function resetDownloadedEpisodes() {
      if (!state.selected) return;
      const ok = confirm("Reset downloaded episodes for media ID " + state.selected.mediaId + "?");
      if (!ok) return;
      els.resetDownloadedBtn.disabled = true;
      els.modalStatus.textContent = "Resetting downloaded episodes...";
      try {
        const res = await fetch("/api/anime/" + state.selected.mediaId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resetDownloadedEpisodes: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to reset");
        els.modalStatus.textContent = "Downloaded episodes reset";
        await fetchAnime();
      } catch (err) {
        els.modalStatus.textContent = err.message || "Failed to reset";
      } finally {
        els.resetDownloadedBtn.disabled = false;
      }
    }

    async function moveAnimeToRewatching() {
      if (!state.selected) return;
      const ok = confirm("Move media ID " + state.selected.mediaId + " to REWATCHING on AniList?");
      if (!ok) return;
      els.setRewatchingBtn.disabled = true;
      els.modalStatus.textContent = "Updating AniList status...";
      try {
        const res = await fetch("/api/anime/" + state.selected.mediaId + "/rewatching", {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to update AniList status");
        els.modalStatus.textContent = "Moved to rewatching";
        await fetchAnime();
      } catch (err) {
        els.modalStatus.textContent = err.message || "Failed to update AniList status";
      } finally {
        els.setRewatchingBtn.disabled = false;
      }
    }

    els.refreshBtn.addEventListener("click", fetchAnime);
    els.searchInput.addEventListener("input", (e) => {
      state.query = e.target.value || "";
      render();
    });
    els.app.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "open-detail") {
        openDetailModal(btn.dataset.id);
        return;
      }
      if (btn.dataset.action === "settings") {
        openSettings(btn.dataset.id);
        return;
      }
      if (btn.dataset.action === "nyaa") {
        openNyaaSearch(btn.dataset.id);
      }
    });
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveSettings();
    });
    els.cancelBtn.addEventListener("click", closeSettings);
    els.resetDownloadedBtn.addEventListener("click", resetDownloadedEpisodes);
    els.setRewatchingBtn.addEventListener("click", moveAnimeToRewatching);
    els.closeDetailBtnTop.addEventListener("click", closeDetailModal);
    els.detailShell.addEventListener("click", (e) => e.stopPropagation());
    els.detailContent.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "settings") {
        openSettings(btn.dataset.id);
        return;
      }
      if (btn.dataset.action === "nyaa") {
        openNyaaSearch(btn.dataset.id);
      }
    });
    els.detailDialog.addEventListener("click", (e) => {
      if (e.target === els.detailDialog) closeDetailModal();
    });
    els.logsFab.addEventListener("click", openLogs);
    els.refreshLogsBtn.addEventListener("click", fetchLogs);
    els.closeLogsBtnTop.addEventListener("click", closeLogs);
    els.logsShell.addEventListener("click", (e) => e.stopPropagation());
    els.logSourceSelect.addEventListener("change", (e) => {
      state.logs.selected = e.target.value;
      fetchLogs();
    });
    els.logLinesSelect.addEventListener("change", (e) => {
      state.logs.lines = Number(e.target.value || 200);
      fetchLogs();
    });
    els.dialog.addEventListener("click", (e) => {
      const rect = els.form.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) closeSettings();
    });
    els.logsDialog.addEventListener("click", (e) => {
      if (e.target === els.logsDialog) closeLogs();
    });
    els.runNyaaSearchBtn.addEventListener("click", runNyaaSearch);
    els.nyaaEpisodeSelect.addEventListener("change", (e) => {
      state.nyaa.selectedEpisode = e.target.value ? Number(e.target.value) : null;
    });
    els.closeNyaaBtnTop.addEventListener("click", closeNyaaSearch);
    els.nyaaShell.addEventListener("click", (e) => e.stopPropagation());
    els.nyaaResults.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='nyaa-download']");
      if (!btn) return;
      const encodedLink = btn.dataset.link || "";
      const episode = btn.dataset.episode || "";
      runNyaaDownload(decodeURIComponent(encodedLink), episode);
    });
    els.nyaaDialog.addEventListener("click", (e) => {
      if (e.target === els.nyaaDialog) closeNyaaSearch();
    });
    fetchAnime();
  </script>
</body>
</html>`;
  }

  /**
   * Handles all incoming HTTP requests for static HTML and API routes.
   * @param req Incoming request.
   * @param res Outgoing response.
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await this.routeApi(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/" ||
        url.pathname === "/index.html" ||
        /^\/anime\/\d+$/.test(url.pathname))
    ) {
      this.sendHtml(res, this.getIndexHtml());
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }

  /**
   * Starts the HTTP server if it is not already running.
   */
  public start() {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.ensureLogFilesExist().catch((error) => {
      console.error("Failed to initialize log files for Web UI:", error);
    });

    this.server.listen(this.port, this.host, () => {
      console.log(
        `Animu Web UI running at http://localhost:${this.port} (bind ${this.host})`
      );
    });
  }
}

export default new WebUI();
