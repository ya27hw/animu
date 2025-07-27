
enum Resolution {
  SD = "480",
  HD = "720",
  FHD = "1080",
  NONE = "0",
}

enum AnimeStatus {
  FINISHED = "FINISHED",
  RELEASING = "RELEASING",
  NOT_YET_RELEASED = "NOT_YET_RELEASED",
}

// Helper enum for Media. It is used to define the format of anime.
enum AnimeFormat {
  TV = "TV",
  TV_SHORT = "TV_SHORT",
  OVA = "OVA",
  ONA = "ONA",
  MOVIE = "MOVIE",
  SPECIAL = "SPECIAL",
  MUSIC = "MUSIC",
  MANGA = "MANGA",
  NOVEL = "NOVEL",
  ONE_SHOT = "ONE_SHOT",
}

// Enum which stores which format of anime is being searched for.

enum SearchMode {
  EPISODE = "EPISODE",
  OVA = "OVA",
  ONA = "ONA",
  MOVIE = "MOVIE",
  BATCH = "BATCH",
  TV_SHORT = "TV_SHORT",
}

enum MediaRelation {
  PREQUEL = "PREQUEL",
  SEQUEL = "SEQUEL",
  PARENT = "PARENT",
  ADAPTION = "ADAPTATION",
  SIDE_STORY = "SIDE_STORY",
  CHARACTER = "CHARACTER",
  SUMMARY = "SUMMARY",
  ALTERNATIVE = "ALTERNATIVE",
  SPIN_OFF = "SPIN_OFF",
  OTHER = "OTHER", 
  SOURCE = "SOURCE",
  COMPILATION = "COMPILATION",
  CONTAINS = "CONTAINS",
}

export { Resolution, AnimeStatus, AnimeFormat, SearchMode, MediaRelation };
