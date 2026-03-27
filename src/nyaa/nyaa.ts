/* This retrieves something from nyaa.si rss, does some verification
 and returns it as a json object */

import Parser from "rss-parser";
import "colors";
import {
  AiringSchedule,
  AnimeStatus,
  AniQuery,
  NyaaRSSResult,
  NyaaTorrent,
  Resolution,
  SearchMode,
} from "@utils/index";
import { getEpisodeAirDates, getNumbers, verifyQuery } from "@nyaa/utils";
import {
  resolution,
  useProxy,
  nyaaUrl,
  altNyaaUrl,
  triggerGenre,
} from "profile.json";
import anitomy from "anitomy-js";
import axios from "axios";
import { proxy } from "@utils/models";

class Nyaa {
  private parser: any;
  private enableProxy: boolean;

  constructor() {
    this.parser = new Parser({
      customFields: {
        item: ["nyaa:seeders", "nyaa:size"],
      },
    });
    this.enableProxy = useProxy;
  }

  public shouldUseProxyDownload(anime: AniQuery): boolean {
    return anime.media.genres?.includes(triggerGenre) ?? false;
  }

  private getSearchContext(anime: AniQuery) {
    if (this.shouldUseProxyDownload(anime)) {
      return {
        searchUrl: altNyaaUrl,
        enableProxy: true,
      };
    }

    return {
      searchUrl: nyaaUrl,
      enableProxy: this.enableProxy,
    };
  }

  /**
   * Gets the airing schedule for a given anime and episodes.
   * @param  {number} mediaId - The AniList media ID
   * @param  {number[]} episodeList - List of episode numbers
   * @returns Promise - Contains an array of airing schedule nodes
   */

  /**
   * Finds torrents for the given anime with episode(s)
   * Used in conjuction with getBestTorrent to find the torrent with the highest seeders
   * and which closely resembles the title/episode
   * @param anime The anime object
   * @param startEpisode The starting episode number
   * @param endEpisode The ending episode number
   * @param startingEpisode The offset for the episode numbers
   * @param downloadedEpisodes The episodes that have already been downloaded
   * @returns Torrent(s), each containg metadata of an episode, or null if none are found
   */
  public async getTorrents(
    anime: AniQuery,
    startEpisode: number,
    endEpisode: number,
    startingEpisode: number,
    downloadedEpisodes: number[],
    altAnimeTitle?: string,
  ): Promise<NyaaTorrent[] | null> {
    const { searchUrl, enableProxy } = this.getSearchContext(anime);
    const ignoreAirdateChecks = this.shouldUseProxyDownload(anime);
    const episodeList = getNumbers(
      startEpisode,
      endEpisode,
      downloadedEpisodes,
    );

    const animeTitle = altAnimeTitle ? altAnimeTitle : anime.media.title.romaji;

    console.log(
      `🔍 Searching for ${animeTitle} with ID ${anime.mediaId} episode(s) ${episodeList}`
        .green,
    );

    const airDates = ignoreAirdateChecks
      ? ({ nodes: [] } as AiringSchedule)
      : await getEpisodeAirDates(
          anime.mediaId,
          episodeList,
          startingEpisode,
        );
    if (!airDates) return null;

    let searchMode =
      anime.media.status === AnimeStatus.FINISHED &&
      startEpisode === 0 &&
      downloadedEpisodes.length === 0
        ? SearchMode.BATCH
        : SearchMode.EPISODE;

    if (searchMode === SearchMode.BATCH) {
      const rssResult = await this.fetchRSSFeed(
        animeTitle,
        searchUrl,
        enableProxy,
      );

      if (rssResult.status === 200 && rssResult.data?.length) {
        const bestTorrent = await this.getBestTorrent(
          rssResult.data,
          animeTitle,
          searchMode,
          searchUrl === altNyaaUrl,
          airDates,
          ignoreAirdateChecks,
          startEpisode,
          endEpisode,
        );
        if (bestTorrent) return [bestTorrent];
      }

      searchMode = SearchMode.EPISODE;
    }

    const foundTorrents: NyaaTorrent[] = [];

    for (const episode of episodeList) {
      const formattedEpisode = episode.toString().padStart(2, "0");
      // Get information from Nyaa here.
      const rssResult = await this.fetchRSSFeed(
        // Note the episode is wrapped inside quotes.
        // If the episode in the title has a prefix (Like EP01 or E01)
        // Then nyaa will also include it in the search.
        `${animeTitle} "${formattedEpisode}"`,
        searchUrl,
        enableProxy,
      );

      if (rssResult.status === 200 && rssResult.data?.length) {
        const bestTorrent = await this.getBestTorrent(
          rssResult.data,
          animeTitle,
          searchMode,
          searchUrl === altNyaaUrl,
          airDates,
          ignoreAirdateChecks,
          episode,
        );
        if (bestTorrent) {
          bestTorrent.episode = episode;
          foundTorrents.push(bestTorrent);
        }
      }
    }

    return foundTorrents.length ? foundTorrents : null;
  }

