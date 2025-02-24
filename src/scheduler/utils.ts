import { MessageBuilder, Webhook } from "discord-webhook-node";
import { webhook } from "profile.json";
const hook: Webhook = new Webhook(webhook);

async function alertUser(anime: string, image: string) {
  const msg: MessageBuilder = new MessageBuilder()
    .setTitle("Anime Not Found")
    .setColor(0xff0000)
    .setDescription(
      `Animu could not find ${anime}. Please double check the title and try again.`
    )
    .setImage(image);
  await hook.send(msg);
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
function getAnimeSeason(animeEntry: string): number {
  /* Try to infer the season from the anime title
     
   *  Example:
   * - Case 1 : Boku no Hero Academia             --> Season 1
   * - Case 2 : Boku no Hero Academia 3           --> Season 3
   * - Case 3 : Boku no Hero Academia S2          --> Season 2
   * - Case 4 : Boku no Hero Academia Season 5    --> Season 5
   * - Case 5 : Boku no Hero Academia Season IV   --> Season 4 (optional case)
   * - Case 6 : Boku no Hero Academia 7th Season  --> Season 7 (s7 doesn't exist but who cares)
   */

  const seasonRegex =
    /s0?\d{1}|season(.*)0?\d{1}|(\d+(st|nd|rd|th)(.*)season)|[^a-zA-Z0-9]0?\d{1}$/i;
  const seasonString = animeEntry.match(seasonRegex);
  // If found, extract the season number
  if (seasonString) {
    const seasonNumber = seasonString[0].match(/\d+/);
    return seasonNumber ? parseInt(seasonNumber[0]) : 0;
  }

  return 1;
}

/**
 * Handles an anime with a delay of 1000ms to prevent hitting the rate limit
 * @param  {any} anime - Anime object to handle
 * @returns Promise
 */
async function handleWithDelay(this: any, anime: any): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return this.handleAnime(anime);
}

export {
  joinArr,
  getAnimeSeason,
  handleWithDelay,
  sendAnimeDownloadedHook,
  alertUser,
};
