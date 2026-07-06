#nullable enable
using System.Collections.Generic;
using jellyfin_ani_sync.Api;
using jellyfin_ani_sync.Models;
using jellyfin_ani_sync.Models.Mal;

namespace jellyfin_ani_sync.Helpers {
    public class ClassConversions {
        public static Anime ConvertAniListAnime(AniListSearch.Media aniListAnime) {
            Anime anime = new Anime {
                Id = aniListAnime.Id,
                NumEpisodes = aniListAnime.Episodes ?? 0,
                Title = aniListAnime.Title.English,
                AlternativeTitles = new AlternativeTitles {
                    En = aniListAnime.Title.English,
                    Ja = aniListAnime.Title.Native,
                    Synonyms = new List<string> {
                        { aniListAnime.Title.Romaji ?? string.Empty },
                        { aniListAnime.Title.UserPreferred ?? string.Empty }
                    }
                },
            };

            if (aniListAnime.MediaListEntry != null) {
                anime.MyListStatus = new MyListStatus {
                    NumEpisodesWatched = aniListAnime.MediaListEntry.Progress,
                    IsRewatching = aniListAnime.MediaListEntry.MediaListStatus == AniListSearch.MediaListStatus.Repeating
                };
            }

            if (aniListAnime.MediaListEntry != null) {
                anime.MyListStatus.RewatchCount = aniListAnime.MediaListEntry.RepeatCount;

                switch (aniListAnime.MediaListEntry.MediaListStatus) {
                    case AniListSearch.MediaListStatus.Current:
                        anime.MyListStatus.Status = Status.Plan_to_watch;
                        break;
                    case AniListSearch.MediaListStatus.Completed:
                        anime.MyListStatus.Status = Status.Completed;
                        break;
                    case AniListSearch.MediaListStatus.Repeating:
                        anime.MyListStatus.Status = Status.Rewatching;
                        break;
                    case AniListSearch.MediaListStatus.Dropped:
                        anime.MyListStatus.Status = Status.Dropped;
                        break;
                    case AniListSearch.MediaListStatus.Paused:
                        anime.MyListStatus.Status = Status.On_hold;
                        break;
                    case AniListSearch.MediaListStatus.Planning:
                        anime.MyListStatus.Status = Status.Plan_to_watch;
                        break;
                }
            }

            anime.RelatedAnime = new List<RelatedAnime>();
            if (aniListAnime.Relations != null && aniListAnime.Relations.Media != null) {
                foreach (AniListSearch.MediaEdge relation in aniListAnime.Relations.Media) {
                    RelatedAnime relatedAnime = new RelatedAnime {
                        Anime = ConvertAniListAnime(relation.Media)
                    };

                    switch (relation.RelationType) {
                        case AniListSearch.MediaRelation.Sequel:
                            relatedAnime.RelationType = RelationType.Sequel;
                            break;
                        case AniListSearch.MediaRelation.Side_Story:
                            relatedAnime.RelationType = RelationType.Side_Story;
                            break;
                        case AniListSearch.MediaRelation.Alternative:
                            relatedAnime.RelationType = RelationType.Alternative_Setting;
                            break;
                    }

                    anime.RelatedAnime.Add(relatedAnime);
                }
            }

            return anime;
        }

        public static MalApiCalls.User ConvertUser(int id, string name) {
            return new MalApiCalls.User {
                Id = id,
                Name = name
            };
        }
    }
}