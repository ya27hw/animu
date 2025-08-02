// Sends users current anime list
import { SlashCommandBuilder } from "@discordjs/builders";
import { CommandInteraction, MessageFlags } from "discord.js";
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
    const myAniList = await anilist.getAnimeUserList();
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
        if (a.media.title.romaji < b.media.title.romaji) return -1;
        if (a.media.title.romaji > b.media.title.romaji) return 1;
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
