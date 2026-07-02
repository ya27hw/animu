import axios from "axios";
import { AiringSchedule, AniQuery, MediaRelations, getConfig } from "@utils/index";
import { proxy } from "@utils/models";
class Anilist {
  api: string;
  authLink: string;

  constructor() {
    this.api = "https://graphql.anilist.co";
    this.authLink = "https://anilist.co/api/v2/oauth/token";
  }

  /**
   * Sends a POST req to the Anilist API with the given query and variables
   * @param  {string} query
   * @param  {Object} variables?
   * @returns Promise<any> - The response from the API
   */

  private async getData(query: string, variables?: Object): Promise<any> {
    const configData = getConfig();
    const token = configData.bearerTokenAnilist;
    const useProxyVal = configData.useProxy;

    const baseHeaders: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const headersWithAuth = token
      ? {
          ...baseHeaders,
          Authorization: `Bearer ${token}`,
        }
      : baseHeaders;

    const requestConfig = {
      method: "post" as const,
      data: {
        query,
        variables,
      },
      proxy: useProxyVal ? (proxy as any) : undefined,
      timeout: 10000,
    };

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000];

    let currentHeaders = headersWithAuth;
    let authFallbackTried = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await axios(this.api, {
          headers: currentHeaders,
          ...requestConfig,
        });
      } catch (error: any) {
        const status = error?.response?.status;

        // AniList list queries are public; expired/invalid bearer tokens can fail
        // even when the same query works anonymously.
        if (
          !authFallbackTried &&
          token &&
          (status === 400 || status === 401)
        ) {
          currentHeaders = baseHeaders;
          authFallbackTried = true;
          continue;
        }

        // Retry on proxy/transient errors: 502 (Cloudflare), 404 (proxy miss), 5xx
        const isRetryable =
          status === 502 || status === 404 || (status != null && status >= 500);

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt];
          console.warn(
            `AniList request failed with status ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // After max retries, return null instead of throwing (matches getAiringSchedule pattern)
        if (attempt >= MAX_RETRIES) {
          console.error(
            `AniList request failed after ${MAX_RETRIES} retries:`,
            error,
          );
          return null;
        }

        throw error;
      }
    }

    return null;
  }

  /**
   * Input a custom query with any variables you want to use
   * @param  {string} query
   * @param  {Object} variables?
   * @returns Promise
   */
  public async customQuery(query: string, variables?: Object): Promise<any> {
    const response = await this.getData(query, variables);
    return response.data;
  }

  /**
   * Sets the anime status to rewatching by updating the user's list.
   * This will happen if every episode has been downloaded.
   * @param {number} mediaId - The media ID of the anime to set to rewatch
   * @returns {Promise<boolean>} - Returns true if successful
   */
  public async setAnimeToRewatching(mediaId: number): Promise<boolean> {
    const query = `
    mutation SaveMediaListEntry($mediaId: Int, $status: MediaListStatus) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status) {
            status
          }
      }
    `;

    const variables = {
      mediaId: mediaId,
      status: "REPEATING",
    };

    const response = await this.getData(query, variables);

    if (response.data.data.SaveMediaListEntry.status === "REPEATING") {
      return true;
    } else {
      return false;
    }
  }

  /**
   * Retrieves the airing schedule for a specific anime by its ID.
   * @param {number} page - The page number for pagination.
   * @param {number} id - The ID of the anime.
   * @param {number} [perPage=5] - The number of entries per page, default is 5.
   * @returns {Promise<AiringSchedule | null>} - The airing schedule information, or null if an error occurs.
   */

  public async getAiringSchedule(
    page: number,
    id: number,
    perPage: number = 5,
  ): Promise<AiringSchedule | null> {
    const query = `
        query($id: Int, $page: Int) {
          Media(id: $id) {
            title {
              romaji
              english
              }
            airingSchedule(page: $page, perPage: 25) {
              nodes {
                airingAt
                episode
              }
            }
            }
        }
`;
    const variables = {
      id: id,
      page: page,
    };

    try {
      const response = await this.getData(query, variables);
      const data = response.data.data.Media.airingSchedule;
      return data as AiringSchedule;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  /**
   * Retrieves the previous relations of an anime by its media ID.
   * The function queries the AniList API to fetch the media relations, such as prequels, sequels, etc.
   * @param {number} mediaId - The ID of the anime for which to retrieve relations.
   * @returns {Promise<MediaRelations[] | null>} - An array of media relations if successful, or null if an error occurs.
   */

  public async getPreviousRelations(mediaId: number) {
    var query = `
        query ($id: Int) {
          Media(id: $id) {
            relations {
              edges {
                relationType
                node {
                  id
                  episodes
                  title {
                    romaji
                    english
                  }
                }
              }
            }
          }
        }
    `;

    var variables = {
      id: mediaId,
    };

    try {
      let response = await this.getData(query, variables);
      return response.data.data.Media.relations.edges as MediaRelations[];
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  /**
   * Retrieves the current watching list of the user specified in the profile.json
   * @returns {Promise<any[]>} - The current watching list of the user
   */
  public async getWatchingUserList(): Promise<any[]> {
    const query = `query ($userName :String) {
      MediaListCollection(userName: $userName, type: ANIME, status_in: CURRENT) {
        lists {
          name
          entries {
            progress
            mediaId
            media {
              title {
                romaji
              }
            }
          }
        }
      }
    }`;
    var variables = {
      userName: getConfig().aniUserName,
    };

    // Errors can sometimes happen here, so we need to catch it
    try {
      let response = await this.getData(query, variables);
      response =
        response.data.data.MediaListCollection.lists.length > 0
          ? response.data.data.MediaListCollection.lists[0].entries
          : [];
      return response;
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  /**
   * Returns what the user current WATCHING list is.
   * @returns Promise
   */
  public async getAnimeUserList(): Promise<AniQuery[]> {
    // I love loooong lines
    var query = `query ($userName :String) {
      MediaListCollection(userName: $userName, type: ANIME, status_in: CURRENT) {
        lists {
          name
          entries {
            progress
            mediaId
            media {
              coverImage {
                extraLarge
                large
                medium
                color
              }
              genres
              format
              episodes
              status
              endDate {
                year
                month
                day
              }
              nextAiringEpisode {
                id
                episode
                timeUntilAiring
              }
              synonyms
              title {
                romaji
                english
                native
              }
            }
          }
        }
      }
    }`;

    var variables = {
      userName: getConfig().aniUserName,
    };

    // Errors can sometimes happen here, so we need to catch it
    try {
      let response = await this.getData(query, variables);
      response =
        response.data.data.MediaListCollection.lists.length > 0
          ? response.data.data.MediaListCollection.lists[0].entries
          : [];
      return response as AniQuery[];
    } catch (e) {
      console.error(e);
      return [] as AniQuery[];
    }
  }
}

export default new Anilist();
