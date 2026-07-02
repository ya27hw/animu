const { HttpsProxyAgent } = require("https-proxy-agent");
import { getConfig } from "./config";

export function getProxyAgent(): any {
  const config = getConfig();
  if (!config.useProxy || !config.proxyAddress) return undefined;
  
  const protocol = "http";
  const host = config.proxyAddress;
  const port = config.proxyPort || 80;
  const username = config.proxyUsername;
  const password = config.proxyPassword;
  
  let authStr = "";
  if (username || password) {
    authStr = `${encodeURIComponent(username || "")}:${encodeURIComponent(password || "")}@`;
  }
  
  const proxyUrl = `${protocol}://${authStr}${host}:${port}`;
  return new HttpsProxyAgent(proxyUrl);
}