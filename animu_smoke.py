from types import SimpleNamespace
import sys

sys.path.insert(0, ".")

from animu.nyaa import NyaaClient
import animu.nyaa as nyaa_mod
import animu.utils as utils_mod

config = SimpleNamespace(
    nyaa_url="https://nyaa.si",
    alt_nyaa_url="https://nyaa.si",
    use_proxy=False,
    proxy_address="",
    proxy_port=None,
    resolution="1080p",
    exclude_release_groups=[],
    trigger_genre="Ecchi",
)

nyaa_mod.get_config = lambda: config
utils_mod.get_config = lambda: config

client = NyaaClient()
client.should_use_proxy_download = lambda anime: False
client.get_episode_air_dates = lambda media_id, episode_list, offset: {"nodes": [{"episode": episode_list[0], "airingAt": 0}]}

candidate = {
    "title": "[SubsPlease] Hyakkano - 25 (1080p) [17F5B72C].mkv",
    "link": "https://example.invalid/torrent",
    "nyaa:seeders": "123",
    "pubDate": "Tue, 28 Jul 2026 00:00:00 GMT",
    "guid": "guid-1",
}

queries = []

def fake_fetch(query, url, enable_proxy):
    queries.append(query)
    return {"status": 200, "data": [candidate]}

client.fetch_rss_feed = fake_fetch
anime = {
    "mediaId": 777,
    "media": {"title": {"romaji": "Hyakkano"}, "genres": []},
}

for starting_episode, expected_query_episode in [(0, 1), (1, 1), (25, 25)]:
    for alt_title in (None, "Hyakkano Alt"):
        queries.clear()
        results = client.search_episode_candidates(
            anime,
            episode=1,
            starting_episode=starting_episode,
            alt_anime_title=alt_title,
        )
        expected_query = f'{alt_title or "Hyakkano"} "{expected_query_episode:02d}"'
        assert queries == [expected_query], (queries, expected_query)
        assert results and results[0]["episode"] == 1, results
        assert results[0]["score"] > 0, results

print("SMOKE_OK")
