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
    return {
      username: getConfig().proxyUsername || "",
      password: getConfig().proxyPassword || "",
    };
  },
};

export { proxy };