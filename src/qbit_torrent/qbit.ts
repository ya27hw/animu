import { qbitSID } from "@utils/interfaces";
import axios from "axios";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { qbit_url, password, username, rootDir, altRootDir } from "profile.json";
import { proxy } from "@utils/models";

class QbitTorrent {
  private sid?: qbitSID;
  private readonly tempDir: string;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), "animu-torrents");
  }

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
    episode?: number,
    useProxyDownload: boolean = false,
  ): Promise<boolean> {
    const displayTitle = episode ? `${title} - ${episode}` : title;

    // 5 attempts to add the torrent
    for (let attempt = 1; attempt <= 5; attempt++) {
      const added = await this.addTorrent(
        link,
        title,
        episode,
        useProxyDownload,
      );

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
    episode?: number,
    useProxyDownload: boolean = false,
  ): Promise<boolean> {
    const authLink = new URL(qbit_url);
    authLink.pathname = "/api/v2/torrents/add";

    const authenticated = await this.ensureAuthenticated();
    if (!authenticated) {
      console.error("Failed to authenticate.");
      return false;
    }

    try {
      const rename = episode ? `${title} - ${episode}` : title;
      const baseRootDir = useProxyDownload ? altRootDir : rootDir;
      const savePath = path.posix.join(baseRootDir, title);
      const headers = {
        Cookie: `SID=${this.sid?.SID}`,
      };

      const response = useProxyDownload
        ? await this.addTorrentFile(authLink.toString(), link, savePath, rename, headers)
        : await axios.post(
            authLink.toString(),
            `urls=${encodeURIComponent(link)}&savepath=${encodeURIComponent(
              savePath
            )}&rename=${encodeURIComponent(
              rename
            )}&sequentialDownload=true&category=${encodeURIComponent("animu")}`,
            {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                ...headers,
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

  private async addTorrentFile(
    authUrl: string,
    link: string,
    savePath: string,
    rename: string,
    headers: Record<string, string>,
  ) {
    const torrentFilePath = await this.downloadTorrentFile(link, rename);
    const torrentBuffer = await fs.readFile(torrentFilePath);
    const boundary = `----AnimuBoundary${Date.now().toString(16)}`;

    const fieldPart = (name: string, value: string) =>
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
        `${value}\r\n`,
      );

    const fileHeader = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="torrents"; filename="${rename}.torrent"\r\n` +
      `Content-Type: application/x-bittorrent\r\n\r\n`,
    );

    const closingBoundary = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([
      fileHeader,
      torrentBuffer,
      Buffer.from("\r\n"),
      fieldPart("savepath", savePath),
      fieldPart("rename", rename),
      fieldPart("sequentialDownload", "true"),
      fieldPart("category", "animu"),
      closingBoundary,
    ]);

    try {
      return await axios.post(authUrl, body, {
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length.toString(),
          ...headers,
        },
      });
    } finally {
      await fs.unlink(torrentFilePath).catch(() => undefined);
    }
  }

  private async downloadTorrentFile(link: string, rename: string): Promise<string> {
    await fs.mkdir(this.tempDir, { recursive: true });

    const safeName = rename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
    const torrentFilePath = path.join(
      this.tempDir,
      `${safeName}-${Date.now()}.torrent`,
    );

    const torrentResponse = await axios.get<ArrayBuffer>(link, {
      responseType: "arraybuffer",
      proxy,
    });

    await fs.writeFile(torrentFilePath, Buffer.from(torrentResponse.data));

    return torrentFilePath;
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
