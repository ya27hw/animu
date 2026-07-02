import fs from "fs";
import path from "path";

const configPath = path.join(__dirname, "..", "..", "profile.json");

export interface ProfileConfig {
  torrent_url?: string;
  qbit_url?: string;
  username?: string;
  password?: string;
  email?: string;
  emailPassword?: string;
  aniUserName?: string;
  bearerTokenAnilist?: string;
  id?: number;
  resolution?: string;
  rootDir?: string;
  altRootDir?: string;
  token?: string;
  guildId?: string;
  clientId?: string;
  useProxy?: boolean;
  proxyAddress?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  nyaaUrl?: string;
  altNyaaUrl?: string;
  triggerGenre?: string;
  webhook?: string;
  interval?: number;
  offpeakInterval?: number;
  excludeReleaseGroups?: string[];
  setCompletedToRewatching?: boolean;
}

let cachedConfig: ProfileConfig | null = null;

export function getConfig(): ProfileConfig {
  if (cachedConfig) return cachedConfig;
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      cachedConfig = JSON.parse(raw);
      return cachedConfig!;
    }
  } catch (err) {
    console.error("Failed to read profile.json:", err);
  }
  return {} as ProfileConfig;
}

export function saveConfig(newConfig: ProfileConfig): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf8");
    cachedConfig = newConfig;
    console.log("Config updated and saved to profile.json");
  } catch (err) {
    console.error("Failed to save config:", err);
  }
}

export function reloadConfig(): ProfileConfig {
  cachedConfig = null;
  return getConfig();
}
