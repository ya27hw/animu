import { MessageBuilder, Webhook } from "discord-webhook-node";
import { getConfig } from "@utils/index";

function getWebhook(): Webhook {
  return new Webhook(getConfig().webhook || "https://discord.com/api/webhooks/mock");
}
import { CronTime } from "cron";
import { DateTime } from "luxon";
import { RUNTIMES } from "@utils/constants";
import anilist from "@ani/anilist";
import { MediaRelation } from "@utils/enums";

async function alertUser(anime: string, image: string) {
  const msg: MessageBuilder = new MessageBuilder()
    .setTitle("Anime Not Added")
    .setColor(0xff0000)
    .setDescription(`Animu could not add ${anime} to qBittorrent.`)
    .setImage(image);
  try {
    await getWebhook().send(msg);
  } catch (err) {
    console.error("Discord webhook send failed (alertUser):", err);
  }
}

function logNextRunTime(animeTitle: string, timeouts: number) {
  // Cache CronTime objects outside the loop for efficiency
  const offpeakCron = new CronTime(RUNTIMES.offPeak);
  const peakCron = new CronTime(RUNTIMES.peak);

  let date = DateTime.now();
  let totalMinutes = 0;

  // Precompute off-peak hours for quick comparison
  const isOffPeak = (hour: number) => hour >= 5 && hour <= 11;

  // Use a single variable for nextRunDate to avoid repeated declarations
  let nextRunDate: DateTime;

  // Unroll the loop for 0 timeouts (common case)
  if (timeouts === 0) {
    nextRunDate = isOffPeak(date.hour)
      ? offpeakCron.getNextDateFrom(date)
      : peakCron.getNextDateFrom(date);
    totalMinutes = Math.ceil(nextRunDate.diff(date, "minutes").minutes);
    date = nextRunDate;
  } else {
    for (let i = 0; i <= timeouts; i++) {
      nextRunDate = isOffPeak(date.hour)
        ? offpeakCron.getNextDateFrom(date)
        : peakCron.getNextDateFrom(date);
      totalMinutes += nextRunDate.diff(date, "minutes").minutes;
      date = nextRunDate;
    }
    totalMinutes = Math.ceil(totalMinutes);
  }

  // Use template literals efficiently and avoid unnecessary computation
  console.log(
    `❌ Failed to find ${animeTitle}. Next run in ${totalMinutes} minutes. (At ${date.toFormat(
      "HH:mm a"
    )})`.red
  );
}

async function sendAnimeDownloadedHook(
  title: string,
  color: number,
  image: string,
  ...fields: Record<string, string>[]
) {
  const msg: MessageBuilder = new MessageBuilder()
    .setTimestamp()
    .setTitle(title)
    .setColor(color)
    .setImage(image);

  for (const field of fields) {
    msg.addField(field.name, field.value, true);
  }

  try {
    await getWebhook().send(msg);
  } catch (err) {
    console.error("Discord webhook send failed (sendAnimeDownloadedHook):", err);
  }
}

/**
 * Displays the the range of an array
 * @param  {any[]} array
 * @returns {string} - Range of array
 */
function joinArr(array: any[]) {
  if (array.length === 1) {
    return array[0];
  }
  return `${array[0]} - ${array[array.length - 1]}`;
}
/**
 * @param  {string[]} ...animeEntry
 */
function fixAnimeSeason(animeEntry: string) {
  /* Try to infer the season from the anime title
     
   *  Example:
   * - Case 1 : Boku no Hero Academia             --> Season 1 (leave alone)
   * - Case 2 : Boku no Hero Academia 3           --> Season 3 (This case is deemed too difficult to identify)
   * - Case 3 : Boku no Hero Academia S2          --> Season 2
   * - Case 4 : Boku no Hero Academia Season 5    --> Season 5
   * - Case 5 : Boku no Hero Academia Season IV   --> Season 4 (optional case)
   * - Case 6 : Boku no Hero Academia 7th Season  --> Season 7
   */

  const romanRegex = /\b(?:season\s*)?(II|III|IV)\b/i
  const romanMatch = animeEntry.match(romanRegex);
  if (romanMatch) {
    const roman = romanMatch[0].toUpperCase();
    const romanToSeason: Record<string, number> = { II: 2, III: 3, IV: 4 };

    return {
      title: animeEntry.replace(romanRegex, "").trim(),
      seasonCount: romanToSeason[roman],
    };
  }

  const seasonRegex =
    /s0?\d{1}|season(.*)0?\d{1}|(\d+(st|nd|rd|th)(.*)season)|[^a-zA-Z0-9]0?\d{1}$/i;
  const seasonString = animeEntry.match(seasonRegex);
  // If found, extract the season number
  if (seasonString) {
    const regSeasonNumber = seasonString[0].match(/\d+/);
    const seasonNumber = regSeasonNumber ? parseInt(regSeasonNumber[0]) : 0;

    // return as number
    return {
      title: animeEntry.replace(seasonRegex, "").trim(),
      seasonCount: seasonNumber,
    };
  }

  return {
    title: animeEntry,
    seasonCount: 1,
  };
}

async function countPastRelations(
  mediaId: number,
  episodeOffset = 0,
  seasonCount = 1
) {
  const relations = await anilist.getPreviousRelations(mediaId);
  await new Promise((res) => setTimeout(res, 300));
  if (!relations) return { episodeOffset: 0, seasonCount: 0 };

  for (const { relationType, node } of relations) {
    if (relationType === MediaRelation.PREQUEL) {
      const episodes = node.episodes > 3 ? node.episodes : 0;
      return countPastRelations(
        node.id,
        episodeOffset + episodes,
        seasonCount + (episodes ? 1 : 0)
      );
    }
  }
  return { episodeOffset, seasonCount };
}

/**
 * Handles an anime with a delay of 2000ms to prevent hitting the rate limit
 * @param  {any} anime - Anime object to handle
 * @returns Promise
 */
async function handleWithDelay(this: any, anime: any, fireDBAnime?: any): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return this.handleAnime(anime, fireDBAnime);
}

export {
  joinArr,
  fixAnimeSeason,
  handleWithDelay,
  sendAnimeDownloadedHook,
  alertUser,
  logNextRunTime,
  countPastRelations,
};
