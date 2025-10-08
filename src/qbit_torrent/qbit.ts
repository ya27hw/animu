import { qbitSID } from "@utils/interfaces";
import axios from "axios";
import path from "path/posix";
import { qbit_url, password, username, rootDir } from "profile.json";

class QbitTorrent {
  private sid?: qbitSID;

  // Function to authenticate and get the SID (Session ID)
  private async authenticate() {
    const authLink = new URL(qbit_url);
    authLink.pathname = "/api/v2/auth/login";

    try {
      const response = await axios.post(
        authLink.toString(),
        `username=${encodeURIComponent(username)}&password=${encodeURIComponent(
          password
        )}`,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const cookie = response.headers["set-cookie"];
      if (cookie) {
        const sidMatch = /SID=([^;]+)/.exec(cookie[0]);
        this.sid = {
          SID: sidMatch ? sidMatch[1] : undefined,
          expires: Date.now() + 3000 * 1000,
        };
      } else {
        console.error("Authentication failed. No session cookie received.");
      }
    } catch (error) {
      console.error("Error during authentication:", error);
    }
  }

  private async ensureAuthenticated() {
    if (!this.sid || Date.now() >= this.sid.expires) {
      await this.authenticate();
    }
    return !!this.sid;
  }

  public async addCheckTorrent(
    link: string,
    title: string,
    episode?: number
  ): Promise<boolean> {
    const displayTitle = episode ? `${title} - ${episode}` : title;

    // 5 attempts to add the torrent
    for (let attempt = 1; attempt <= 5; attempt++) {
      const added = await this.addTorrent(link, title, episode);

      if (!added) {
        console.error(
          `Attempt ${attempt}: Failed to add torrent: ${displayTitle}`.bgRed
            .white
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      console.log(`Added Torrent: ${displayTitle}`.bgBlue.white);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const isChecked = await this.checkTorrent(displayTitle);

      if (isChecked) {
        console.log(`Torrent ${displayTitle} is checked.`.bgWhite.black);
        return true;
      } else {
        console.log(`Torrent ${displayTitle} is not checked.`.bgYellow.black);
      }
    }
    return false;
  }

  // Function to add a torrent using the obtained SID
  private async addTorrent(
    link: string,
    title: string,
    episode?: number
  ): Promise<boolean> {
    const authLink = new URL(qbit_url);
    authLink.pathname = "/api/v2/torrents/add";

    const authenticated = await this.ensureAuthenticated();
    if (!authenticated) {
      console.error("Failed to authenticate.");
      return false;
    }

    try {
      const response = await axios.post(
        authLink.toString(),
        `urls=${encodeURIComponent(link)}&savepath=${encodeURIComponent(
          path.join(rootDir, title)
        )}&rename=${encodeURIComponent(
          episode ? `${title} - ${episode}` : title
        )}&sequentialDownload=true&category=${encodeURIComponent("animu")}`,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: `SID=${this.sid?.SID}`,
          },
        }
      );

      if (response.status === 200 && response.data === "Ok.") {
        return true;
      } else {
        console.error("Unexpected response from qBittorrent:", response.data);
        return false;
      }
    } catch (error) {
      console.log(error);

      return false;
    }
  }
  // Delete torrent based on what the torrent is named
  public async deleteTorrent(name: string): Promise<boolean> {
    const authLink = new URL(qbit_url);
    authLink.pathname = "/api/v2/torrents/delete";

    try {
      const authenticated = await this.ensureAuthenticated();
      if (!authenticated) {
        console.error("Failed to authenticate.");
        return false;
      }

      const response = await axios.post(
        authLink.toString(),
        `hashes=${encodeURIComponent(name)}`,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: `SID=${this.sid?.SID}`,
          },
        }
      );

      if (response.status === 200 && response.data === "Ok.") {
        return true;
      } else {
        console.error("Unexpected response from qBittorrent:", response.data);
        return false;
      }
    } catch (error) {
      console.log("Error deleting torrent:", error);
      return false;
    }
  }

  private async checkTorrent(name: string): Promise<boolean> {
    const authLink = new URL(qbit_url);
    authLink.pathname = "/api/v2/torrents/info";

    try {
      const authenticated = await this.ensureAuthenticated();
      if (!authenticated) {
        console.error("Failed to authenticate.");
        return false;
      }

      const response = await axios.post(
        authLink.toString(),
        `sort=added_on&limit=250&reverse=true`,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: `SID=${this.sid?.SID}`,
          },
        }
      );

      const torrents = response.data;
      return torrents.some((torrent: any) => name && torrent.name === name);
    } catch (error) {
      console.log("Error fetching torrent information:", error);
      return false;
    }
  }
}

export default new QbitTorrent();
