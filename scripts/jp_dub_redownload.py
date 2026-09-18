#!/usr/bin/env python3
"""Re-download an anime's episodes that are not Japanese-dubbed (with English subs).

Inventories qBittorrent for the anime, classifies every downloaded release by its
release name (see ``animu/release_tracks.py``), and replaces the ones that cannot
be shown to contain the Japanese dub — optionally requiring declared English
subtitles — with the best qualifying Nyaa release.

Safety properties, deliberately chosen:
  * ``--dry-run`` is the default; ``--apply`` is required to change anything.
  * A replacement torrent is added *before* the wrong release is deleted, so a
    failed add never leaves an episode without a file.
  * Torrent matching is fail-closed: a release whose torrent cannot be found, or
    whose name matches more than one torrent, is reported and skipped, never
    deleted.
  * **qBittorrent stores the renamed display name, not the Nyaa release name.**
    ``QbitClient.add_torrent`` passes ``rename=f"{title} - {episode}"`` to the add
    API, so a Tomb Raider King episode 5 torrent appears in the queue as
    ``Tomb Raider King - 5``. The release title therefore only survives in
    ``logs/history.json`` — that is what the classification reads, and the episode
    match below uses the display name plus the save path.
  * Episodes already satisfying the requirements are left alone.

Usage::

    python3 scripts/jp_dub_redownload.py --media-id 184356
    python3 scripts/jp_dub_redownload.py --media-id 184356 --apply
    python3 scripts/jp_dub_redownload.py --media-id 184356 --enroll --apply
    python3 scripts/jp_dub_redownload.py --media-id 184356 --list-queue
"""

import argparse
import json
import os
import re
import sys

import anitopy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from animu.config import get_config                      # noqa: E402
from animu.database import db                            # noqa: E402
from animu.history import history_manager                # noqa: E402
from animu.nyaa import nyaa                              # noqa: E402
from animu.prefs import release_prefs, get_requirements  # noqa: E402
from animu.qbittorrent import qbit                       # noqa: E402
from animu.release_tracks import (                       # noqa: E402
    AUDIO_MULTI,
    SUB_ENG_DECLARED,
    detect_audio_language,
    detect_subtitle_language,
)

def _episode_token_re(episode):
    """Regex matching an episode number in a qBittorrent display name or release name.

    Percent-formatting is used deliberately: the pattern contains ``{1,2}`` quantifiers,
    which ``str.format`` would try to interpret as a field name.
    """
    return re.compile(r'(?:S\d{1,2}E|E|Ep\s*|-\s*)0*%d(?!\d)' % episode, re.IGNORECASE)


def _use_proxy(media_id):
    """Whether downloads for this anime must go through the proxy (Ecchi rule)."""
    try:
        from animu.anilist import anilist
        for entry in anilist.get_anime_user_list() or []:
            if entry.get("mediaId") == media_id:
                return nyaa.should_use_proxy_download(entry)
    except Exception as exc:
        print(f"Could not resolve proxy requirement for {media_id}: {exc}")
    return False


def _tracking_titles(media_id, explicit_titles):
    """Titles this anime is downloaded under (explicit first, then the DB record)."""
    titles = [t for t in explicit_titles if t]
    record = db.get(media_id)
    if record is not None:
        for candidate in (record.alternative_title,):
            if candidate and candidate not in titles:
                titles.append(candidate)
    return titles


def _history_by_episode(titles):
    """Newest recorded release title per episode for this anime."""
    wanted = [t.strip().lower() for t in titles]
    by_episode = {}
    for entry in history_manager.get_all():
        anime_title = str(entry.get("anime_title") or "").strip().lower()
        if anime_title not in wanted:
            continue
        episode = entry.get("episode")
        if episode is None:
            continue
        try:
            episode = int(episode)
        except (TypeError, ValueError):
            continue
        previous = by_episode.get(episode)
        if previous is None or str(entry.get("added_at") or "") >= str(previous.get("added_at") or ""):
            by_episode[episode] = entry
    return by_episode


