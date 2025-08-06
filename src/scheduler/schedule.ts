import { CronJob } from "cron";
import Anilist from "@ani/anilist";
import DB from "@db/db";
import Nyaa from "@nyaa/nyaa";
import qbit from "@qbit/qbit";
import pLimit from "p-limit";
import "colors";
import {
  alertUser,
  countPastRelations,
  fixAnimeSeason,
  handleWithDelay,
  logNextRunTime,
  sendAnimeDownloadedHook,
} from "@scheduler/utils";
import { NyaaTorrent, AniQuery, OfflineAnime, OfflineDB } from "@utils/index";
import { interval } from "profile.json";
import { arrayUnion, DocumentData } from "firebase/firestore";
import { on } from "events";

class Scheduler {
  private offlineAnimeDB: OfflineDB;
  private limit;

  constructor() {
    this.offlineAnimeDB = {};
    this.limit = pLimit(5);
  }

  /**
   * Runs the scheduler periodically every x minutes
   * @param  {string} cronTime - Cron time
   * @returns {Promise<void>}
   */
  public async run(cronTime: string): Promise<void> {
    let isRunning = false; // Lock to prevent overlapping jobs

    const runJob = new CronJob(
      cronTime,

      async () => {
        if (isRunning) {
          console.log("❌ Previous job still running. Skipping this run.".blue);
          return; // Exit if the previous job is still running
        }

        try {
          isRunning = true; // Lock the job execution
          console.log(
            `>>>Running scheduler at ${new Date().toLocaleString()}<<<`.white
              .bold
          ); // Log with current time

          await this.check(); // Execute the job
        } catch (error) {
          console.error("Error during cron job execution:", error); // Handle any errors
        } finally {
          isRunning = false; // Release the lock when done
        }
      }
    );
    runJob.start();
  }

  /**
   * Clears the offlineDB
   * @param  {string} mediaId? - If specified, only clears that anime
   * @returns void
   */
  public runClearOfflineDB(cronTime: string, mediaId?: string): void {
    const clearJob = new CronJob(cronTime, () => {
      this.clearOfflineDB();
    });
    clearJob.start();
  }

  public clearOfflineDB(mediaId?: string) {
    if (mediaId) this.offlineAnimeDB[mediaId] = new OfflineAnime([]);
    else this.offlineAnimeDB = {};
  }

