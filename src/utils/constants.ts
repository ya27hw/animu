import { getConfig } from "./config";

const RUNTIMES = {
  get offPeak() {
    return `*/${getConfig().offpeakInterval ?? 25} 05-11 * * *`;
  },
  get peak() {
    return `*/${getConfig().interval ?? 30} 12-23,00-04 * * *`;
  },
  clearOfflineDB: "0 0 */1 * *",
};

export { RUNTIMES };
