#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using jellyfin_ani_sync.Api;
using jellyfin_ani_sync.Api.Anilist;
using jellyfin_ani_sync.Models;
using jellyfin_ani_sync.Models.Mal;

namespace jellyfin_ani_sync.Helpers {
    public class ApiCallHelpers : IApiCallHelpers {
        private readonly AniListApiCalls? _aniListApiCalls;

        public ApiCallHelpers(AniListApiCalls? aniListApiCalls = null) {
            _aniListApiCalls = aniListApiCalls;
        }

        public async Task<List<Anime>> SearchAnime(string query) {
            bool updateNsfw = Plugin.Instance?.PluginConfiguration?.updateNsfw != null && Plugin.Instance.PluginConfiguration.updateNsfw;

            if (_aniListApiCalls != null) {
                List<AniListSearch.Media> animeList = await _aniListApiCalls.SearchAnime(query);
                return AniListSearchAnimeConvertedList(animeList, updateNsfw);
            }

            return new List<Anime>();
        }

        internal List<Anime> AniListSearchAnimeConvertedList(List<AniListSearch.Media> animeList, bool updateNsfw) {
            List<Anime> convertedList = new List<Anime>();
            if (animeList != null) {
                foreach (AniListSearch.Media media in animeList) {
                    if (!updateNsfw && media.IsAdult) continue; // Skip NSFW anime if the user doesn't want to update them
                    var synonyms = new List<string> {
                        media.Title.Romaji ?? string.Empty,
                        media.Title.UserPreferred ?? string.Empty
                    };
                    if (media.Synonyms != null) {
                        synonyms.AddRange(media.Synonyms);
                    }
                    var anime = new Anime {
                        Id = media.Id,
                        Title = media.Title.English,
                        AlternativeTitles = new AlternativeTitles {
                            En = media.Title.English,
                            Ja = media.Title.Native,
                            Synonyms = synonyms
                        },
                        NumEpisodes = media.Episodes ?? 0,
                    };

                    switch (media.Status) {
                        case AniListSearch.AiringStatus.FINISHED:
                            anime.Status = AiringStatus.finished_airing;
                            break;
                        case AniListSearch.AiringStatus.RELEASING:
                            anime.Status = AiringStatus.currently_airing;
                            break;
                        case AniListSearch.AiringStatus.NOT_YET_RELEASED:
                        case AniListSearch.AiringStatus.CANCELLED:
                        case AniListSearch.AiringStatus.HIATUS:
                            anime.Status = AiringStatus.not_yet_aired;
                            break;
                    }

                    convertedList.Add(anime);
                }
            }

            return convertedList;
        }

        public async Task<Anime> GetAnime(int id, string? alternativeId = null, bool getRelated = false) {
            if (_aniListApiCalls != null) {
                AniListSearch.Media anime = await _aniListApiCalls.GetAnime(id);
                if (anime == null) return null!;

                return ClassConversions.ConvertAniListAnime(anime);
            }

            return null!;
        }

        public async Task<UpdateAnimeStatusResponse> UpdateAnime(int animeId, int numberOfWatchedEpisodes, Status status,
            bool? isRewatching = null, int? numberOfTimesRewatched = null, DateTime? startDate = null, DateTime? endDate = null, string? alternativeId = null, AnimeOfflineDatabaseHelpers.OfflineDatabaseResponse? ids = null, bool? isShow = null) {
            
            if (_aniListApiCalls != null) {
                AniListSearch.MediaListStatus anilistStatus;
                switch (status) {
                    case Status.Watching:
                        anilistStatus = AniListSearch.MediaListStatus.Current;
                        break;
                    case Status.Completed:
                        anilistStatus = isRewatching != null && isRewatching.Value ? AniListSearch.MediaListStatus.Repeating : AniListSearch.MediaListStatus.Completed;
                        break;
                    case Status.On_hold:
                        anilistStatus = AniListSearch.MediaListStatus.Paused;
                        break;
                    case Status.Dropped:
                        anilistStatus = AniListSearch.MediaListStatus.Dropped;
                        break;
                    case Status.Plan_to_watch:
                        anilistStatus = AniListSearch.MediaListStatus.Planning;
                        break;
                    case Status.Rewatching:
                        anilistStatus = AniListSearch.MediaListStatus.Repeating;
                        break;
                    default:
                        anilistStatus = AniListSearch.MediaListStatus.Current;
                        break;
                }

                if (await _aniListApiCalls.UpdateAnime(animeId, anilistStatus, numberOfWatchedEpisodes, numberOfTimesRewatched, startDate, endDate)) {
                    return new UpdateAnimeStatusResponse();
                }
            }

            return null!;
        }

        public async Task<MalApiCalls.User> GetUser() {
            if (_aniListApiCalls != null) {
                AniListViewer.Viewer user = await _aniListApiCalls.GetCurrentUser();
                return ClassConversions.ConvertUser(user.Id, user.Name);
            }

            return null!;
        }

        public async Task<List<Anime>> GetAnimeList(Status status, int? userId = null) {
            if (_aniListApiCalls != null && userId != null) {
                AniListSearch.MediaListStatus anilistStatus;
                switch (status) {
                    case Status.Watching:
                        anilistStatus = AniListSearch.MediaListStatus.Current;
                        break;
                    case Status.Completed:
                        anilistStatus = AniListSearch.MediaListStatus.Completed;
                        break;
                    case Status.Rewatching:
                        anilistStatus = AniListSearch.MediaListStatus.Repeating;
                        break;
                    case Status.On_hold:
                        anilistStatus = AniListSearch.MediaListStatus.Paused;
                        break;
                    case Status.Dropped:
                        anilistStatus = AniListSearch.MediaListStatus.Dropped;
                        break;
                    case Status.Plan_to_watch:
                        anilistStatus = AniListSearch.MediaListStatus.Planning;
                        break;
                    default:
                        anilistStatus = AniListSearch.MediaListStatus.Current;
                        break;
                }

                var animeList = await _aniListApiCalls.GetAnimeList(userId.Value, anilistStatus);
                List<Anime> convertedList = new List<Anime>();
                if (animeList != null) {
                    foreach (var media in animeList) {
                        int lastIndex = media.Media.SiteUrl.LastIndexOf("/", StringComparison.CurrentCulture);
                        if (lastIndex != -1) {
                            DateTime finishDate = new DateTime();
                            if (media.CompletedAt is { Year: { }, Month: { }, Day: { } }) {
                                finishDate = new DateTime(media.CompletedAt.Year.Value, media.CompletedAt.Month.Value, media.CompletedAt.Day.Value);
                            }

                            convertedList.Add(new Anime {
                                Id = media.Media.Id,
                                MyListStatus = new MyListStatus {
                                    FinishDate = finishDate.ToShortDateString(),
                                    NumEpisodesWatched = media.Progress ?? -1
                                }
                            });
                        }
                    }
                }

                return convertedList;
            }

            return new List<Anime>();
        }
    }
}