def _match_torrents(torrents, save_title, release_title, episode):
    """Find the qBittorrent torrent for one episode.

    Returns ``(matches, status, reason)`` where status is ``ok``, ``missing`` or
    ``ambiguous``. Matching is fail-closed: anything that is not a single
    unambiguous torrent is reported and never deleted.

    Two stages, because qBittorrent holds the renamed display name rather than the
    release name:

    1. exactly one torrent named ``f"{save_title} - {episode}"``;
    2. otherwise torrents whose save-path basename is this anime's folder *and*
       whose name carries this episode token.
    """
    target = f"{save_title} - {episode}".strip().lower()
    exact = [t for t in torrents if str(t.get("name") or "").strip().lower() == target]
    if len(exact) == 1:
        return exact, "ok", ""
    if len(exact) > 1:
        return [], "ambiguous", f"{len(exact)} torrents named {target!r}"

    token = _episode_token_re(episode)
    wanted_path = save_title.strip().lower()
    candidates = [
        t for t in torrents
        if os.path.basename(str(t.get("save_path") or "").rstrip("/")).lower() == wanted_path
        and token.search(str(t.get("name") or ""))
    ]
    if len(candidates) == 1:
        return candidates, "ok", ""
    if len(candidates) > 1:
        return [], "ambiguous", (
            f"{len(candidates)} torrents match episode {episode} in {save_title!r}"
        )
    return [], "missing", (
        f"no torrent for episode {episode} (recorded release {release_title!r})"
    )


def _candidate_episode_matches(title, episode):
    """True when a Nyaa release name is the requested episode.

    anitopy's ``episode_number`` is authoritative in most cases; the scene-token
    regex is the fallback for naming styles anitopy cannot parse.
    """
    parsed = anitopy.parse(title) or {}
    raw_episode = parsed.get("episode_number")
    if raw_episode is not None:
        values = raw_episode if isinstance(raw_episode, list) else [raw_episode]
        for value in values:
            try:
                if int(float(value)) == episode:
                    return True
            except (TypeError, ValueError):
                continue
        # anitopy found an episode number and it is a different one: reject, even
        # if a loose regex would have matched something else in the name.
        return False
    token = _episode_token_re(episode)
    return bool(token.search(title))


def _find_replacement(titles, episode, require_japanese_audio, require_english_subs):
    """Best Nyaa release for one episode satisfying the requirements."""
    config = get_config()
    query_title = titles[0]
    query = f'{query_title} S01E01' if episode == 1 else f'{query_title} "{episode:02d}"'
    candidates = nyaa.search_raw_title_candidates(query, False)
    qualified = []
    for item in candidates:
        title = item.get("title") or ""
        if not _candidate_episode_matches(title, episode):
            continue
        audio_rank, audio_label = detect_audio_language(title)
        sub_rank, sub_label = detect_subtitle_language(title)
        if require_japanese_audio and audio_rank < AUDIO_MULTI:
            continue
        if require_english_subs and sub_rank < SUB_ENG_DECLARED:
            continue
        try:
            seeders = int(item.get("nyaa:seeders") or 0)
        except (TypeError, ValueError):
            seeders = 0
        qualified.append({
            "title": title,
            "link": item.get("link") or "",
            "seeders": seeders,
            "size": item.get("nyaa:size") or "Unknown",
            "audio_rank": audio_rank,
            "audio_label": audio_label,
            "subtitle_rank": sub_rank,
            "subtitle_label": sub_label,
        })
    if not qualified:
        return None
    target_resolution = str(getattr(config, "resolution", "") or "").strip()
    qualified.sort(key=lambda c: (
        -c["audio_rank"],
        0 if (target_resolution and target_resolution in c["title"]) else 1,
        -c["seeders"],
    ))
    return qualified[0]


