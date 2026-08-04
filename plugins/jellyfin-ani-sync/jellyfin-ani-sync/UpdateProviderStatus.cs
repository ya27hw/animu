#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using jellyfin_ani_sync.Api;
using jellyfin_ani_sync.Api.Anilist;
using jellyfin_ani_sync.Configuration;
using jellyfin_ani_sync.Helpers;
using jellyfin_ani_sync.Interfaces;
using jellyfin_ani_sync.Models;
using jellyfin_ani_sync.Models.Mal;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.IO;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace jellyfin_ani_sync {
    public class UpdateProviderStatus {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IApplicationPaths _applicationPaths;
        private readonly IServerApplicationHost _serverApplicationHost;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly IMemoryCache _memoryCache;
        private readonly IAsyncDelayer _delayer;

        private readonly ILogger<UpdateProviderStatus> _logger;

        internal IApiCallHelpers ApiCallHelpers;
        private UserConfig? _userConfig;
        private Type _animeType;
        private readonly ILibraryManager _libraryManager;
        private readonly IFileSystem _fileSystem;

        internal ApiName ApiName;
        private readonly ILoggerFactory _loggerFactory;
        private AnimeOfflineDatabaseHelpers.OfflineDatabaseResponse _apiIds = new ();

        public UpdateProviderStatus(IFileSystem fileSystem,
            ILibraryManager libraryManager,
            ILoggerFactory loggerFactory,
            IHttpContextAccessor httpContextAccessor,
            IServerApplicationHost serverApplicationHost,
            IHttpClientFactory httpClientFactory,
            IApplicationPaths applicationPaths,
            IMemoryCache memoryCache,
            IAsyncDelayer delayer) {
            _fileSystem = fileSystem;
            _libraryManager = libraryManager;
            _httpContextAccessor = httpContextAccessor;
            _serverApplicationHost = serverApplicationHost;
            _httpClientFactory = httpClientFactory;
            _applicationPaths = applicationPaths;
            _logger = loggerFactory.CreateLogger<UpdateProviderStatus>();
            _loggerFactory = loggerFactory;
            _memoryCache = memoryCache;
            _delayer = delayer;
            ApiName = ApiName.AniList;
            ApiCallHelpers = new ApiCallHelpers(aniListApiCalls: new AniListApiCalls(_httpClientFactory, _loggerFactory, _serverApplicationHost, _httpContextAccessor, _memoryCache, _delayer, null));
        }


        public async Task Update(BaseItem e, Guid userId, bool playedToCompletion) {
            var video = e as Video;
            if (video == null) return;

            Episode? episode = video as Episode;
            Movie? movie = video as Movie;
            if (video is Episode) {
                _animeType = typeof(Episode);
            } else if (video is Movie) {
                _animeType = typeof(Movie);
                video.IndexNumber = 1;
            }

            _userConfig = Plugin.Instance?.PluginConfiguration.UserConfig.FirstOrDefault(item => item.UserId == userId);
            if (_userConfig == null) {
                _logger.LogWarning($"The user {userId} does not exist in the plugins config file. Skipping");
                return;
            }

            string? directToken = Plugin.Instance?.PluginConfiguration?.AniListBearerToken;
            bool hasAniListAuth = _userConfig.UserApiAuth != null && _userConfig.UserApiAuth.Any(a => a.Name == ApiName.AniList);
            bool hasDirectToken = !string.IsNullOrWhiteSpace(directToken);

            if (!hasAniListAuth && !hasDirectToken) {
                _logger.LogWarning($"The user {userId} is not authenticated via AniList and no global AniList Bearer Token is set. Skipping");
                return;
            }

            if (LibraryCheck(_userConfig, _libraryManager, _fileSystem, _logger, e) && video is Episode or Movie && playedToCompletion) {
                if ((video is Episode && (episode!.IndexNumber == null ||
                                          episode.Season.IndexNumber == null)) ||
                    (video is Movie && movie!.IndexNumber == null)) {
                    _logger.LogError("Video does not contain required index numbers to sync; skipping");
                    return;
                }

                // 1. Grab ProviderIds["AniDB"]
                string? aniDbIdStr = null;
                if (_animeType == typeof(Episode) && episode != null) {
                    if (episode.Series.ProviderIds != null && episode.Series.ProviderIds.TryGetValue("AniDB", out var val)) {
                        aniDbIdStr = val;
                    } else if (episode.Season.ProviderIds != null && episode.Season.ProviderIds.TryGetValue("AniDB", out val)) {
                        aniDbIdStr = val;
                    } else if (episode.ProviderIds != null && episode.ProviderIds.TryGetValue("AniDB", out val)) {
                        aniDbIdStr = val;
                    }
                } else if (_animeType == typeof(Movie) && movie != null) {
                    if (movie.ProviderIds != null && movie.ProviderIds.TryGetValue("AniDB", out var val)) {
                        aniDbIdStr = val;
                    }
                }

                if (string.IsNullOrWhiteSpace(aniDbIdStr) || !int.TryParse(aniDbIdStr, out int aniDbId)) {
                    _logger.LogWarning("No AniDB ID found in provider metadata. Skipping.");
                    return;
                }

                // 2. Call arm-server API to resolve AniList ID
                _logger.LogInformation($"Retrieving provider IDs from offline database for AniDb ID {aniDbId}...");
                _apiIds = await AnimeOfflineDatabaseHelpers.GetProviderIdsFromMetadataProvider(_httpClientFactory.CreateClient(NamedClient.Default), _logger, aniDbId, AnimeOfflineDatabaseHelpers.Source.Anidb);
                
                if (_apiIds == null || _apiIds.Anilist == null || _apiIds.Anilist == 0) {
                    _logger.LogWarning($"Could not resolve AniList ID from AniDB ID {aniDbId} via arm-server API. Skipping.");
                    return;
                }

                int aniListId = _apiIds.Anilist.Value;
                _logger.LogInformation($"Resolved AniList ID: {aniListId}");

                // Hardcode AniList as the only provider
                ApiName = ApiName.AniList;
                _logger.LogInformation($"Using provider AniList...");
                ApiCallHelpers = new ApiCallHelpers(aniListApiCalls: new AniListApiCalls(_httpClientFactory, _loggerFactory, _serverApplicationHost, _httpContextAccessor, _memoryCache, _delayer, _userConfig));

                int? episodeOffset = null; // No longer using XML, default to null
                int episodeNumber = _animeType == typeof(Episode)
                    ? (episodeOffset != null ? episode!.IndexNumber!.Value - episodeOffset.Value : episode!.IndexNumber!.Value)
                    : movie!.IndexNumber!.Value;

                // Sync
                if (_animeType == typeof(Episode) && episode!.Season.IndexNumber!.Value > 1) {
                    // season walking logic
                    _logger.LogInformation($"(AniList) Season being watched is > 1. Walking seasons starting from root {aniListId}...");
                    Anime? matchingAnime = await GetDifferentSeasonAnime(aniListId, episode.Season.IndexNumber.Value);
                    if (matchingAnime == null) {
                        _logger.LogWarning($"(AniList) Could not find next season for AniList ID {aniListId}. Skipping.");
                        return;
                    }
                    _logger.LogInformation($"(AniList) Season being watched is {GetAnimeTitle(matchingAnime)} (ID: {matchingAnime.Id})");
                    await CheckUserListAnimeStatus(matchingAnime.Id, episodeNumber, overrideCheckRewatch: false, alternativeId: matchingAnime.AlternativeId);
                } else {
                    await CheckUserListAnimeStatus(aniListId, episodeNumber, overrideCheckRewatch: false);
                }
            }
        }

        private static string GetAnimeTitle(Anime anime) {
            var title = string.IsNullOrWhiteSpace(anime.Title)
                ? anime.AlternativeTitles.Synonyms.Count > 0
                    ? anime.AlternativeTitles.Synonyms[0]
                    : anime.AlternativeTitles.Ja
                : anime.Title;
            return title;
        }

        public static bool LibraryCheck(UserConfig userConfig, ILibraryManager libraryManager, IFileSystem fileSystem, ILogger logger, BaseItem item) {
            try {
                // user has no library filters
                if (userConfig.LibraryToCheck is { Length: 0 }) {
                    return true;
                }

                // item is in a path of a folder the user wants to be monitored
                var topParent = item.GetTopParent();
                if (topParent is not null) {
                    var allLocations = libraryManager.GetVirtualFolders()
                        .Where(item => userConfig.LibraryToCheck.Contains(item.ItemId))
                        .SelectMany(f => f.Locations)
                        .ToHashSet();
                    if (allLocations.Contains(topParent.Path)) {
                        return true;
                    }
                }

                logger.LogInformation("Item is in a folder the user does not want to be monitored; ignoring");
                return false;
            } catch (Exception e) {
                logger.LogInformation($"Library check ran into an issue: {e.Message}");
                return false;
            }
        }

        private async Task CheckUserListAnimeStatus(int matchingAnimeId, int episodeNumber, bool overrideCheckRewatch, string? alternativeId = null) {
            Anime detectedAnime = await GetAnime(matchingAnimeId, alternativeId: alternativeId);
            await CheckUserListAnimeStatusBase(detectedAnime, episodeNumber, overrideCheckRewatch, alternativeId);
        }

        private async Task CheckUserListAnimeStatusBase(Anime detectedAnime, int episodeNumber, bool overrideCheckRewatch, string? alternativeId = null) {
            if (detectedAnime == null) return;
            if (detectedAnime.MyListStatus != null && detectedAnime.MyListStatus.Status == Status.Watching) {
                _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) found on watching list");
                await UpdateAnimeStatus(detectedAnime, episodeNumber);
                return;
            }

            // only plan to watch
            if (_userConfig!.PlanToWatchOnly) {
                if (detectedAnime.MyListStatus != null && detectedAnime.MyListStatus.Status == Status.Plan_to_watch) {
                    _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) found on plan to watch list");
                    await UpdateAnimeStatus(detectedAnime, episodeNumber);
                }

                _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) not found in plan to watch list{(_userConfig.RewatchCompleted ? ", checking completed list.." : null)}");
                await CheckIfRewatchCompleted(detectedAnime, episodeNumber, overrideCheckRewatch);

                return;
            }

            _logger.LogInformation("User does not have plan to watch only ticked");

            // check if rewatch completed is checked
            if (await CheckIfRewatchCompleted(detectedAnime, episodeNumber, overrideCheckRewatch)) {
                return;
            }

            // everything else
            if (detectedAnime.MyListStatus != null) {
                // anime is on user list
                _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) found on {detectedAnime.MyListStatus.Status} list");
                if (detectedAnime.MyListStatus.Status == Status.Completed) {
                    _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) found on Completed list, but user does not want to automatically set as rewatching. Skipping");
                    return;
                }
            } else {
                _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) not on user list");
            }

            await UpdateAnimeStatus(detectedAnime, episodeNumber);
        }

        private async Task<bool> CheckIfRewatchCompleted(Anime detectedAnime, int indexNumber, bool overrideCheckRewatch) {
            // REPEATING is AniList's status for an anime that is already being rewatched.
            // RewatchCompleted controls promotion from COMPLETED to REPEATING; it must not
            // prevent progress updates for an entry that is already REPEATING.
            if (overrideCheckRewatch || detectedAnime.MyListStatus is { Status: Status.Completed }) {
                if (_userConfig!.RewatchCompleted) {
                    if (detectedAnime.MyListStatus != null && detectedAnime.MyListStatus.Status == Status.Completed) {
                        _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) found on completed list, setting as re-watching");
                        await UpdateAnimeStatus(detectedAnime, indexNumber, true, detectedAnime.MyListStatus.RewatchCount, true);
                        return true;
                    }
                } else {
                    _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) found on Completed list, but user does not want to automatically set as rewatching. Skipping");
                    return true;
                }
            } else if (detectedAnime.MyListStatus is { Status: Status.Rewatching }) {
                if (detectedAnime.MyListStatus.NumEpisodesWatched >= indexNumber) {
                    _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) found, but provider reports episode already watched. Skipping");
                    return true;
                }

                // An existing REPEATING entry should continue through to UpdateAnimeStatus,
                // regardless of the PlanToWatchOnly setting.
                return false;
            } else if (detectedAnime.MyListStatus != null && detectedAnime.MyListStatus.NumEpisodesWatched >= indexNumber) {
                _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) found, but provider reports episode already watched. Skipping");
                return true;
            } else if (_userConfig!.PlanToWatchOnly) {
                _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) found, but not on completed or plan to watch list. Skipping");
                return true;
            }

            return false;
        }

        private async Task<Anime> GetAnime(int animeId, Status? status = null, string? alternativeId = null) {
            Anime anime = await ApiCallHelpers.GetAnime(animeId, alternativeId: alternativeId);

            if (anime != null && ((status != null && anime.MyListStatus != null && anime.MyListStatus.Status == status) || status == null)) {
                return anime;
            }

            return null!;
        }

        internal async Task UpdateAnimeStatus(Anime detectedAnime, int? episodeNumber, bool? setRewatching = null, int? rewatchCount = null, bool firstTimeRewatch = false) {
            if (episodeNumber != null) {
                UpdateAnimeStatusResponse? response = null;
                if (detectedAnime.MyListStatus != null) {
                    if (detectedAnime.MyListStatus.NumEpisodesWatched < episodeNumber.Value || detectedAnime.NumEpisodes == 1 ||
                        (setRewatching != null && setRewatching.Value && detectedAnime.MyListStatus.NumEpisodesWatched == episodeNumber.Value)) {
                        // covers the very rare occurence of re-watching the show and starting at the last episode
                        // movie or ova has only one episode, so just mark it as finished
                        if (episodeNumber.Value == detectedAnime.NumEpisodes || detectedAnime.NumEpisodes == 1) {
                            // either watched all episodes or the anime only has a single episode (ova)
                            if (detectedAnime.NumEpisodes == 1) {
                                // its a movie or ova since it only has one "episode", so the start and end date is the same
                                response = await ApiCallHelpers.UpdateAnime(detectedAnime.Id,
                                    1,
                                    Status.Completed,
                                    startDate: detectedAnime.MyListStatus.IsRewatching || detectedAnime.MyListStatus.Status == Status.Completed ? null : DateTime.Now,
                                    endDate: detectedAnime.MyListStatus.IsRewatching || detectedAnime.MyListStatus.Status == Status.Completed ? null : DateTime.Now,
                                    isRewatching: false,
                                    numberOfTimesRewatched: (setRewatching != null && setRewatching.Value) || detectedAnime.MyListStatus.IsRewatching ? detectedAnime.MyListStatus.RewatchCount + 1 : null,
                                    alternativeId: detectedAnime.AlternativeId,
                                    ids: _apiIds,
                                    isShow: _animeType == typeof(Episode));
                            } else {
                                // user has reached the number of episodes in the anime, set as completed
                                response = await ApiCallHelpers.UpdateAnime(detectedAnime.Id,
                                    episodeNumber.Value,
                                    Status.Completed,
                                    endDate: detectedAnime.MyListStatus.IsRewatching || detectedAnime.MyListStatus.Status == Status.Completed ? null : DateTime.Now,
                                    isRewatching: false,
                                    numberOfTimesRewatched: (setRewatching != null && setRewatching.Value) || detectedAnime.MyListStatus.IsRewatching ? detectedAnime.MyListStatus.RewatchCount + 1 : null,
                                    alternativeId: detectedAnime.AlternativeId,
                                    ids: _apiIds,
                                    isShow: _animeType == typeof(Episode));
                            }

                            _logger.LogInformation($"({ApiName}) {(_animeType == typeof(Episode) ? "Series" : "Movie")} ({GetAnimeTitle(detectedAnime)}) complete, marking anime as complete");
                        } else {
                            if (episodeNumber > 1) {
                                // don't set start date after first episode
                                response = await ApiCallHelpers.UpdateAnime(detectedAnime.Id,
                                    episodeNumber.Value,
                                    detectedAnime.MyListStatus.IsRewatching ? Status.Rewatching : Status.Watching,
                                    alternativeId: detectedAnime.AlternativeId,
                                    ids: _apiIds,
                                    isShow: _animeType == typeof(Episode));
                            } else {
                                _logger.LogInformation($"({ApiName}) Setting new {(_animeType == typeof(Episode) ? "series" : "movie")} ({GetAnimeTitle(detectedAnime)}) as watching.");
                                response = await ApiCallHelpers.UpdateAnime(detectedAnime.Id,
                                    episodeNumber.Value,
                                    Status.Watching,
                                    startDate: DateTime.Now,
                                    alternativeId: detectedAnime.AlternativeId,
                                    ids: _apiIds,
                                    isShow: _animeType == typeof(Episode));
                            }
                        }

                        if (response != null) {
                            _logger.LogInformation($"({ApiName}) Updated {(_animeType == typeof(Episode) ? "series" : "movie")} ({GetAnimeTitle(detectedAnime)}) progress to {episodeNumber.Value}");
                        } else {
                            _logger.LogError($"({ApiName}) Could not update anime status");
                        }
                    } else {
                        if (setRewatching != null && setRewatching.Value) {
                            _logger.LogInformation($"({ApiName}) Series ({GetAnimeTitle(detectedAnime)}) has already been watched, marking anime as re-watching; progress of {episodeNumber.Value}");
                            response = await ApiCallHelpers.UpdateAnime(detectedAnime.Id,
                                episodeNumber.Value,
                                Status.Completed,
                                true,
                                alternativeId: detectedAnime.AlternativeId,
                                ids: _apiIds,
                                isShow: _animeType == typeof(Episode));
                            
                            response = await ApiCallHelpers.UpdateAnime(detectedAnime.Id,
                                episodeNumber.Value,
                                Status.Completed,
                                true,
                                ids: _apiIds,
                                isShow: _animeType == typeof(Episode));
                        } else {
                            _logger.LogInformation($"({ApiName}) Provider reports episode already watched; not updating");
                        }
                    }
                } else {
                    // status is not set, must be a new anime
                    if (episodeNumber.Value == detectedAnime.NumEpisodes) {
                        // anime completed all at once or user has watched last episode
                        _logger.LogInformation($"({ApiName}) Adding new {(_animeType == typeof(Episode) ? "series" : "movie")} ({GetAnimeTitle(detectedAnime)}) to user list as completed with a progress of {episodeNumber.Value}");
                        response = await ApiCallHelpers.UpdateAnime(detectedAnime.Id,
                            episodeNumber.Value,
                            Status.Completed,
                            alternativeId: detectedAnime.AlternativeId,
                            ids: _apiIds,
                            startDate: DateTime.Now,
                            endDate: DateTime.Now,
                            isShow: _animeType == typeof(Episode));
                    } else {
                        // not on last episodes so must still be watching
                        _logger.LogInformation($"({ApiName}) Adding new {(_animeType == typeof(Episode) ? "series" : "movie")} ({GetAnimeTitle(detectedAnime)}) to user list as watching with a progress of {episodeNumber.Value}");
                        response = await ApiCallHelpers.UpdateAnime(detectedAnime.Id,
                            episodeNumber.Value,
                            Status.Watching,
                            alternativeId: detectedAnime.AlternativeId,
                            ids: _apiIds,
                            startDate: episodeNumber == 1 ? DateTime.Now : null,
                            isShow: _animeType == typeof(Episode));
                    }
                }

                if (response == null) {
                    _logger.LogError($"({ApiName}) Could not update anime status");
                }
            }
        }

        internal async Task<Anime?> GetDifferentSeasonAnime(int animeId, int seasonNumber, string? alternativeId = null) {
            _logger.LogInformation($"({ApiName}) Attempting to get season 1...");
            Anime retrievedSeason = await ApiCallHelpers.GetAnime(animeId, getRelated: true, alternativeId: alternativeId);

            if (retrievedSeason != null) {
                int i = 1;
                while (i != seasonNumber) {
                    RelatedAnime? initialSeasonRelatedAnime = retrievedSeason.RelatedAnime?.FirstOrDefault(item => item.RelationType == RelationType.Sequel);
                    if (initialSeasonRelatedAnime != null) {
                        _logger.LogInformation($"({ApiName}) Attempting to get season {i + 1}...");
                        Anime nextSeason = await ApiCallHelpers.GetAnime(initialSeasonRelatedAnime.Anime.Id, getRelated: true, alternativeId: initialSeasonRelatedAnime.Anime.AlternativeId);

                        if (nextSeason != null) {
                            retrievedSeason = nextSeason;
                        }
                    } else {
                        _logger.LogInformation($"({ApiName}) Could not find any related anime sequel");
                        return null;
                    }

                    i++;
                }

                return retrievedSeason;
            }

            return null;
        }
    }
}
