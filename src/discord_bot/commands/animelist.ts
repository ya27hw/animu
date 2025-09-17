// Sends users current anime list
import { CommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import anilist from "@ani/anilist";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anime_list")
    .setDescription("Retrieves your current WATCHING list"),
  /**
   * Runs the command anime_list, which retrieves your current anime list
   * Displays the anime list in an embed
   * @param  {CommandInteraction} interaction
   */
  async execute(interaction: CommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const myAniList = await anilist.getWatchingUserList();
    if (myAniList.length === 0)
      await interaction.editReply({
        embeds: [
          {
            title: "Anime List",
            description: "You have no anime in your list",
            color: 0xff0000,
          },
        ],
      });
    else {
      const orderedList = myAniList.sort((a, b) => {
        if (
          a.media.title.romaji.toLowerCase() <
          b.media.title.romaji.toLowerCase()
        )
          return -1;
        if (
          a.media.title.romaji.toLowerCase() >
          b.media.title.romaji.toLowerCase()
        )
          return 1;
        return 0;
      });
      await interaction.editReply({
        embeds: [
          {
            title: "Anime List",
            description: orderedList
              .map(
                (anime) => `\`${anime.media.title.romaji}\` - ${anime.mediaId}`
              )
              .join("\n"),
            color: 0x00ff00,
          },
        ],
      });
    }
  },
};
