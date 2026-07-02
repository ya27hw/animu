import { CronJob } from "cron";
import Anilist from "@ani/anilist";
import DB from "@db/db";
import Nyaa from "@nyaa/nyaa";
import qbit from "@qbit/qbit";
import pLimit from "p-limit";
import "colors";
import fs from "fs";
import path from "path";
import {
  alertUser,
  countPastRelations,
  fixAnimeSeason,
  handleWithDelay,
  logNextRunTime,
  sendAnimeDownloadedHook,
} from "@scheduler/utils";
import { NyaaTorrent, AniQuery, OfflineAnime, OfflineDB, getConfig } from "@utils/index";
import { arrayUnion, DocumentData } from "firebase/firestore";

class Scheduler {
  private offlineAnimeDB: OfflineDB;
  private limit: ReturnType<typeof pLimit>;
  private cronJobs: Map<string, CronJob>;
  private cacheFilePath: string;

  constructor() {
    this.limit = pLimit(3);
    this.offlineAnimeDB = {};
    this.cronJobs = new Map();
    this.cacheFilePath = path.join(__dirname, "..", "..", "logs", "offline-cache.json");
    this.loadOfflineCache();
  }

  private loadOfflineCache() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, "utf8");
        const data = JSON.parse(raw);
        for (const mediaId of Object.keys(data)) {
          const animeData = data[mediaId];
          const offlineAnime = new OfflineAnime(animeData.episodes || []);
          offlineAnime.starting_episode = animeData.starting_episode || 0;
          offlineAnime.timeouts = animeData.timeouts || 0;
          offlineAnime.maxTimeouts = animeData.maxTimeouts || 0;
          this.offlineAnimeDB[mediaId] = offlineAnime;
        }
        console.log(`Loaded ${Object.keys(data).length} cached anime entries from offline-cache.json`);
      }
    } catch (err) {
      console.error("Failed to load offline cache:", err);
    }
  }

  private saveOfflineCacheToFile() {
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const serializable: Record<string, any> = {};
      for (const mediaId of Object.keys(this.offlineAnimeDB)) {
        const item = this.offlineAnimeDB[mediaId];
        serializable[mediaId] = {
          episodes: item.episodes,
          starting_episode: item.starting_episode,
          timeouts: item.timeouts,
          maxTimeouts: item.maxTimeouts,
        };
      }

      fs.writeFileSync(this.cacheFilePath, JSON.stringify(serializable, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to save offline cache:", err);
    }
  }

  private shouldRunAt(date: Date): boolean {
    const hour = date.getHours();
    const minute = date.getMinutes();

    const isPeak = (hour >= 12 && hour <= 23) || (hour >= 0 && hour <= 4);
    const isOffPeak = hour >= 5 && hour <= 11;

    if (isPeak) {
      return minute % (getConfig().interval ?? 30) === 0;
    }
    if (isOffPeak) {
      return minute % (getConfig().offpeakInterval ?? 25) === 0;
    }
    return false;
  }

  public updateOfflineCache(mediaId: number, episode: number) {
    if (!this.offlineAnimeDB[mediaId]) {
      this.offlineAnimeDB[mediaId] = new OfflineAnime([]);
    }
    if (!this.offlineAnimeDB[mediaId].episodes.includes(episode)) {
      this.offlineAnimeDB[mediaId].episodes.push(episode);
      this.offlineAnimeDB[mediaId].episodes.sort((a, b) => a - b);
    }
    this.offlineAnimeDB[mediaId].resetTimeout();
    this.saveOfflineCacheToFile();
  }

  /**
   * Runs the scheduler periodically
   * @returns {Promise<void>}
   */
  public async run(): Promise<void> {
    const cronTime = "* * * * *"; // Run check check every minute
    const existingJob = this.cronJobs.get(cronTime);

    if (existingJob) {
      existingJob.stop();
    }

    let isRunning = false; // Lock to prevent overlapping jobs

    const runJob = new CronJob(
      cronTime,

      async () => {
        if (!this.shouldRunAt(new Date())) {
          return;
        }

        if (isRunning) {
          console.log("❌ Previous job still running. Skipping this run.".blue);
          return; // Exit if the previous job is still running
        }

        try {
          isRunning = true; // Lock the job execution
          console.log(
            `>>>Running scheduler at ${new Date().toLocaleString()}<<<`.white
              .bold,
          ); // Log with current time

          await this.check(); // Execute the job
        } catch (error) {
          console.error("Error during cron job execution:", error); // Handle any errors
        } finally {
          isRunning = false; // Release the lock when done
        }
      },
    );
    this.cronJobs.set(cronTime, runJob);
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
    if (mediaId) delete this.offlineAnimeDB[mediaId];
    else this.offlineAnimeDB = {};
    this.saveOfflineCacheToFile();
  }

  /**
   * Downloads the torrents, and updates the database
   * @param  {AniQuery} anime - The anime object
   * @param  {nyaaTorrents[]} ...nyaaTorrents - The anime torrents returned from nyaa.si
   * @returns Promise<number[] | null> - Downloaded episodes, or null if adding torrents failed
   */
  private async downloadTorrents(
    anime: AniQuery,
    ...nyaaTorrents: NyaaTorrent[]
  ): Promise<number[] | null> {
    const downloadedEpisodes = new Array<number>();
    for (const nyaaTorrent of nyaaTorrents) {
      // Download torrent
      const isAdded: boolean = await qbit.addCheckTorrent(
        nyaaTorrent.link,
        anime.media.title.romaji,
        nyaaTorrent.episode,
        anime.media.genres?.includes(getConfig().triggerGenre ?? "Ecchi"),
      );
      if (!isAdded) {
        this.offlineAnimeDB[anime.mediaId].setTimeout();
        this.saveOfflineCacheToFile();
        alertUser(anime.media.title.romaji, anime.media.coverImage.extraLarge);

        return null;
      }

      // If we successfully added the torrent, then add it to the database later

      if (nyaaTorrent.episode) downloadedEpisodes.push(nyaaTorrent.episode);
      else
        downloadedEpisodes.push(
          ...Array.from({ length: anime.media.episodes }, (_, i) => i + 1),
        );

      console.log(
        `⬇️  Downloading ${nyaaTorrent.title} ${
          nyaaTorrent.episode ? nyaaTorrent.episode : ""
        } at ${nyaaTorrent.link}`.green.bold,
      );
    }

    // Append to offlineDB, and remove the timeout
    this.offlineAnimeDB[anime.mediaId].episodes = downloadedEpisodes;
    this.offlineAnimeDB[anime.mediaId].resetTimeout();
    this.saveOfflineCacheToFile();

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
      { name: "Title", value: nyaaTorrents[0].title },
    );

    // Update firestore
    await DB.modifyAnimeEntry(anime.mediaId.toString(), {
      "media.nextAiringEpisode": anime.media.nextAiringEpisode,
      "media.status": anime.media.status,
      downloadedEpisodes: arrayUnion(...downloadedEpisodes),
    });

    return downloadedEpisodes;
  }

