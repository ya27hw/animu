const { HttpsProxyAgent } = require("https-proxy-agent");
import { getConfig } from "./config";

export function getProxyAgent(): any {
  const config = getConfig();
  if (!config.useProxy || !config.proxyAddress) return undefined;
  
  const protocol = "http";
  const host = config.proxyAddress;
  const port = config.proxyPort || 80;
  
  let authStr = "";
  if (config.proxyAuthType === "credentials" && (config.proxyUsername || config.proxyPassword)) {
    authStr = `${encodeURIComponent(config.proxyUsername || "")}:${encodeURIComponent(config.proxyPassword || "")}@`;
  }
  
  const proxyUrl = `${protocol}://${authStr}${host}:${port}`;
  return new HttpsProxyAgent(proxyUrl);
}