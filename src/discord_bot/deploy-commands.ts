import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import { clientId, guildId, token } from "profile.json";
import fs from "fs";

export async function deployCommands(commandsPath: string) {
  const commands: any[] = [];
  const commandFiles = fs.readdirSync(commandsPath);

  for (const file of commandFiles) {
    const command = require(`${commandsPath}/${file}`);
    if ("data" in command && "execute" in command) {
      commands.push(command.data.toJSON());
    } else {
      console.log(
        `[WARNING] The command at ${commandsPath}/${file} is missing a required "data" or "execute" property.`
          .red
      );
    }
  }

  const rest = new REST().setToken(token);

  rest
    .put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
    .then(() => console.log("Successfully registered application commands."))
    .catch(console.error);
}