  /**
   * Searches Nyaa RSS for a single episode and returns ranked candidates.
   * This reuses the same verification/ranking logic used by the scheduler.
   * @param anime AniList anime entry
   * @param episode Absolute episode number (including any offset already applied)
   * @param startingEpisode Episode offset used by the scheduler
   * @param altAnimeTitle Optional override title for querying Nyaa
   */
  public async searchEpisodeCandidates(
    anime: AniQuery,
    episode: number,
    startingEpisode: number,
    altAnimeTitle?: string,
  ): Promise<
    Array<
      NyaaTorrent & {
        score: number;
        parsedTitle?: string;
      }
    >
  > {
    const { searchUrl, enableProxy } = this.getSearchContext(anime);
    const ignoreAirdateChecks = this.shouldUseProxyDownload(anime);
    const animeTitle = altAnimeTitle ? altAnimeTitle : anime.media.title.romaji;

    const airDates = ignoreAirdateChecks
      ? ({ nodes: [] } as AiringSchedule)
      : await getEpisodeAirDates(
          anime.mediaId,
          [episode],
          startingEpisode,
        );
    if (!airDates) return [];

    const formattedEpisode = episode.toString().padStart(2, "0");
    const rssResult = await this.fetchRSSFeed(
      `${animeTitle} "${formattedEpisode}"`,
      searchUrl,
      enableProxy,
    );

    if (rssResult.status !== 200 || !rssResult.data?.length) return [];

    const candidates = rssResult.data
      .map((item) => {
        const parsed = anitomy.parseSync(item.title);
        const score = verifyQuery(
          animeTitle,
          parsed,
          searchUrl === altNyaaUrl
            ? Resolution.NONE
            : (resolution as Resolution),
          SearchMode.EPISODE,
          item.pubDate,
          airDates,
          ignoreAirdateChecks,
          episode,
        );
        return {
          ...item,
          episode,
          score,
          parsedTitle: parsed.anime_title,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (
          (parseInt(b["nyaa:seeders"], 10) || 0) -
          (parseInt(a["nyaa:seeders"], 10) || 0)
        );
      });

    return candidates;
  }

  public async searchTitleCandidates(
    anime: AniQuery,
    startingEpisode: number,
    altAnimeTitle?: string,
  ): Promise<
    Array<
      NyaaTorrent & {
        score: number;
        parsedTitle?: string;
      }
    >
  > {
    const { searchUrl, enableProxy } = this.getSearchContext(anime);
    const animeTitle = altAnimeTitle ? altAnimeTitle : anime.media.title.romaji;

    // Dumb title-only search for the Web UI. Keep the richer batch verification
    // logic disabled here so the request simply reflects what Nyaa returns.
    //
    // const endEpisode = anime.media.nextAiringEpisode?.episode
    //   ? anime.media.nextAiringEpisode.episode - 1 + startingEpisode
    //   : (anime.media.episodes ?? 0) + startingEpisode;
    //
    // if (endEpisode <= startingEpisode) return [];
    //
    // const episodeList = getNumbers(startingEpisode, endEpisode, []);
    // const airDates = await getEpisodeAirDates(
    //   anime.mediaId,
    //   episodeList,
    //   startingEpisode,
    // );
    // if (!airDates) return [];

    const rssResult = await this.fetchRSSFeed(
      animeTitle,
      searchUrl,
      enableProxy,
    );

    if (rssResult.status !== 200 || !rssResult.data?.length) return [];

    // const candidates = rssResult.data
    //   .map((item) => {
    //     const parsed = anitomy.parseSync(item.title);
    //     const score = verifyQuery(
    //       animeTitle,
    //       parsed,
    //       searchUrl === altNyaaUrl
    //         ? Resolution.NONE
    //         : (resolution as Resolution),
    //       SearchMode.BATCH,
    //       item.pubDate,
    //       airDates,
    //       startingEpisode,
    //       endEpisode,
    //     );
    //     return {
    //       ...item,
    //       score,
    //       parsedTitle: parsed.anime_title,
    //     };
    //   })
    //   .filter((item) => item.score > 0)
    //   .sort((a, b) => {
    //     if (b.score !== a.score) return b.score - a.score;
    //     return (
    //       (parseInt(b["nyaa:seeders"], 10) || 0) -
    //       (parseInt(a["nyaa:seeders"], 10) || 0)
    //     );
    //   });

    return rssResult.data.map((item) => ({
      ...item,
      score: 0,
      parsedTitle: undefined,
    }));
  }

  private setParams(url: string, query: string): URL {
    const rssLink = new URL(url);

    // Set some filters, and then the search query
    rssLink.searchParams.set("page", "rss");
    rssLink.searchParams.set("q", query);
    if (url === nyaaUrl) rssLink.searchParams.set("c", "1_2");
    else rssLink.searchParams.set("c", "1_1");
    rssLink.searchParams.set("f", "0");
    rssLink.searchParams.set("o", "desc");
    rssLink.searchParams.set("s", "seeders");

    return rssLink;
  }
  private async getResponse(rssLink: URL, enableProxy: boolean) {
    return await axios.get(
      rssLink.href,
      enableProxy
        ? {
            proxy: proxy,
          }
        : {},
    );
  }

  /**
   * Query nyaa for the anime information via RSS.
   * @param {string} searchQuery The query. Can also include the episode number
   * @param {boolean} url The url to fetch the RSS feed from
   * @returns {Promise<AnimeTorrent>} Returns the torrent info if a match is found, otherwise returns null
   */
  private async fetchRSSFeed(
    searchQuery: string,
    url: string,
    enableProxy: boolean,
  ): Promise<NyaaRSSResult> {
    const rssLink = this.setParams(url, searchQuery);

    try {
      const response = await this.getResponse(rssLink, enableProxy);

      if (response.status !== 200) {
        return {
          status: response.status,
          message: `Failed to fetch RSS feed. HTTP status: ${response.status}`,
          data: null,
        };
      }

      const rss = await this.parser.parseString(response.data);
      const items = rss.items;

      if (items.length === 0) {
        return {
          status: 404,
          message: "No items found in the RSS feed.",
          data: null,
        };
      }

      items.sort(
        (a: { [x: string]: string }, b: { [x: string]: string }) =>
          parseInt(b["nyaa:seeders"]) - parseInt(a["nyaa:seeders"]),
      );

      return {
        status: 200,
        message: "RSS feed fetched successfully.",
        data: items as NyaaTorrent[],
      };
    } catch (error) {
      console.error(
        "An error occurred while trying to retrieve the RSS feed from Nyaa:",
        error,
      );
      return {
        status: 500,
        message:
          error instanceof Error ? error.message : "Unknown error occurred.",
        data: null,
      };
    }
  }

  /**
   * Find the best matching torrent given the search query and the items in the RSS feed.
   * Gives priority to torrents with more seeders
   * @param {NyaaTorrent[]} items The items in the RSS feed
   * @param {string} searchQuery The search query
   * @param {SearchMode} searchMode The search mode
   * @param {boolean} useAltUrl Whether the alternative url is used
   * @param {any} episodeRange The episode range
   * @returns {Promise<NyaaTorrent | null>} The best match, or null if no torrent is found
   */
  private async getBestTorrent(
    items: NyaaTorrent[],
    searchQuery: string,
    searchMode: SearchMode,
    useAltUrl: boolean,
    airDates: AiringSchedule,
    ignoreAirdateChecks: boolean,
    ...episodes: number[]
  ): Promise<NyaaTorrent | null> {
    let bestRating = -1;
    let bestTorrent: NyaaTorrent | null = null;

    for (const item of items) {
      if (parseInt(item["nyaa:seeders"]) === 0) continue;

      const title = item.title;
      const nyaaPubDate = item.pubDate;
      const animeParsedData = anitomy.parseSync(title);

      const rating = verifyQuery(
        searchQuery,
        animeParsedData,
        useAltUrl ? Resolution.NONE : (resolution as Resolution),
        searchMode,
        nyaaPubDate,
        airDates,
        ignoreAirdateChecks,
        ...episodes,
      );

      // If a new best rating is found, replace the best rating
      if (rating > bestRating) {
        bestRating = rating;
        bestTorrent = item;
        // The criteria: If the rating is 3.88/4 or higher, then we've found a good enough torrent
        // A perfect 4 isn't always required. Seeders are more important. Placing 4 as a threshold
        if (bestRating >= 3.88) break;
      }
    }

    if (bestRating >= 3.88 && bestTorrent) {
      // If the title and episode are similar, and the resolution is similar, return
      return bestTorrent;
    }

    return null;
  }
}

export default new Nyaa();
