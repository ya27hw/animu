using System;
using System.Text.Json.Serialization;

namespace jellyfin_ani_sync.Api {
    public class MalApiCalls {
        public class User {
            [JsonPropertyName("id")] public int Id { get; set; }
            [JsonPropertyName("name")] public string Name { get; set; }
            [JsonPropertyName("location")] public string Location { get; set; }
            [JsonPropertyName("joined_at")] public DateTime JoinedAt { get; set; }
            [JsonPropertyName("picture")] public string Picture { get; set; }
        }
    }
}
