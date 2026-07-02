import fs from "fs";
import path from "path";

const rootConfigPath = path.join(__dirname, "..", "..", "profile.json");
const srcConfigPath = path.join(__dirname, "..", "..", "src", "profile.json");

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
  discord_username?: string;
  discord_avatar_url?: string;
  discord_enable_download?: boolean;
  discord_enable_fail?: boolean;
  discord_download_color?: string;
  discord_fail_color?: string;
  discord_download_title?: string;
  discord_fail_title?: string;
  discord_fail_description?: string;
}

let cachedConfig: ProfileConfig | null = null;

export function getConfig(): ProfileConfig {
  if (cachedConfig) return cachedConfig;
  try {
    let resolvedPath = rootConfigPath;
    if (fs.existsSync(srcConfigPath)) {
      resolvedPath = srcConfigPath;
    } else if (fs.existsSync(rootConfigPath)) {
      resolvedPath = rootConfigPath;
    } else {
      return {} as ProfileConfig;
    }
    const raw = fs.readFileSync(resolvedPath, "utf8");
    cachedConfig = JSON.parse(raw);
    return cachedConfig!;
  } catch (err) {
    console.error("Failed to read profile.json:", err);
  }
  return {} as ProfileConfig;
}

export function saveConfig(newConfig: ProfileConfig): void {
  try {
    fs.writeFileSync(rootConfigPath, JSON.stringify(newConfig, null, 2), "utf8");
    const srcDir = path.dirname(srcConfigPath);
    if (fs.existsSync(srcDir)) {
      fs.writeFileSync(srcConfigPath, JSON.stringify(newConfig, null, 2), "utf8");
    }
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
