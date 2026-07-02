import { getConfig } from "./config";

class OfflineAnime {
  episodes: Array<number>;
  starting_episode: number = 0;
  timeouts: number = 0;
  maxTimeouts: number = 0;

  constructor(episodes: Array<number>) {
    this.episodes = episodes;
  }
  /**
   * Sets a timeout until the next episode is aired.
   * @param  {number} time - The time in seconds until the next episode is aired.
   */
  public setTimeoutUntil(time: number): void {
    const timeInMinutes = time / 60;
    this.timeouts = Math.round(timeInMinutes / (getConfig().interval ?? 30));
  }

  public setTimeout() {
    // Cap at 10 instead of wrapping to 0 — prevents burst of retries
    // when the counter wraps back from max to min.
    if (this.maxTimeouts >= 10) {
      this.timeouts = this.maxTimeouts;
      return true;
    }

    this.maxTimeouts += 1;
    this.timeouts = this.maxTimeouts;

    return this.maxTimeouts >= 10;
  }
  public resetTimeout() {
    this.timeouts = 0;
    this.maxTimeouts = 0;
  }
}

export { OfflineAnime };
