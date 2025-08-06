import { MessageBuilder, Webhook } from "discord-webhook-node";
import { webhook } from "profile.json";
const hook: Webhook = new Webhook(webhook);
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
  await hook.send(msg);
}

function logNextRunTime(animeTitle: string, timeouts: number) {
  const offpeakCronTimes = new CronTime(RUNTIMES.offPeak);
  const peakCronTimes = new CronTime(RUNTIMES.peak);

  let timeRemaining: number = 0;
  let date: DateTime = DateTime.now();

  for (let i = 0; i <= timeouts; i++) {
    // Check if the current time is in between 5am to 11am
    const isOffPeakHours = date.hour >= 5 && date.hour <= 11;

    let nextRunDate;
    if (isOffPeakHours) nextRunDate = offpeakCronTimes.getNextDateFrom(date);
    else nextRunDate = peakCronTimes.getNextDateFrom(date);

    // Get minute difference
    const minuteDiff = nextRunDate.diff(date, "minutes");

    timeRemaining += minuteDiff.minutes;
    date = nextRunDate;
  }

  timeRemaining = Math.ceil(timeRemaining);

  console.log(
    `❌ Failed to find ${animeTitle}. Next run in ${timeRemaining} minutes. (At ${date.toFormat(
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

  await hook.send(msg);
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
  // Go through prequels, and accumulate the episodes and season couts.
  const relations = await anilist.getPreviousRelations(mediaId);
  // Sleep
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!relations) return { episodeOffset: 0, seasonCount: 0 };
  for (const relation of relations) {
    if (relation.relationType === MediaRelation.PREQUEL) {
      if (relation.node.episodes > 3) {
        return countPastRelations(
          relation.node.id,
          episodeOffset + relation.node.episodes,
          seasonCount + 1
        );
      } else {
        return countPastRelations(relation.node.id, episodeOffset, seasonCount);
      }
    }
  }
  return { episodeOffset, seasonCount };
}

/**
 * Handles an anime with a delay of 1000ms to prevent hitting the rate limit
 * @param  {any} anime - Anime object to handle
 * @returns Promise
 */
async function handleWithDelay(this: any, anime: any): Promise<void> {
  return this.handleAnime(anime);
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
