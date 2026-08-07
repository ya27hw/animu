#nullable enable
using System;
using System.Linq;
using jellyfin_ani_sync.Configuration;
using jellyfin_ani_sync.Models;
using Microsoft.Extensions.Logging;

namespace jellyfin_ani_sync.Helpers;

public class ConfigHelper {
    /// <summary>
    /// Deauthenticate a user.
    /// </summary>
    /// <param name="userId">ID of the user you want to deauthenticate.</param>
    /// <param name="provider">Provider you want to deauthenticate from the user.</param>
    /// <returns>True if successful, false if unsuccessful and the reason why.</returns>
    public static (bool success, string? reason) DeauthenticateUser(Guid userId, ApiName provider) {
        if (Plugin.Instance == null) return (false, "Plugin instance null.");
        UserConfig? userConfig = Plugin.Instance.PluginConfiguration?.UserConfig?.FirstOrDefault(userConfig => userConfig.UserId == userId);

        if (userConfig == null) return (false, "User configuration not found.");
        userConfig.UserApiAuth = userConfig.UserApiAuth.Where(userApiAuth => userApiAuth.Name != provider).ToArray();
        Plugin.Instance.SaveConfiguration();
        return (true,  null);
    }
}