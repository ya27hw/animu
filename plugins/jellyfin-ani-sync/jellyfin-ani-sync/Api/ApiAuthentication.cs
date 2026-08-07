#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Authentication;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
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
    public class ApiAuthentication {
        private ApiName _provider;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<ApiAuthentication> _logger;
        private readonly string _authApiUrl;
        private readonly string _redirectUrl;
        private readonly ProviderApiAuth _providerApiAuth;
        private readonly IMemoryCache  _memoryCache;
        private readonly IAsyncDelayer _delayer;

        public ApiAuthentication(ApiName provider, IHttpClientFactory httpClientFactory, IServerApplicationHost serverApplicationHost, IHttpContextAccessor httpContextAccessor, ILoggerFactory loggerFactory, IMemoryCache memoryCache, IAsyncDelayer delayer, ProviderApiAuth? overrideProviderApiAuth = null, string? overrideRedirectUrl = null) {
            _provider = provider;

            switch (provider) {
                case ApiName.AniList:
                    _authApiUrl = "https://anilist.co/api/v2/oauth";
                    break;
                default:
                    throw new ArgumentOutOfRangeException(nameof(provider), provider, null);
            }

            _httpClientFactory = httpClientFactory;
            _memoryCache = memoryCache;
            _logger = loggerFactory.CreateLogger<ApiAuthentication>();
            _delayer = delayer;
            if (overrideProviderApiAuth != null) {
                _providerApiAuth = overrideProviderApiAuth;
            } else {
                _providerApiAuth = Plugin.Instance?.PluginConfiguration.ProviderApiAuth?.FirstOrDefault(item => item.Name == _provider) ?? throw new NullReferenceException($"No {provider} provider API auth in plugin config");
            }

            var userCallbackUrl = Plugin.Instance.PluginConfiguration.callbackUrl;
            if (overrideRedirectUrl != null && overrideRedirectUrl != "local") {
                _redirectUrl = overrideRedirectUrl + "/AniSync/authCallback";
            } else {
                if (overrideRedirectUrl is "local" && httpContextAccessor.HttpContext != null) {
                    _redirectUrl = serverApplicationHost.ListenWithHttps ? $"https://{httpContextAccessor.HttpContext.Connection.LocalIpAddress}:{serverApplicationHost.HttpsPort}/AniSync/authCallback" : $"http://{httpContextAccessor.HttpContext.Connection.LocalIpAddress}:{serverApplicationHost.HttpPort}/AniSync/authCallback";
                } else {
                    if (userCallbackUrl != null) {
                        _redirectUrl = userCallbackUrl + "/AniSync/authCallback";
                    } else if (httpContextAccessor.HttpContext != null) {
                        _redirectUrl = serverApplicationHost.ListenWithHttps ? $"https://{httpContextAccessor.HttpContext.Connection.LocalIpAddress}:{serverApplicationHost.HttpsPort}/AniSync/authCallback" : $"http://{httpContextAccessor.HttpContext.Connection.LocalIpAddress}:{serverApplicationHost.HttpPort}/AniSync/authCallback";
                    }
                }
            }
        }

        public string BuildAuthorizeRequestUrl(Guid userId) {
            string state = MemoryCacheHelper.GenerateState(_memoryCache, userId, _provider);
            switch (_provider) {
                case ApiName.AniList:
                    return $"{_authApiUrl}/authorize?response_type=code&client_id={_providerApiAuth.ClientId}&redirect_uri={_redirectUrl}&state={state}";
                default:
                    throw new ArgumentOutOfRangeException();
            }
        }

        public async Task<UserApiAuth> GetToken(Guid userId, string? code = null, string? refreshToken = null) {
            var client = _httpClientFactory.CreateClient(NamedClient.Default);
            HttpContent formUrlEncodedContent;

            if (refreshToken != null) {
                formUrlEncodedContent = new FormUrlEncodedContent(new[] {
                    new KeyValuePair<string, string>("client_id", _providerApiAuth.ClientId),
                    new KeyValuePair<string, string>("client_secret", _providerApiAuth.ClientSecret),
                    new KeyValuePair<string, string>("grant_type", "refresh_token"),
                    new KeyValuePair<string, string>("refresh_token", refreshToken)
                });
            } else {
                List<KeyValuePair<string, string>> content = new List<KeyValuePair<string, string>>() {
                    new KeyValuePair<string, string>("client_id", _providerApiAuth.ClientId),
                    new KeyValuePair<string, string>("client_secret", _providerApiAuth.ClientSecret),
                    new KeyValuePair<string, string>("code", code),
                    new KeyValuePair<string, string>("grant_type", "authorization_code"),
                    new KeyValuePair<string, string>("redirect_uri", _redirectUrl)
                };
                formUrlEncodedContent = new FormUrlEncodedContent(content.ToArray());
            }

            await MemoryCacheHelper.CheckRateLimiting(_provider, _logger, _memoryCache, _delayer);
            var response = await client.PostAsync(new Uri($"{_authApiUrl}/token"), formUrlEncodedContent);
            MemoryCacheHelper.CheckResponseHeadersForRateLimiting(response, _logger, _provider, _memoryCache);
            
            if (response.IsSuccessStatusCode) {
                var content = await response.Content.ReadAsStreamAsync();
                StreamReader streamReader = new StreamReader(content);
                TokenResponse tokenResponse = JsonSerializer.Deserialize<TokenResponse>(streamReader.ReadToEnd());

                UserConfig? pluginConfig = Plugin.Instance.PluginConfiguration?.UserConfig?.FirstOrDefault(item => item.UserId == userId);

                if (pluginConfig != null) {
                    var apiAuth = pluginConfig.UserApiAuth?.FirstOrDefault(item => item.Name == _provider);

                    UserApiAuth newUserApiAuth = new UserApiAuth {
                        Name = _provider,
                        AccessToken = tokenResponse.access_token,
                        RefreshToken = tokenResponse.refresh_token
                    };

                    if (apiAuth != null) {
                        apiAuth.AccessToken = tokenResponse.access_token;
                        apiAuth.RefreshToken = tokenResponse.refresh_token;
                    } else {
                        pluginConfig.AddUserApiAuth(newUserApiAuth);
                    }

                    Plugin.Instance.SaveConfiguration();
                    return newUserApiAuth;
                }

                throw new NullReferenceException("The user you are attempting to authenticate does not exist in the plugins config file");
            }

            throw new AuthenticationException($"Could not retrieve {_provider} token: " + response.StatusCode + " - " + await response.Content.ReadAsStringAsync());
        }
    }

    public class TokenResponse {
        public string access_token { get; set; } = string.Empty;
        public string refresh_token { get; set; } = string.Empty;
    }
}