/**
 * Checks if an anime should be set to rewatching status.
 * @param {AniQuery} anime - The anime object
 * @param {number[]} downloadedEpisodes - The downloaded episodes
 * @returns {boolean} - True if the anime should be set to rewatching status
 */
  private shouldSetAnimeToRewatching(
    anime: AniQuery,
    downloadedEpisodes: number[],
  ): boolean {
    const downloadedCount = new Set(downloadedEpisodes).size;

    return (
      !!getConfig().setCompletedToRewatching &&
      anime.media.status === "FINISHED" &&
      anime.media.episodes > 0 &&
      downloadedCount >= anime.media.episodes
    );
  }

  private async syncAnimeRewatchingStatus(
    anime: AniQuery,
    downloadedEpisodes: number[],
  ): Promise<void> {
    if (!this.shouldSetAnimeToRewatching(anime, downloadedEpisodes)) {
      return;
    }

    await DB.modifyAnimeEntry(anime.mediaId.toString(), {
      pendingRewatchingUpdate: true,
    });

    console.log(
      `Downloaded all episodes for ${anime.media.title.romaji}. Setting to rewatching...`,
    );

    try {
      const isUpdated = await Anilist.setAnimeToRewatching(anime.mediaId);

      if (!isUpdated) {
        console.error(
          `Failed to set ${anime.media.title.romaji} to rewatching on AniList.`,
        );
        return;
      }

      await DB.modifyAnimeEntry(anime.mediaId.toString(), {
        pendingRewatchingUpdate: false,
      });
    } catch (error) {
      console.error(
        `Failed to set ${anime.media.title.romaji} to rewatching on AniList:`,
        error,
      );
    }
  }
  /**
   * Handles an anime series, decides which episodes to download,
   * or actions to take.
   * @param  {AniQuery} anime - Anime object taken from userlist
   * @returns Promise
   */
  private async handleAnime(
    anime: AniQuery,
    preloadedDbEntry?: DocumentData,
  ): Promise<void> {
    let fireDBAnime: DocumentData;

    try {
      const fireDBEntry =
        preloadedDbEntry || (await DB.getByMediaId(`${anime.mediaId}`));

      // Create FireDB entry if it doesn't exist
      if (!fireDBEntry) {
        await DB.addToDb(anime);
        fireDBAnime = anime as DocumentData;
      } else fireDBAnime = fireDBEntry;
    } catch (error) {
      console.error(error);
      return;
    }

    if (!fireDBAnime) return; // Guard against null fireDBAnime (in case of error)

    if (fireDBAnime.pendingRewatchingUpdate === undefined) {
      fireDBAnime.pendingRewatchingUpdate = false;
      await DB.modifyAnimeEntry(anime.mediaId.toString(), {
        pendingRewatchingUpdate: false,
      });
    }

    // Ensure offline DB entry exists before mutating
    if (!this.offlineAnimeDB[anime.mediaId]) {
      this.offlineAnimeDB[anime.mediaId] = new OfflineAnime([]);
    }

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
      : (anime.media.episodes ?? 0) + startingEpisode;

    // Guard invalid or empty windows
    if (endEpisode <= startEpisode) {
      return;
    }

    // firestore (fs) downloaded episodes.
    const downloadedEpisodes: any[] = fireDBAnime.downloadedEpisodes || [];

    // Make array of anime.progress until endEpisode
    const animeProgress: number[] = Array.from(
      { length: endEpisode - startEpisode },
      (_, i) => i + startEpisode + 1,
    );

    /* If progress is up to date, then skip
    Or if the user has downloaded all episodes, then skip */
    const isUpToDate = animeProgress.every((episode) =>
      downloadedEpisodes.includes(episode),
    );

    if (isUpToDate) {
      // If the user is up to date, then we can skip, and update the offlineDB
      this.offlineAnimeDB[anime.mediaId].episodes = downloadedEpisodes.sort(
        (a, b) => a - b,
      );

      if (fireDBAnime.pendingRewatchingUpdate === true) {
        await this.syncAnimeRewatchingStatus(anime, downloadedEpisodes);
      }

      return;
    }

    // // If user has downloaded all episodes, and anime has finished airing, move anime to REWATCHING on anilist
    // if (downloadedEpisodes.length === endEpisode) {
    //   await Anilist.setAnimeToRewatching(anime.mediaId);
    // }

    // Attempt to find the anime.
    let primaryTorrent = await Nyaa.getTorrents(
      anime,
      startEpisode,
      endEpisode,
      startingEpisode,
      downloadedEpisodes,
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

      let possibleCombinations = [];

      possibleCombinations.push({
        title: ex3.title,
        episodeOffset: 0,
      });

      if (anime.media.title.english) {
        possibleCombinations.push({
          title: anime.media.title.english,
          episodeOffset: 0,
        });
      }
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
          },
        );
      }

      // Loop over synonyms, could be possible nyaa hits.
      if (anime.media.synonyms)
        anime.media.synonyms.forEach((synonym) => {
          if (synonym.toLowerCase() !== anime.media.title.romaji.toLowerCase())
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

      // Remove duplicates
      possibleCombinations = possibleCombinations.filter(
        (value, index, self) =>
          index ===
          self.findIndex(
            (t) =>
              t.title.toLowerCase() === value.title.toLowerCase() &&
              t.episodeOffset === value.episodeOffset,
          ),
      );

      console.log(
        `Attempting combinations of ${
          anime.media.title.romaji
        } -> ${possibleCombinations.map(
          (c) => `${c.title} : ${c.episodeOffset}`,
        )}`.green,
      );

      // Bounded concurrency search across combinations and pick the highest seeder result
      const comboLimit = pLimit(2);
      const comboTasks = possibleCombinations.map((combo) =>
        comboLimit(async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const result = await Nyaa.getTorrents(
            anime,
            startEpisode + combo.episodeOffset,
            endEpisode + combo.episodeOffset,
            startingEpisode + combo.episodeOffset,
            downloadedEpisodes,
            combo.title,
          );
          const seederCount = (result || []).reduce(
            (acc, t) => acc + (parseInt(t["nyaa:seeders"], 10) || 0),
            0,
          );
          return { combo, result, seederCount };
        }),
      );

      const results = await Promise.all(comboTasks);
      const best = results.reduce<{
        comboIndex: number;
        seederCount: number;
        result: NyaaTorrent[] | null;
      }>(
        (acc, curr, idx) => {
          if (curr.seederCount > acc.seederCount) {
            return {
              comboIndex: idx,
              seederCount: curr.seederCount,
              result: curr.result as any,
            };
          }
          return acc;
        },
        {
          comboIndex: -1,
          seederCount: primarySeedCount,
          result: primaryTorrent as any,
        },
      );

      if (best.comboIndex !== -1 && best.seederCount > primarySeedCount) {
        primaryTorrent = results[best.comboIndex].result || primaryTorrent;
        winningComboIndex = best.comboIndex;
        primarySeedCount = best.seederCount;
      }
      // Modify the DB if the app found a title that yielded more seeders
      if (winningComboIndex !== -1) {
        const winningCombo = possibleCombinations[winningComboIndex];
        anime.media.title.romaji = winningCombo.title;

        await DB.modifyAnimeEntry(anime.mediaId.toString(), {
          "media.alternativeTitle": winningCombo.title,
          "media.startingEpisode": winningCombo.episodeOffset,
        });
      }
    }

    if (primaryTorrent) {
      const newlyDownloadedEpisodes = await this.downloadTorrents(
        anime,
        ...primaryTorrent,
      );

      if (!newlyDownloadedEpisodes) {
        return;
      }

      const allDownloadedEpisodes = Array.from(
        new Set([...downloadedEpisodes, ...newlyDownloadedEpisodes]),
      );

      await this.syncAnimeRewatchingStatus(anime, allDownloadedEpisodes);

      return;
    } // Finish the function if successful
    else {
      this.offlineAnimeDB[anime.mediaId].setTimeout();
      this.saveOfflineCacheToFile();

      logNextRunTime(
        anime.media.title.romaji,
        this.offlineAnimeDB[anime.mediaId].timeouts,
      );
    }
  }

  /**
   * Main function. If there is a new anime, or new episode, then this function will execute.
   * This also uses the offlineAnimeDB to check if the user is up to date.
   */
  public async check() {
    const animeList: AniQuery[] = await Anilist.getAnimeUserList();

    // Return if empty list.
    if (animeList.length === 0) return;

    // Fetch all Firestore entries in one call!
    const fireDbEntriesList = await DB.getFromDb();
    const fireDbMap = new Map<string, any>();
    if (fireDbEntriesList) {
      for (const entry of fireDbEntriesList) {
        if (entry.mediaId) {
          fireDbMap.set(entry.mediaId.toString(), entry);
        }
      }
    }

    // List of tasks. Each task holds the anime and its Firestore entry if available
    const promises: Array<{ anime: AniQuery; fireDBAnime: any }> = [];

    for (const anime of animeList) {
      const fireDBAnime = fireDbMap.get(anime.mediaId.toString());

      // Populate offlineDB if anime is not present.
      if (!this.offlineAnimeDB.hasOwnProperty(anime.mediaId)) {
        this.offlineAnimeDB[anime.mediaId] = new OfflineAnime([]);
        this.saveOfflineCacheToFile();
        promises.push({ anime, fireDBAnime });
      } else {
        const offlineAnime = this.offlineAnimeDB[anime.mediaId];

        if (!!offlineAnime.timeouts) {
          // Log how many minutes left until the next run
          console.log(
            `\u2139\uFE0F Next run for ${anime.media.title.romaji} in ${
              offlineAnime.timeouts * (getConfig().interval ?? 30)
            } minutes`.blue,
          );
          this.offlineAnimeDB[anime.mediaId].timeouts = --offlineAnime.timeouts;
          this.saveOfflineCacheToFile();

          continue;
        }

        const episodesOffline = offlineAnime.episodes;
        const airingEpisodes = anime.media.nextAiringEpisode
          ? anime.media.nextAiringEpisode.episode - 1
          : anime.media.episodes;

        // If no aired episodes, return.
        if (airingEpisodes === 0) continue;

        // Begin search for new episode if any expected episode is missing from downloaded episodes
        const startEpisode = anime.progress + offlineAnime.starting_episode;
        const endEpisode = airingEpisodes + offlineAnime.starting_episode;
        let hasMissing = false;
        for (let ep = startEpisode + 1; ep <= endEpisode; ep++) {
          if (!episodesOffline.includes(ep)) {
            hasMissing = true;
            break;
          }
        }
        if (hasMissing) promises.push({ anime, fireDBAnime });
      }
    }

    const tasks = promises.map(({ anime, fireDBAnime }) =>
      this.limit(() => handleWithDelay.call(this, anime, fireDBAnime)),
    );

    await Promise.all(tasks);
  }
}

export default new Scheduler();
