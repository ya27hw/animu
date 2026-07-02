import http, { IncomingMessage, ServerResponse } from "http";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { URL } from "url";
import axios from "axios";
import anilist from "@ani/anilist";
import DB from "@db/db";
import schedule from "@scheduler/schedule";
import Nyaa from "@nyaa/nyaa";
import qbit from "@qbit/qbit";
import { arrayUnion } from "firebase/firestore";
import { getConfig, saveConfig, reloadConfig } from "@utils/index";
const { HttpsProxyAgent } = require("https-proxy-agent");

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

type NyaaTitleSearchPayload = {
  query?: string;
  useAltUrl?: boolean;
  episode?: number | string;
  resolution?: string;
};

type NyaaDownloadPayload = {
  link?: string;
  episode?: number;
  title?: string;
  useAltUrl?: boolean;
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
            entry &&
            entry.media &&
            typeof entry.media.startingEpisode === "number"
              ? entry.media.startingEpisode
              : 0,
        };

        return {
          mediaId: anime.mediaId,
          progress: anime.progress,
          downloadedEpisodes: (entry && entry.downloadedEpisodes) || [],
          media,
        } as AnimeApiItem;
      }),
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
    payload: AnimePatchPayload,
  ): Promise<void> {
    await this.ensureDbReady();

    const updateData: Record<string, any> = {};

    if (typeof payload.alternativeTitle === "string") {
      updateData["media.alternativeTitle"] = payload.alternativeTitle.trim();
    }

    if (typeof payload.startingEpisode === "number") {
      updateData["media.startingEpisode"] = Number.isFinite(
        payload.startingEpisode,
      )
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
  private async getAnimeByMediaId(
    mediaId: number,
  ): Promise<AnimeApiItem | null> {
    const anime = (await this.getAnimeList()).find(
      (x) => x.mediaId === mediaId,
    );
    return anime || null;
  }

  /**
   * Computes the highest episode that has already aired for an anime.
   * Includes configured starting-episode offset.
   * @param anime Anime entry merged from AniList + Firestore.
   */
  private getMaxAiredEpisode(anime: AnimeApiItem): number {
    const offset =
      typeof anime.media?.startingEpisode === "number"
        ? anime.media.startingEpisode
        : 0;

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
      typeof anime.media?.startingEpisode === "number"
        ? anime.media.startingEpisode
        : 0;
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
      altTitle,
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
      typeof anime.media?.startingEpisode === "number"
        ? anime.media.startingEpisode
        : 0;
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
      altTitle,
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

  private async searchNyaaByTitle(payload: NyaaTitleSearchPayload) {
    const query = typeof payload.query === "string" ? payload.query.trim() : "";
    if (!query) {
      throw new Error("Anime name is required");
    }

    let fullQuery = query;
    if (payload.episode !== undefined && payload.episode !== null && payload.episode !== "") {
      const epNum = Number(payload.episode);
      if (!isNaN(epNum)) {
        const epStr = String(epNum).padStart(2, "0");
        fullQuery += ` ${epStr}`;
      } else {
        fullQuery += ` ${payload.episode}`;
      }
    }
    if (payload.resolution) {
      fullQuery += ` ${payload.resolution}`;
    }

    const candidates = await Nyaa.searchRawTitleCandidates(
      fullQuery,
      Boolean(payload.useAltUrl),
    );

    return {
      title: query,
      episode: payload.episode || null,
      useAltUrl: Boolean(payload.useAltUrl),
      count: candidates.length,
      results: candidates.slice(0, 25).map((item) => ({
        title: item.title,
        link: item.link,
        seeders: item["nyaa:seeders"],
        size: item["nyaa:size"],
        pubDate: item.pubDate,
        score: null,
      })),
    };
  }

  /**
   * Sends a selected Nyaa torrent to qBittorrent as a manual request/download.
   * @param mediaId AniList media ID.
   * @param payload Nyaa result link and episode number.
   */
  private async downloadNyaaCandidate(
    mediaId: number,
    payload: NyaaDownloadPayload,
  ) {
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

    // Sync download progress to database and cache
    const downloadedEpisode = episode === undefined ? null : Math.trunc(episode);
    if (downloadedEpisode !== null) {
      await DB.modifyAnimeEntry(mediaId.toString(), {
        downloadedEpisodes: arrayUnion(downloadedEpisode),
      });
      schedule.updateOfflineCache(mediaId, downloadedEpisode);
    }

    return {
      ok: true,
      mediaId,
      episode: downloadedEpisode,
      title: saveTitle,
    };
  }

  private async downloadNyaaTitleCandidate(payload: NyaaDownloadPayload) {
    const link = typeof payload.link === "string" ? payload.link.trim() : "";
    if (!link) throw new Error("Missing torrent link");

    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    if (!title) throw new Error("Anime name is required");

    const ok = await qbit.addCheckTorrent(
      link,
      title,
      undefined,
      Boolean(payload.useAltUrl),
    );
    if (!ok) throw new Error("qBittorrent rejected the torrent request");

    return {
      ok: true,
      title,
      episode: null,
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
      combined: {
        label: "Combined",
        filePath: path.join(logsDir, "animu.log"),
      },
      out: { label: "Stdout", filePath: path.join(logsDir, "animu-out.log") },
      error: {
        label: "Stderr",
        filePath: path.join(logsDir, "animu-error.log"),
      },
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
      combined: [
        "Animu.log",
        "animu.log",
        "Animu-combined.log",
        "animu-combined.log",
      ],
      out: ["Animu-out.log", "animu-out.log"],
      error: [
        "Animu-error.log",
        "animu-error.log",
        "Animu-err.log",
        "animu-err.log",
      ],
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
      }),
    );
  }

  /**
   * Reads a log file and returns the last N lines.
   * @param filePath Absolute log file path.
   * @param maxLines Number of trailing lines to return.
   */
  private async readLogTail(
    filePath: string,
    maxLines: number,
  ): Promise<string> {
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

    const cleanAnsi = (value: string) => {
      const withActualEsc = value.replace(/\\u001b|\\x1b/g, "\u001b");
      return withActualEsc.replace(
        /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
        "",
      );
    };

    const lines = content.split(/\r?\n/);
    const formatted = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";

      try {
        const parsed = JSON.parse(trimmed) as Record<string, any>;
        if (!parsed || typeof parsed !== "object") {
          return cleanAnsi(trimmed);
        }

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

        const tsText = timestamp ? cleanAnsi(String(timestamp)).trim() : "";
        const msgText =
          typeof message === "string"
            ? cleanAnsi(message).trim()
            : cleanAnsi(JSON.stringify(message)).trim();

        if (!tsText && !msgText) return cleanAnsi(trimmed);
        if (!tsText) return msgText;
        if (!msgText) return tsText;
        return `${tsText} ${msgText}`;
      } catch {
        return cleanAnsi(trimmed);
      }
    });

    return formatted.filter(Boolean).join("\n");
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
          userName: getConfig().aniUserName || "",
          count: anime.length,
          anime,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/config") {
        this.sendJson(res, 200, getConfig());
        return;
      }

      if (req.method === "PATCH" && url.pathname === "/api/config") {
        const body = await this.readJsonBody(req);
        const currentConfig = getConfig();
        const updatedConfig = { ...currentConfig, ...body };
        saveConfig(updatedConfig);
        reloadConfig();
        this.dbReady = false;
        qbit.resetSession();
        this.sendJson(res, 200, { ok: true, config: getConfig() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/test-proxy") {
        const body = await this.readJsonBody(req);
        const { proxyAddress, proxyPort, proxyUsername, proxyPassword, proxyAuthType } = body;

        if (!proxyAddress) {
          this.sendJson(res, 400, { ok: false, error: "Proxy address is required." });
          return;
        }

        let authStr = "";
        if (proxyAuthType === "credentials" && (proxyUsername || proxyPassword)) {
          authStr = `${encodeURIComponent(proxyUsername || "")}:${encodeURIComponent(proxyPassword || "")}@`;
        }
        const proxyUrl = `http://${authStr}${proxyAddress}:${Number(proxyPort) || 80}`;
        const agent = new HttpsProxyAgent(proxyUrl);

        try {
          const testRes = await axios.post(
            "https://graphql.anilist.co",
            {
              query: "query { Page { pageInfo { total } } }",
            },
            {
              httpsAgent: agent,
              proxy: false,
              timeout: 5000,
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
            }
          );

          if (testRes.status >= 200 && testRes.status < 400) {
            this.sendJson(res, 200, { ok: true, message: "Proxy connection successful!" });
          } else {
            this.sendJson(res, 200, { ok: false, error: `Proxy returned status ${testRes.status}` });
          }
        } catch (err: any) {
          this.sendJson(res, 200, { ok: false, error: err.message || "Failed to connect via proxy." });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/logs") {
        const logs = await this.getLogsPayload(url);
        this.sendJson(res, 200, logs);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/nyaa-search") {
        const body = (await this.readJsonBody(req)) as NyaaTitleSearchPayload;
        const response = await this.searchNyaaByTitle(body);
        this.sendJson(res, 200, response);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/nyaa-download") {
        const body = (await this.readJsonBody(req)) as NyaaDownloadPayload;
        const response = await this.downloadNyaaTitleCandidate(body);
        this.sendJson(res, 200, response);
        return;
      }

      const nyaaMatch = url.pathname.match(
        /^\/api\/anime\/(\d+)\/nyaa-search$/,
      );
      if (nyaaMatch && req.method === "POST") {
        const body = (await this.readJsonBody(req)) as NyaaSearchPayload;
        const mediaId = Number(nyaaMatch[1]);
        const episode =
          typeof body.episode === "number" ? body.episode : undefined;
        if (
          episode !== undefined &&
          (!Number.isFinite(episode) || episode < 1)
        ) {
          this.sendJson(res, 400, { error: "Invalid episode" });
          return;
        }
        const response =
          episode !== undefined
            ? await this.searchNyaaCandidates(mediaId, Math.trunc(episode))
            : await this.searchNyaaCandidatesByTitle(mediaId);
        this.sendJson(res, 200, response);
        return;
      }

      const nyaaDownloadMatch = url.pathname.match(
        /^\/api\/anime\/(\d+)\/nyaa-download$/,
      );
      if (nyaaDownloadMatch && req.method === "POST") {
        const body = (await this.readJsonBody(req)) as NyaaDownloadPayload;
        const response = await this.downloadNyaaCandidate(
          Number(nyaaDownloadMatch[1]),
          body,
        );
        this.sendJson(res, 200, response);
        return;
      }

      const rewatchingMatch = url.pathname.match(
        /^\/api\/anime\/(\d+)\/rewatching$/,
      );
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

      const resetMatch = url.pathname.match(/^\/api\/anime\/(\d+)\/reset$/);
      if (resetMatch && req.method === "POST") {
        await this.updateAnimeSettings(resetMatch[1], {
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
   * Handles all incoming HTTP requests for static HTML and API routes.
   * @param req Incoming request.
   * @param res Outgoing response.
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );

    if (url.pathname.startsWith("/api/")) {
      await this.routeApi(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    // SPA routing or static files serving
    let filename = url.pathname;
    if (
      filename === "/" ||
      filename === "/index.html" ||
      /^\/anime\/\d+$/.test(filename) ||
      filename === "/settings"
    ) {
      filename = "/index.html";
    }

    const publicDir = path.join(__dirname, "..", "..", "src", "web", "public");
    const fullPath = path.join(publicDir, filename);

    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".ico": "image/x-icon",
          ".png": "image/png",
          ".jpg": "image/jpeg",
        };
        const contentType = mimeTypes[ext] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=0, must-revalidate",
        });
        const content = await fs.readFile(fullPath);
        res.end(content);
        return;
      }
    } catch {
      // Fall through to 404
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
        `Animu Web UI running at http://localhost:${this.port} (bind ${this.host})`,
      );
    });
  }
}

export default new WebUI();
