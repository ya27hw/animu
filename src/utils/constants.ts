import { clear } from "console";
import { interval, offpeakInterval } from "profile.json";

const RUNTIMES = {
  offPeak: `*/${offpeakInterval} 05-11 * * *`,
  peak: `*/${interval} 12-23,00-04 * * *`,
  clearOfflineDB: "0 0 */1 * *",
};

export { RUNTIMES };
