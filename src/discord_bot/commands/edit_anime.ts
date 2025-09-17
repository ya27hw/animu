// import { SlashCommandBuilder } from "@discordjs/builders";
import {ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import db from "@db/db";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("edit_anime")
    .setDescription("Edits an anime entry if needed")
    .addStringOption((option) =>
      option
        .setName("anime_id")
        .setDescription("The Anime ID in order to modify the DB")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("anime_alt_title")
        .setDescription("The Anime alternative title")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("starting_episode")
        .setDescription("The starting episode of the anime")
        .setRequired(false)
    ),
  async execute(interaction : ChatInputCommandInteraction) {
    const options = interaction.options.data;
    const animeid = options.find((option) => option.name === "anime_id");
    const animealt = options.find(
      (option) => option.name === "anime_alt_title"
    );
    const starting_episode = options.find(
      (option) => option.name === "starting_episode"
    );
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const isAdded = await db.modifyAnimeEntry(animeid!.value as string, {
      "media.alternativeTitle": animealt!.value as string,
      "media.startingEpisode": starting_episode
        ? parseInt(starting_episode.value as string)
        : 0,
    });
    
    if (isAdded) {
      await interaction.editReply({
        embeds: [
          {
            title: "Success",
            description: `Anime entry ${animeid!.value} has been modified`,
            color: 0x00ff00,
          },
        ],
      });
    } else {
      await interaction.editReply({
        embeds: [
          {
            title: "Error",
            description: `Anime entry ${animeid!.value} could not be modified`,
            color: 0xff0000,
          },
        ],
      });
    }
  },
};
