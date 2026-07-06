#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using jellyfin_ani_sync.Configuration;
using jellyfin_ani_sync.Helpers;
using jellyfin_ani_sync.Interfaces;
using jellyfin_ani_sync.Models;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace jellyfin_ani_sync.Api {
    public class AuthApiCall {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IServerApplicationHost _serverApplicationHost;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ILoggerFactory _loggerFactory;
        private readonly ILogger<AuthApiCall> _logger;
        private readonly IMemoryCache _memoryCache;
        private readonly IAsyncDelayer _delayer;
        public UserConfig UserConfig { get; set; }
        private static readonly int Default429Timeout = 20;
        private static readonly int TimeoutIncrementMultiplier = 2;

        public AuthApiCall(IHttpClientFactory httpClientFactory,
            IServerApplicationHost serverApplicationHost,
            IHttpContextAccessor httpContextAccessor,
            ILoggerFactory loggerFactory,
            IMemoryCache memoryCache,
            IAsyncDelayer delayer,
            UserConfig userConfig) {
            _httpClientFactory = httpClientFactory;
            _serverApplicationHost = serverApplicationHost;
            _httpContextAccessor = httpContextAccessor;
            _loggerFactory = loggerFactory;
            _logger = loggerFactory.CreateLogger<AuthApiCall>();
            _memoryCache = memoryCache;
            _delayer = delayer;
            UserConfig = userConfig;
        }

        public async Task<HttpResponseMessage?> AuthenticatedApiCall(ApiName provider, CallType callType, string url, FormUrlEncodedContent? formUrlEncodedContent = null, StringContent? stringContent = null, Dictionary<string, string>? requestHeaders = null) {
            int attempts = 0;
            int timeoutSeconds = Default429Timeout;

            string? directToken = Plugin.Instance?.PluginConfiguration?.AniListBearerToken;
            string? tokenToUse = null;
            UserApiAuth? auth = null;

            if (provider == ApiName.AniList && !string.IsNullOrWhiteSpace(directToken)) {
                tokenToUse = directToken;
            } else {
                auth = UserConfig?.UserApiAuth?.FirstOrDefault(item => item.Name == provider);
                if (auth == null) {
                    _logger.LogError("Could not find authentication details, please authenticate the plugin first");
                    return null;
                }
                tokenToUse = auth.AccessToken;
            }

            var client = _httpClientFactory.CreateClient(NamedClient.Default);
            while (attempts < 3) {
                await MemoryCacheHelper.CheckRateLimiting(provider, _logger, _memoryCache, _delayer);
                if (requestHeaders != null) {
                    foreach (KeyValuePair<string, string> requestHeader in requestHeaders) {
                        client.DefaultRequestHeaders.Add(requestHeader.Key, requestHeader.Value);
                    }
                }

                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenToUse);
                HttpResponseMessage responseMessage = new HttpResponseMessage();
                try {
                    MemoryCacheHelper.SetRateLimitingForProvider(provider, _memoryCache);
                    switch (callType) {
                        case CallType.GET:
                            responseMessage = await client.GetAsync(url);
                            break;
                        case CallType.POST:
                            responseMessage = await client.PostAsync(url, formUrlEncodedContent != null ? formUrlEncodedContent : stringContent);
                            break;
                        case CallType.PATCH:
                            responseMessage = await client.PatchAsync(url, formUrlEncodedContent != null ? formUrlEncodedContent : stringContent);
                            break;
                        case CallType.PUT:
                            responseMessage = await client.PutAsync(url, formUrlEncodedContent);
                            break;
                        case CallType.DELETE:
                            responseMessage = await client.DeleteAsync(url);
                            break;
                        default:
                            responseMessage = await client.GetAsync(url);
                            break;
                    }
                } catch (Exception e) {
                    _logger.LogError(e.Message);
                }

                MemoryCacheHelper.CheckResponseHeadersForRateLimiting(responseMessage, _logger, provider, _memoryCache);

                if (responseMessage.IsSuccessStatusCode) {
                    return responseMessage;
                } else {
                    switch (responseMessage.StatusCode) {
                        case HttpStatusCode.Unauthorized:
                            if (provider == ApiName.AniList && !string.IsNullOrWhiteSpace(directToken)) {
                                _logger.LogError("Direct AniList Bearer Token was rejected (Unauthorized). Please update it in the configuration.");
                                return null;
                            }
                            if (auth == null) {
                                _logger.LogError("User API auth is missing; cannot refresh token.");
                                return null;
                            }
                            // token has probably expired; try refreshing it
                            UserApiAuth newAuth;
                            try {
                                newAuth = await new ApiAuthentication(provider, _httpClientFactory, _serverApplicationHost, _httpContextAccessor, _loggerFactory, _memoryCache, _delayer).GetToken(UserConfig.UserId, refreshToken: auth.RefreshToken);
                            } catch (Exception e) {
                                _logger.LogError($"Could not re-authenticate: {e.Message}, please manually re-authenticate the user via the Ani-Sync configuration page");
                                return null;
                            }

                            auth = newAuth;
                            tokenToUse = auth.AccessToken;
                            attempts++;
                            break;
                        case HttpStatusCode.TooManyRequests:
                            _logger.LogWarning($"({provider}) API rate limit exceeded, retrying the API call again in {timeoutSeconds} seconds...");
                            MemoryCacheHelper.SetRateLimitingForProvider(provider, _memoryCache, TimeSpan.FromSeconds(timeoutSeconds));
                            timeoutSeconds *= TimeoutIncrementMultiplier;
                            attempts++;
                            continue;
                        default:
                            _logger.LogError($"Unable to complete {provider} API call ({callType.ToString()} {url}), reason: {responseMessage.StatusCode}, content: \n{await responseMessage.Content.ReadAsStringAsync()}");
                            return null;
                    }
                }
            }

            _logger.LogError("Unable to authenticate the API call, re-authenticate the plugin");
            return null;
        }

        public enum CallType {
            GET,
            POST,
            PATCH,
            PUT,
            DELETE
        }
    }
}