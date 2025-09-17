import fs from "fs";
import {
  ActivityOptions,
  ActivityType,
  Client,
  Collection,
  GatewayIntentBits,
} from "discord.js";
import { deployCommands } from "@discord/deploy-commands";
import path from "path";

class DiscordBot {
  private client: Client<boolean>;
  private commands: Collection<unknown, unknown>;
  private status: Array<ActivityOptions>;
  private commandsPath: string;
  private statusInterval?: NodeJS.Timeout;

  constructor() {
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
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
    this.commandsPath = path.resolve(__dirname, "commands");
  }

  private async setCommands() {
    const commandFiles = fs.readdirSync(this.commandsPath);

    for (const file of commandFiles) {
      const command = require(`${this.commandsPath}/${file}`);
      this.commands.set(command.data.name, command);
    }
    await deployCommands(this.commandsPath);
  }

  public async start(token: string) {
    await this.setCommands();
    this.client.login(token);

    // When the client is ready, run this code (only once)
    this.client.once("ready", () => {
      console.log("Ready!".yellow);
    });

    // Keep this bot alive by changing status
    this.statusInterval = setInterval(() => {
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

  /**
   * stop
   */
  public stop() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = undefined;
    }
    this.client.destroy();
  }
}

export default new DiscordBot();
