# animu
<img width="1920" height="980" alt="Screenshot_20260301_174741" src="https://github.com/user-attachments/assets/f5ffa62b-a5f9-4a35-9637-46be21d5604a" />

Special thanks to Uncle Sam 💙 for the webUI

## What is this project about?

Conveniently downloads you the latest anime releases locally, without having to access a third-party site.


## Why did I make this?

Simply put, I got bored of continuously accessing websites filled with intrusive ads. The optimal solution would have been to install adblock (duh), but why not take the hard, long path?

## How does this work? (in simple terms)

You give the program your Anilist profile. It looks at your current "*WATCHING*" list, determines what episodes you are missing, and proceeds to download them for you! You are then free to do whatever you want with the downloaded files, whether it be hosting them locally on a media server, or just downloading them for a road trip!

## How do I set this up?

NOTE : Firebase server that's used to store your animelists is currently private.
You could make your own, however. These instructions are for future me.

1. `npm install`
2. Download qbittorrent
3. Enable Web UI 
4. Create, then fill in `profile.json` with the following details:


* _torrent_url_ ,where your qbittorrent webUI server is set up at, usually gonna be "http://localhost:8080/"

*  _username_ and _password_ of your qbittorrent webUI server

* _email_ and _emailPassword_, both obtained from firebase (details on how to sign up shall be implemented later!)
  
* Get your Anilist username and fill it in _aniUserName_

* Choose which _resolution_ to download anime. "480","720" or "1080" accepted (1080 recommended because it's been tested extensively)

* _root_dir_, where you want your downloads to be stored.

* _token_, _guildId_, _clientId_, all taken from a Discord Bot

5. Run `ts-node main.ts` (P.S you might need VPN)

## Current Development Status
I love this ngl
