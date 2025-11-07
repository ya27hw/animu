/*************************************************************************************** */
/**
 * @description This contains interfaces used in this application.
 */
/*************************************************************************************** */

import { AnimeFormat, AnimeStatus, MediaRelation } from "@utils/enums";
import { OfflineAnime } from "@utils/classes";

// This interface is used to store the torrent information from an anime retrieved in Nyaa.
interface NyaaTorrent {
  title: string;
  link: string;
  pubDate: string;
  "nyaa:seeders": string;
  "nyaa:size": string;
  content: string;
  contentSnipet: string;
  guid: string;
  isoDate: string;
  episode?: number;
}

// Helper interface for Media. It is used to store the next episode number, and the its ID.
interface nextAiringEpisode {
  episode: number;
  id: number;
  timeUntilAiring: number;
}

interface AiringSchedule {
  nodes: AiringScheduleNode[];
}

interface MediaRelations {
  relationType: MediaRelation;
  node: {
    id: number;
    episodes: number;
    title: {
      romaji: string;
      english: string;
    };
  };
}

type AiringScheduleNode = {
  airingAt: number;
  episode: number;
};

// Helper interface for Media. It is used to define the title of the anime. This can be in 3 different forms.
interface AniTitle {
  romaji: string;
  english?: string;
  native: string;
}

// Helper interface for Media. It is used to define the anime's cover art size.
interface AniCoverImage {
  extraLarge: string;
  large: string;
  medium: string;
  color?: string;
}

// The parent of AniMedia. This is what is retrieved from AniList. It contains user progress, and info about the anime itself.
interface AniQuery {
  progress: number;
  mediaId: number;
  media: AniMedia;
}

// Main interface for the application. It is used to store the entire infromation about the anime.
interface AniMedia {
  episodes: number;
  genres: string[];
  format: AnimeFormat;
  status: AnimeStatus;
  endDate: {
    year: number | null;
    month: number | null;
    day: number | null;
  };
  nextAiringEpisode: nextAiringEpisode | null;
  airingSchedule: AiringSchedule;
  title: AniTitle;
  synonyms: string[];
  coverImage: AniCoverImage;
}

// For Discord Bot.
interface Command {
  msg: string;
  cmd: Function;
}

// offline db interface. It is used to store a shallow copy of firebase offline
interface OfflineDB {
  [key: string]: OfflineAnime;
}

interface qbitSID {
  SID?: string;
  expires: number;
}

type NyaaRSSResult = {
  status: number;
  message: string;
  data: NyaaTorrent[] | null;
};

export {
  NyaaTorrent,
  nextAiringEpisode,
  AniTitle,
  AniCoverImage,
  AniQuery,
  AniMedia,
  Command,
  OfflineDB,
  AiringSchedule,
  qbitSID,
  NyaaRSSResult,
  MediaRelations
};
