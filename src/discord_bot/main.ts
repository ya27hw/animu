import fs from "fs";
import {
  ActivityOptions,
  ActivityType,
  Client,
  Collection,
  IntentsBitField,
} from "discord.js";
import { deployCommands } from "@discord/deploy-commands";

class DiscordBot {
  private client: Client<boolean>;
  private commands: Collection<unknown, unknown>;
  private status: Array<ActivityOptions>;
  constructor() {
    this.client = new Client({ intents: [IntentsBitField.Flags.Guilds] });
    this.commands = new Collection();
    this.status = [
      {
        name: "Dawn",
        type: ActivityType.Watching,
      },
      {
        name: "the sea",
        type: ActivityType.Listening,
      },
    ];
  }

  private async setCommands() {
    const commandFiles = fs
      .readdirSync("src/discord_bot/commands")
      .filter((file) => file.endsWith(".ts"));

    for (const file of commandFiles) {
      const command = require(`./commands/${file}`);
      this.commands.set(command.data.name, command);
    }
    await deployCommands();
  }

  public async start(token: string) {
    await this.setCommands();
    this.client.login(token);

    // When the client is ready, run this code (only once)
    this.client.once("ready", () => {
      console.log("Ready!");
    });

    // Keep this bot alive by changing status
    setInterval(() => {
      let random = Math.floor(Math.random() * this.status.length);
      this.client.user!.setActivity(this.status[random]);
    }, 3600000);

    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isCommand()) return;

      const command: any = this.commands.get(interaction.commandName);

      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        await interaction.reply({
          content: "There was an error while executing this command!",
          ephemeral: true,
        });
      }
    });
  }
}

export default new DiscordBot();