def build_report(media_id, apply=False, titles=None, enroll=False):
    """Classify every downloaded episode and (optionally) replace the wrong ones."""
    config = get_config()
    titles = _tracking_titles(media_id, titles or [])
    if not titles:
        raise SystemExit(f"No tracking title for media id {media_id}; pass --title")

    if enroll:
        # Enrol first: a single `--enroll --apply` run must apply the requirements it
        # just stored, otherwise the flag is only effective on the next invocation.
        release_prefs.set(media_id, require_japanese_audio=True, require_english_subs=True)

    requirements = get_requirements(media_id)
    require_jpn = requirements["require_japanese_audio"]
    require_subs = requirements["require_english_subs"]

    torrents = qbit.list_torrents()
    by_episode = _history_by_episode(titles)

    report = {
        "mediaId": media_id,
        "titles": titles,
        "requireJapaneseAudio": require_jpn,
        "requireEnglishSubs": require_subs,
        "apply": bool(apply),
        "entries": [],
        "applied": [],
        "enrolled": bool(enroll),
    }

    for episode in sorted(by_episode):
        entry = by_episode[episode]
        release_title = str(entry.get("title") or "")
        audio_rank, audio_label = detect_audio_language(release_title)
        sub_rank, sub_label = detect_subtitle_language(release_title)

        row = {
            "episode": episode,
            "current": release_title,
            "audioRank": audio_rank,
            "audioLabel": audio_label,
            "subtitleRank": sub_rank,
            "subtitleLabel": sub_label,
        }

        conforming = True
        if require_jpn and audio_rank < AUDIO_MULTI:
            conforming = False
        if require_subs and sub_rank < SUB_ENG_DECLARED:
            conforming = False

        if conforming:
            row["action"] = "keep"
            report["entries"].append(row)
            continue

        matches, status, reason = _match_torrents(torrents, titles[0], release_title, episode)
        if status != "ok":
            row["action"] = status
            row["reason"] = reason
            report["entries"].append(row)
            continue
        row["torrent"] = matches[0].get("name")

        replacement = _find_replacement(titles, episode, require_jpn, require_subs)
        if not replacement:
            row["action"] = "no_replacement"
            row["reason"] = "no release on Nyaa satisfies the requirements"
            report["entries"].append(row)
            continue

        row["replacement"] = replacement
        row["action"] = "replace"

        if apply:
            added = qbit.add_check_torrent(
                replacement["link"], titles[0], episode,
                _use_proxy(media_id)
            )
            if not added:
                row["action"] = "add_failed"
                report["entries"].append(row)
                continue

            deleted = qbit.delete_torrent_by_hash(matches[0]["hash"], delete_files=True)
            if not deleted:
                row["action"] = "delete_failed"
                report["entries"].append(row)
                continue

            history_manager.add_entry(
                title=replacement["title"],
                link=replacement["link"],
                anime_title=titles[0],
                episode=episode,
                size=replacement["size"],
                seeders=str(replacement["seeders"]),
                source="manual",
            )
            report["applied"].append(episode)

        report["entries"].append(row)

    return report


def format_report(report):
    """Render a build_report result as the human-readable dry-run output."""
    lines = []
    mode = "APPLY" if report["apply"] else "DRY RUN"
    lines.append(f"[{mode}] media {report['mediaId']} titles={report['titles']} "
                 f"requireJapaneseAudio={report['requireJapaneseAudio']} "
                 f"requireEnglishSubs={report['requireEnglishSubs']}")
    if report["enrolled"]:
        lines.append("  enrolled: require_japanese_audio=True require_english_subs=True")
    for row in report["entries"]:
        lines.append(f"  ep {row['episode']:>3} {row['action']:<14} {row['audioLabel']:<34} "
                     f"{row['subtitleLabel']:<18} {row['current'][:70]}")
        replacement = row.get("replacement")
        if replacement:
            lines.append(f"        -> {replacement['audio_label']} / "
                         f"{replacement['subtitle_label']}: {replacement['title'][:80]}")
        if row.get("reason"):
            lines.append(f"        reason: {row['reason']}")
    if report["apply"]:
        lines.append(f"  applied replacements for episodes: {report['applied']}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--media-id", type=int, required=True)
    parser.add_argument("--title", action="append", default=[],
                        help="tracking title used for Nyaa searches (repeatable)")
    parser.add_argument("--apply", action="store_true",
                        help="actually add replacements and delete the old releases")
    parser.add_argument("--enroll", action="store_true",
                        help="store require_japanese_audio + require_english_subs for this anime")
    parser.add_argument("--json", action="store_true", help="emit the report as JSON")
    parser.add_argument("--list-queue", action="store_true",
                        help="print the qBittorrent queue (name / hash / save_path) and exit")
    args = parser.parse_args()

    if args.list_queue:
        # Diagnostic: qBittorrent holds renamed display names, so this is how you see
        # what the matcher will actually be comparing against.
        for torrent in qbit.list_torrents():
            print(f"  {torrent.get('hash')}  {str(torrent.get('state') or ''):<12} "
                  f"{torrent.get('save_path')}  {torrent.get('name')}")
        return

    report = build_report(args.media_id, apply=args.apply, titles=args.title, enroll=args.enroll)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return

    print(format_report(report))


if __name__ == "__main__":
    main()
