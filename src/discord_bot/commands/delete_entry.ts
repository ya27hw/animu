import { SlashCommandBuilder } from "@discordjs/builders";
import { CommandInteraction, MessageFlags } from "discord.js";
import db from "@db/db";
import schedule from "@scheduler/schedule";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("delete_entry")
    .setDescription("Deletes an anime entry")
    .addStringOption((option) =>
      option
        .setName("anime_id")
        .setDescription("The Anime ID in order to modify the DB")
        .setRequired(true)
    ),
  /**
   * Runs the command delete_entry, which deletes an anime entry/entries.
   * @param  {CommandInteraction} interaction - The interaction object
   */
  async execute(interaction: CommandInteraction) {
    const options = interaction.options.data;
    const animeid = options.find((option) => option.name === "anime_id");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await db.modifyAnimeEntry(animeid!.value as string, {
      downloadedEpisodes: [],
    });
    schedule.clearOfflineDB(animeid!.value as string);
    await interaction.editReply({
      embeds: [
        {
          title: "Success",
          description: `Anime entry ${animeid!.value} has been deleted`,
          color: 0x00ff00,
        },
      ],
    });
  },
};
