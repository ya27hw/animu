import axios from "axios";
import { aniUserName } from "profile.json";
import { AiringSchedule, AniQuery } from "@utils/index";
import { bearerTokenAnilist, useProxy } from "profile.json";
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
    return await axios(this.api, {
      headers: {
        Authorization: `Bearer ${bearerTokenAnilist}`, // Add the bearer token here
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "post",
      data: {
        query,
        variables,
      },
      proxy: useProxy ? proxy : undefined,
      timeout: 10000,
    });
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
 * Retrieves the airing schedule for a specific anime by its ID.
 * @param {number} page - The page number for pagination.
 * @param {number} id - The ID of the anime.
 * @param {number} [perPage=5] - The number of entries per page, default is 5.
 * @returns {Promise<AiringSchedule | null>} - The airing schedule information, or null if an error occurs.
 */

  public async getAiringSchedule(
    page: number,
    id: number,
    perPage: number = 5
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
      userName: aniUserName,
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