  /**
   * Downloads the torrents, and updates the database
   * @param  {AniQuery} anime - The anime object
   * @param  {nyaaTorrents[]} ...nyaaTorrents - The anime torrents returned from nyaa.si
   * @returns Promise<void>
   */
  private async downloadTorrents(
    anime: AniQuery,
    ...nyaaTorrents: NyaaTorrent[]
  ): Promise<void> {
    const downloadedEpisodes = new Array<number>();
    for (const nyaaTorrent of nyaaTorrents) {
      // Download torrent
      const isAdded: boolean = await qbit.addCheckTorrent(
        nyaaTorrent.link,
        anime.media.title.romaji,
        nyaaTorrent.episode
      );
      if (!isAdded) {
        const isMaxed = this.offlineAnimeDB[anime.mediaId].setTimeout();
        alertUser(anime.media.title.romaji, anime.media.coverImage.extraLarge);

        return;
      }

      // If we successfully added the torrent, then add it to the database later

      if (nyaaTorrent.episode) downloadedEpisodes.push(nyaaTorrent.episode);
      else
        downloadedEpisodes.push(
          ...Array.from({ length: anime.media.episodes }, (_, i) => i + 1)
        );

      console.log(
        `⬇️  Downloading ${nyaaTorrent.title} ${
          nyaaTorrent.episode ? nyaaTorrent.episode : ""
        } at ${nyaaTorrent.link}`.green.bold
      );
      // Wait for 2 seconds
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Append to offlineDB, and remove the timeout
    this.offlineAnimeDB[anime.mediaId].episodes = downloadedEpisodes;
    this.offlineAnimeDB[anime.mediaId].resetTimeout();

    const color = anime.media.coverImage.color
      ? Number(anime.media.coverImage.color.replace("#", "0x"))
      : 0x0997e3;

    await sendAnimeDownloadedHook(
      `**${anime.media.title.romaji}** is downloading!`, // Title
      color, // Color
      anime.media.coverImage.extraLarge, // Image
      { name: "Title ID", value: anime.mediaId.toString() },
      { name: "Episode(s)", value: downloadedEpisodes.join(", ") },
      {
        name: "Size",
        value: nyaaTorrents.map((t) => t["nyaa:size"]).join(", "),
      },
      {
        name: "Seeders",
        value: nyaaTorrents.map((t) => t["nyaa:seeders"]).join(", "),
      },
      { name: "Title", value: nyaaTorrents[0].title }
    );

    // Update firestore
    await DB.modifyAnimeEntry(anime.mediaId.toString(), {
      "media.nextAiringEpisode": anime.media.nextAiringEpisode,
      "media.status": anime.media.status,
      downloadedEpisodes: arrayUnion(...downloadedEpisodes),
    });
  }
  /**
   * Handles an anime series, decides which episodes to download,
   * or actions to take.
   * @param  {AniQuery} anime - Anime object taken from userlist
   * @returns Promise
   */
  private async handleAnime(anime: AniQuery): Promise<void> {
    let fireDBAnime: DocumentData;

    try {
      const fireDBEntry = await DB.getByMediaId(`${anime.mediaId}`);

      if (!fireDBEntry) {
        DB.addToDb(anime);
        fireDBAnime = anime as DocumentData;
      } else fireDBAnime = fireDBEntry;
    } catch (error) {
      console.error(error);
      return;
    }

    if (!fireDBAnime) return; // Guard against null fireDBAnime (in case of error)

    /* This is manually defined in the db by the user.
    Some animes usually have a 2nd season, but instead of starting from episode 1, they start from
    where they left off in season 1., e.g episode 13 
    Apparently, there is a workaround for this... */
    const startingEpisode = fireDBAnime.media.startingEpisode
      ? fireDBAnime.media.startingEpisode
      : 0;

    // Stupid, lazy implementation TODO remove
    this.offlineAnimeDB[anime.mediaId].starting_episode = startingEpisode;

    /* Sometimes the title found in nyaa.si is different.
    Therefore, we manually define an alt title if applicable. */
    anime.media.title.romaji =
      fireDBAnime.media.alternativeTitle ?? anime.media.title.romaji;

    const startEpisode = anime.progress + startingEpisode; // Users progress

    // NextAiringEpisode can be null if the anime is finished. So check for that
    const endEpisode = anime.media.nextAiringEpisode
      ? anime.media.nextAiringEpisode.episode - 1 + startingEpisode
      : anime.media.episodes + startingEpisode;

    // firestore (fs) downloaded episodes.
    const downloadedEpisodes: any[] = fireDBAnime.downloadedEpisodes || [];

    // Make array of anime.progress until endEpisode
    const animeProgress: number[] = Array.from(
      { length: endEpisode - startEpisode },
      (_, i) => i + startEpisode + 1
    );

    /* If progress is up to date, then skip
    Or if the user has downloaded all episodes, then skip */
    const isUpToDate = animeProgress.every((episode) =>
      downloadedEpisodes.includes(episode)
    );

    if (isUpToDate) {
      // If the user is up to date, then we can skip, and update the offlineDB
      this.offlineAnimeDB[anime.mediaId].episodes = downloadedEpisodes.sort(
        (a, b) => a - b
      );

      return;
    }

    // Attempt to find the anime.
    let primaryTorrent = await Nyaa.getTorrents(
      anime,
      startEpisode,
      endEpisode,
      startingEpisode,
      downloadedEpisodes
    );

    // Count total number of seeders
    let primarySeedCount: number = primaryTorrent
      ? primaryTorrent.reduce((acc, t) => acc + parseInt(t["nyaa:seeders"]), 0)
      : 0;

    // For new entries, sometimes you need to use a different title. Anilist
    // has some alternative titles we can use.

    /* IMPORTANT: Handle animes that have 'Season 2 | 2nd Season | Part X | Cour X|'...
             These can sometimes be simplified to just 'S2' etc... 
             But that's not always the case, soemtimes we need to look through
             past relations, as sometimes season number is not explicitly mentioned.
             Examples from Summer '25 Season include:
                Kaijuu 8-gou 2nd Season EP1 --> Kaijuu 8-gou EP13 (Kaijuu 8-gou S02E01 also gets a pass)
                Dr. STONE: SCIENCE FUTURE Part 2 EP1 --> Dr. Stone S4 - 13 (past relations here need to be visited)
                Kakkou no Iinazuke Season 2 --> Kakkou no Iinazuke S2 - 01 (Nyaa naming schema is inconsistent)
             Animes with 'Part 2' or 'Cour 2' oftern continue from the previous 
             season, with the episode number starting from where it left off. 
             For now, we need to brute-force this by checking if we can find a title that works.
             This is a bit of a hack, but it *should* work for now.
    */
    if (
      !fireDBAnime.media.alternativeTitle &&
      downloadedEpisodes.length === 0
    ) {
      const ex3 = fixAnimeSeason(anime.media.title.romaji);
      const ex2 = await countPastRelations(anime.mediaId);

      let possibleCombinations = [
        // First example
        {
          title: ex3.title,
          episodeOffset: ex2.episodeOffset,
        },
        // If the title is in English
        {
          title: anime.media.title.english,
          episodeOffset: 0,
        },
      ];

      // This is not required if the anime airing has just a season.
      if (ex2.seasonCount > 1) {
        possibleCombinations.push(
          // Second example
          {
            title: `${ex3.title} S${ex2.seasonCount}`,
            episodeOffset: ex2.episodeOffset,
          },
          // Third example
          {
            title: `${ex3.title} S${ex2.seasonCount}`,
            episodeOffset: 0,
          }
        );
      }

      // Loop over synonyms, could be possible nyaa hits.
      anime.media.synonyms.map((synonym) => {
        possibleCombinations.push({
          title: synonym,
          episodeOffset: 0,
        });
      });

      // Get short name by seperating romaji title by colon. Often useful as animes tend to have long names
      const shortName = anime.media.title.romaji.split(":")[0];
      if (shortName !== anime.media.title.romaji)
        possibleCombinations.unshift({
          title: shortName,
          episodeOffset: 0,
        });

      let winningComboIndex = -1;
      // Loop over EVERY possible combination. Find the one with the highest seed count
      for (const combo of possibleCombinations) {
        anime.media.title.romaji = combo.title;
        const result = await Nyaa.getTorrents(
          anime,
          startEpisode + combo.episodeOffset,
          endEpisode + combo.episodeOffset,
          startingEpisode + combo.episodeOffset,
          downloadedEpisodes
        );

        if (result) {
          const seederCount = result.reduce(
            (acc, t) => acc + parseInt(t["nyaa:seeders"]),
            0
          );

          // Compare it to the seed count of the primary search
          if (seederCount > primarySeedCount) {
            primaryTorrent = result;
            winningComboIndex = possibleCombinations.indexOf(combo);
            primarySeedCount = seederCount;
          }
        }
      }
      // Modify the DB if the app found a title that yielded more seeders
      if (winningComboIndex !== -1) {
        const winningCombo = possibleCombinations[winningComboIndex];

        DB.modifyAnimeEntry(anime.mediaId.toString(), {
          "media.alternativeTitle": winningCombo.title,
          "media.startingEpisode": winningCombo.episodeOffset,
        });
      }
    }

    if (primaryTorrent) {
      await this.downloadTorrents(anime, ...primaryTorrent);
      return;
    } // Finish the function if successful
    else {
      this.offlineAnimeDB[anime.mediaId].setTimeout();

      logNextRunTime(
        anime.media.title.romaji,
        this.offlineAnimeDB[anime.mediaId].timeouts
      );
    }
  }

  /**
   * Main function. If there is a new anime, or new episode, then this function will execute.
   * This also uses the offlineAnimeDB to check if the user is up to date.
   */
  public async check() {
    const animeList: AniQuery[] = await Anilist.getAnimeUserList();

    if (animeList.length === 0) return;

    const promises: AniQuery[] = [];

    for (const anime of animeList) {
      if (!this.offlineAnimeDB.hasOwnProperty(anime.mediaId)) {
        this.offlineAnimeDB[anime.mediaId] = new OfflineAnime([]);
        promises.push(anime);
      } else {
        const offlineAnime = this.offlineAnimeDB[anime.mediaId];

        if (!!offlineAnime.timeouts) {
          // Log how many minutes left until the next run
          console.log(
            `\u2139\uFE0F Next run for ${anime.media.title.romaji} in ${
              offlineAnime.timeouts * interval
            } minutes`.blue
          );
          this.offlineAnimeDB[anime.mediaId].timeouts = --offlineAnime.timeouts;

          continue;
        }

        const episodesOffline = offlineAnime.episodes;
        const airingEpisodes = anime.media.nextAiringEpisode
          ? anime.media.nextAiringEpisode.episode - 1
          : anime.media.episodes;

        if (airingEpisodes === 0) {
          continue;
        }

        if (
          episodesOffline[episodesOffline.length - 1] !==
          airingEpisodes + offlineAnime.starting_episode
        ) {
          promises.push(anime);
        }
      }
    }

    const tasks = promises.map((anime) =>
      this.limit(() => handleWithDelay.call(this, anime))
    );

    await Promise.all(tasks);
  }
}

export default new Scheduler();
