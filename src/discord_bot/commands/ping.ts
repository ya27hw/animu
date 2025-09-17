import { MessageFlags, SlashCommandBuilder } from "discord.js";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong!"),
  async execute(interaction: { reply: (arg0: { content: string; flags: MessageFlags; }) => any; }) {
    await interaction.reply({
      content: "Secret Pong!",
      flags: MessageFlags.Ephemeral,
    });
  },
};
