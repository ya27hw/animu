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
  constructor() {
    this.parser = new Parser({
      customFields: {
        item: ["nyaa:seeders", "nyaa:size"],
      },
    });
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
    downloadedEpisodes: number[]
  ): Promise<NyaaTorrent[] | null> {
    let searchUrl = nyaaUrl;
    const episodeList = getNumbers(
      startEpisode,
      endEpisode,
      downloadedEpisodes
    );

    console.log(
      `🔍 Searching for ${anime.media.title.romaji} with ID ${anime.mediaId} episode(s) ${episodeList}`
        .green
    );

    const airDates = await getEpisodeAirDates(
      anime.mediaId,
      episodeList,
      startingEpisode
    );
    if (!airDates) return null;

    if (anime.media.genres?.includes(triggerGenre)) {
      searchUrl = altNyaaUrl;
    }

    let searchMode =
      anime.media.status === AnimeStatus.FINISHED &&
      startEpisode === 0 &&
      downloadedEpisodes.length === 0
        ? SearchMode.BATCH
        : SearchMode.EPISODE;

    if (searchMode === SearchMode.BATCH) {
      const rssResult = await this.fetchRSSFeed(
        anime.media.title.romaji,
        searchUrl
      );

      if (rssResult.status === 200 && rssResult.data?.length) {
        const bestTorrent = await this.getBestTorrent(
          rssResult.data,
          anime.media.title.romaji,
          searchMode,
          searchUrl === altNyaaUrl,
          airDates,
          startEpisode,
          endEpisode
        );
        if (bestTorrent) return [bestTorrent];
      }

      searchMode = SearchMode.EPISODE;
    }

    const foundTorrents: NyaaTorrent[] = [];

    for (const episode of episodeList) {
      const formattedEpisode = episode.toString().padStart(2, "0");
      const rssResult = await this.fetchRSSFeed(
        `${anime.media.title.romaji} "${formattedEpisode}"`,
        searchUrl
      );

      if (rssResult.status === 200 && rssResult.data?.length) {
        const bestTorrent = await this.getBestTorrent(
          rssResult.data,
          anime.media.title.romaji,
          searchMode,
          searchUrl === altNyaaUrl,
          airDates,
          episode
        );
        if (bestTorrent) {
          bestTorrent.episode = episode;
          foundTorrents.push(bestTorrent);
        }
      }
    }

    return foundTorrents.length ? foundTorrents : null;
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
  private async getResponse(rssLink: URL) {
    return await axios.get(
      rssLink.href,
      useProxy
        ? {
            proxy: proxy,
          }
        : {}
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
    url: string
  ): Promise<NyaaRSSResult> {
    const rssLink = this.setParams(url, searchQuery);

    try {
      const response = await this.getResponse(rssLink);

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
          parseInt(b["nyaa:seeders"]) - parseInt(a["nyaa:seeders"])
      );

      return {
        status: 200,
        message: "RSS feed fetched successfully.",
        data: items as NyaaTorrent[],
      };
    } catch (error) {
      console.error(
        "An error occurred while trying to retrieve the RSS feed from Nyaa:",
        error
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
        ...episodes
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
