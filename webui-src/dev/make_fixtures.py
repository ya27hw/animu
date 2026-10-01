"""Builds dev/fixtures.json from AniList's public API plus synthetic scheduler state.

Only used by `npm run dev:mock` so the UI can be developed without PocketBase,
qBittorrent or an AniList login. Run: python3 dev/make_fixtures.py
"""
import json, random, time, urllib.request

random.seed(7)
Q = """query($p:Int,$sort:[MediaSort],$status:MediaStatus){Page(page:$p,perPage:36){media(type:ANIME,sort:$sort,status:$status,isAdult:false){
id title{romaji english native} coverImage{medium large extraLarge color} bannerImage episodes status format genres averageScore popularity description(asHtml:false)
season seasonYear nextAiringEpisode{id episode timeUntilAiring airingAt} synonyms}}}"""

def gql(variables):
    req = urllib.request.Request("https://graphql.anilist.co", data=json.dumps({"query": Q, "variables": variables}).encode(),
                                 headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "animu-dev-fixtures/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=30))["data"]["Page"]["media"]

releasing = gql({"p": 1, "sort": ["POPULARITY_DESC"], "status": "RELEASING"})
trending = gql({"p": 1, "sort": ["TRENDING_DESC"]})
popular = gql({"p": 1, "sort": ["POPULARITY_DESC"]})
upcoming = gql({"p": 1, "sort": ["POPULARITY_DESC"], "status": "NOT_YET_RELEASED"})
top = gql({"p": 1, "sort": ["SCORE_DESC"]})

now = time.time()
states = ["downloaded", "up_to_date", "up_to_date", "up_to_date", "waiting_release", "not_found", "backoff",
          "up_to_date", "downloaded", "search_error", "up_to_date", "error", "up_to_date", "backoff"]
anime = []
for i, m in enumerate(releasing[:14]):
    nxt = m.get("nextAiringEpisode") or {"episode": (m["episodes"] or 12) + 1, "timeUntilAiring": 86400 * random.randint(1, 6)}
    aired = max(1, nxt["episode"] - 1)
    state = states[i % len(states)]
    progress = max(0, aired - random.randint(0, 3))
    dl = list(range(1, aired + 1))
    if state in ("not_found", "backoff", "waiting_release"):
        dl = [e for e in dl if e != aired]
    if state == "not_found":
        dl = [e for e in dl if e < aired - 1]
    detail = {"downloaded": f"episode(s) {aired}", "waiting_release": f"episode {aired} aired recently; retrying in 10 min",
              "not_found": "retrying at 21:40", "backoff": "next attempt in 95 min", "search_error": "Nyaa did not return a usable feed",
              "error": "KeyError: 'romaji'"}.get(state, "")
    entry = {
        "mediaId": m["id"], "progress": progress, "downloadedEpisodes": dl,
        "preferredReleaseGroup": random.choice([None, None, "SubsPlease", "Erai-raws"]), "releaseGroupMisses": 0,
        "requireJapaneseAudio": False, "requireEnglishSubs": i % 5 == 0,
        "airedEpisodes": aired, "nextAirAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + nxt["timeUntilAiring"])),
        "state": state, "stateDetail": detail,
        "nextAttemptAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + 5400)) if state in ("backoff", "not_found") else None,
        "timeouts": 3 if state in ("not_found", "backoff") else 0, "maxTimeouts": 3 if state in ("not_found", "backoff") else 0,
        "media": {**{k: m[k] for k in ("coverImage", "genres", "format", "episodes", "status", "synonyms", "title")},
                  "nextAiringEpisode": nxt, "alternativeTitle": None, "startingEpisode": 0,
                  "preferredReleaseGroup": None, "requireJapaneseAudio": False, "requireEnglishSubs": False},
    }
    anime.append(entry)

def slim(m):
    return {k: m.get(k) for k in ("id", "title", "coverImage", "bannerImage", "episodes", "status", "format", "genres",
                                  "averageScore", "season", "seasonYear", "nextAiringEpisode", "description")}

def local(mid):
    tracked = any(a["mediaId"] == mid for a in anime)
    return {"tracked": tracked, "downloadedEpisodes": [], "alternativeTitle": None, "startingEpisode": 0, "timeouts": 0}

def rail(items):
    return [{**slim(m), "localState": local(m["id"])} for m in items[:12]]

fx = {
    "anime": anime,
    "rails": {"trending": rail(trending), "popular": rail(popular), "upcoming": rail(upcoming), "top": rail(top),
              "seasonal": rail(releasing[14:])},
    "detail": {str(m["id"]): {**slim(m), "localState": local(m["id"])} for m in releasing + trending + popular + upcoming + top},
    "airing_today": [{"mediaId": a["mediaId"], "title": a["media"]["title"]["romaji"], "romaji": a["media"]["title"]["romaji"],
                      "english": a["media"]["title"].get("english"), "coverImage": a["media"]["coverImage"]["large"],
                      "episode": a["airedEpisodes"] + 1, "airingAt": int(now + a["media"]["nextAiringEpisode"]["timeUntilAiring"]),
                      "timeUntilAiring": a["media"]["nextAiringEpisode"]["timeUntilAiring"], "progress": a["progress"]}
                     for a in anime[:8]],
}
json.dump(fx, open("dev/fixtures.json", "w"), separators=(",", ":"))
print("anime", len(anime), "rails", {k: len(v) for k, v in fx["rails"].items()}, "bytes", len(json.dumps(fx)))
