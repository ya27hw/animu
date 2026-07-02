import { getConfig } from "./config";

const proxy: any = {
  get protocol() {
    return "http";
  },
  get host() {
    return getConfig().proxyAddress || "";
  },
  get port() {
    return getConfig().proxyPort || 80;
  },
  get auth() {
    const config = getConfig();
    const username = config.proxyUsername;
    const password = config.proxyPassword;
    if (!username && !password) return undefined;
    return {
      username: username || "",
      password: password || "",
    };
  },
};

export { proxy };