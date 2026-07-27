import re
import email.utils
import time
import datetime
from typing import List, Dict, Any, Optional
from .config import get_config

def dice_coefficient(a: str, b: str) -> float:
    """Calculates Sorenson-Dice similarity coefficient for two strings using bigrams."""
    if not a or not b:
        return 0.0
    # Clean whitespace
    a = "".join(a.split())
    b = "".join(b.split())
    if a == b:
        return 1.0
    if len(a) < 2 or len(b) < 2:
        return 0.0

    a_bigrams = {a[i:i+2] for i in range(len(a) - 1)}
    b_bigrams = {b[i:i+2] for i in range(len(b) - 1)}

    intersection = a_bigrams.intersection(b_bigrams)
    total_bigrams = len(a_bigrams) + len(b_bigrams)
    if total_bigrams == 0:
        return 0.0
    return 2.0 * len(intersection) / total_bigrams

def find_best_match(main_string: str, target_strings: List[str]) -> dict:
    """
    Find the best match of main_string against a list of target_strings.
    Matches the exact data structure returned by the npm string-similarity library.
    """
    ratings = []
    best_rating = -1.0
    best_match = None
    best_idx = -1

    main_lower = main_string.lower()

    for idx, target in enumerate(target_strings):
        rating = dice_coefficient(main_lower, target.lower())
        ratings.append({"target": target, "rating": rating})
        if rating > best_rating:
            best_rating = rating
            best_match = {"target": target, "rating": rating}
            best_idx = idx

    return {
        "ratings": ratings,
        "bestMatch": best_match or {"target": "", "rating": 0.0},
        "bestMatchIndex": best_idx
    }

def get_explicit_season(title: str) -> Optional[int]:
    """Extract explicit season number from a string, returning None if no explicit indicator is found."""
    if not title:
        return None
    # Match roman numerals: Season II, III, IV or standalone II, III, IV (with word boundaries)
    roman_match = re.search(r'\b(?:season\s*)?(II|III|IV)\b', title, re.IGNORECASE)
    if roman_match:
        return {"II": 2, "III": 3, "IV": 4}.get(roman_match.group(1).upper())
    
    # Match ordinals: 2nd Season, 3rd Season, etc.
    ordinal_match = re.search(r'\b(\d+)(?:st|nd|rd|th)\s*season\b', title, re.IGNORECASE)
    if ordinal_match:
        return int(ordinal_match.group(1))

    # Match standard season notations: S2, Season 2, S02, C2 (cour 2)
    season_match = re.search(r'\b(?:s|season|c)\s*0?(\d+)\b', title, re.IGNORECASE)
    if season_match:
        return int(season_match.group(1))
        
    return None

def fix_anime_season(title: str) -> dict:
    """Detect and extract season information from an anime title."""
    if not title:
        return {"title": "", "seasonCount": 1}

    # Match roman numerals season II, III, IV
    roman_regex = r'\b(?:season\s*)?(II|III|IV)\b'
    roman_match = re.search(roman_regex, title, re.IGNORECASE)
    if roman_match:
        roman = roman_match.group(1).upper()
        roman_to_season = {"II": 2, "III": 3, "IV": 4}
        clean_title = title.replace(roman_match.group(0), "").strip()
        clean_title = re.sub(r'\s+', ' ', clean_title)
        return {
            "title": clean_title,
            "seasonCount": roman_to_season.get(roman, 1)
        }

    # Match ordinals: 2nd Season, 3rd Season, etc.
    ordinal_match = re.search(r'\b(\d+)(?:st|nd|rd|th)\s*season\b', title, re.IGNORECASE)
    if ordinal_match:
        season_number = int(ordinal_match.group(1))
        clean_title = title.replace(ordinal_match.group(0), "").strip()
        clean_title = re.sub(r'\s+', ' ', clean_title)
        return {
            "title": clean_title,
            "seasonCount": season_number
        }

    # Match standard season notations: Season 2, S2, S02
    season_match = re.search(r'\b(?:s|season|c)\s*0?(\d+)\b', title, re.IGNORECASE)
    if season_match:
        season_number = int(season_match.group(1))
        clean_title = title.replace(season_match.group(0), "").strip()
        clean_title = re.sub(r'\s+', ' ', clean_title)
        return {
            "title": clean_title,
            "seasonCount": season_number
        }

    return {
        "title": title,
        "seasonCount": 1
    }

def count_past_relations(media_id: int, episode_offset: int = 0, season_count: int = 1) -> dict:
    """Walk prequel chain recursively to compute total episode offset and season count."""
    # Lazily import anilist to prevent circular dependency
    from .anilist import anilist
    
    relations = anilist.get_previous_relations(media_id)
    # Sleep to avoid rate limiting
    time.sleep(0.3)
    if not relations:
        return {"episodeOffset": 0, "seasonCount": 0}

    for relation in relations:
        relation_type = relation.get("relationType")
        node = relation.get("node") or {}
        if relation_type == "PREQUEL":
            episodes = node.get("episodes") or 0
            offset_inc = episodes if episodes > 3 else 0
            season_inc = 1 if episodes > 3 else 0
            
            return count_past_relations(
                node["id"],
                episode_offset + offset_inc,
                season_count + season_inc
            )

    return {"episodeOffset": episode_offset, "seasonCount": season_count}

def matches_airdate_with_buffer(airing_at: float, pub_epoch: float, buffer_seconds: Optional[int] = None) -> bool:
    """Verify if the torrent publication date is within reasonable bounds of the airing schedule."""
    if buffer_seconds is None:
        config = get_config()
        hours = getattr(config, 'air_date_threshold_hours', 48.0) or 48.0
        buffer_seconds = int(hours * 3600)
    return (airing_at - buffer_seconds) < pub_epoch


def _fmt_epoch(epoch: float) -> str:
    """Format a Unix timestamp as a compact UTC string for log messages."""
    try:
        return datetime.datetime.utcfromtimestamp(epoch).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return str(epoch)


def _fmt_duration(seconds: float) -> str:
    """Format a duration in seconds as a human-readable string (e.g. '2h 15m')."""
    seconds = abs(int(seconds))
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    if minutes:
        parts.append(f"{minutes}m")
    return " ".join(parts) if parts else "<1m"

def _to_clean_string(val: Any) -> str:
    """Helper to clean string or join list of strings into a single lowercase string."""
    if isinstance(val, list):
        return " ".join(str(v) for v in val).strip().lower()
    return str(val or "").strip().lower()

def verify_query(
    search_query: str,
    anime_parsed_data: dict,
    resolution: str,
    search_mode: str,
    nyaa_pub_date: str,
    air_dates: dict,
    ignore_airdate_checks: bool = False,
    *episodes: int,
    verbose: bool = False
) -> Any:
    """Verify a torrent filename matches AniList metadata criteria."""
    
    def get_result(score: float, reason: str = "", details: dict = None) -> Any:
        if verbose:
            ret = {"rejection_reason": reason, "rating": score}
            if details:
                ret.update(details)
            return score, ret
        return score

    group = _to_clean_string(anime_parsed_data.get("release_group"))
    config = get_config()
    exclude_groups = [g.lower() for g in (config.exclude_release_groups or [])]

    subtitles = _to_clean_string(anime_parsed_data.get("subtitles"))
    if group in exclude_groups:
        return get_result(0.0, f"Excluded release group ({group})")
    if "dub" in subtitles:
        return get_result(0.0, "Dubbed audio tracks")

    try:
        parsed_date = email.utils.parsedate_to_datetime(nyaa_pub_date)
        pub_epoch = parsed_date.timestamp()
    except Exception:
        return get_result(0.0, "Invalid publication date format")

    file_name = _to_clean_string(anime_parsed_data.get("file_name"))
    
    parsed_title_val = anime_parsed_data.get("anime_title")
    if isinstance(parsed_title_val, list):
        parsed_title = parsed_title_val[0] if parsed_title_val else ""
    else:
        parsed_title = str(parsed_title_val or "")

    # Season conflict checks: only hard-reject when BOTH query and candidate have
    # explicit but DIFFERENT season numbers. Many releases (e.g. SubsPlease)
    # omit season numbers entirely — those should NOT be rejected here.
    query_explicit = get_explicit_season(search_query)
    candidate_explicit = get_explicit_season(parsed_title)

    if not candidate_explicit:
        season_val = anime_parsed_data.get("season") or anime_parsed_data.get("anime_season")
        if season_val:
            try:
                if isinstance(season_val, list) and season_val:
                    candidate_explicit = int(season_val[0])
                elif season_val:
                    candidate_explicit = int(season_val)
            except Exception:
                pass
        if not candidate_explicit:
            raw_file_name = anime_parsed_data.get("file_name", "")
            if isinstance(raw_file_name, str) and raw_file_name:
                candidate_explicit = get_explicit_season(raw_file_name)

    # Hard reject only when BOTH have explicit seasons that disagree
    if query_explicit is not None and candidate_explicit is not None:
        if query_explicit != candidate_explicit:
            return get_result(0.0, f"Season conflict (query S{query_explicit} vs torrent S{candidate_explicit})")

    # If candidate has a season marker but query does not specify one (defaults S1),
    # reject only if the candidate is explicitly a higher season
    if candidate_explicit is not None and candidate_explicit > 1 and query_explicit is None:
        return get_result(0.0, f"Season conflict (torrent S{candidate_explicit} but query has no season, assuming S1)")

    has_episodes = len(episodes) > 0

    parsed_resolution = ""
    if resolution == "0":
        parsed_resolution = "0"
    else:
        parsed_resolution = _to_clean_string(anime_parsed_data.get("video_resolution"))

    if not parsed_title or not parsed_resolution:
        return get_result(0.0, "Missing title or video resolution in candidate")

    sub_title_match = re.search(r'\((.+?)\)', parsed_title)
    sub_anime_title_string = sub_title_match.group(1) if sub_title_match else ""
    main_anime_title = re.sub(r'\(.+?\)', '', parsed_title).strip()
    v_bar_split_title = [t.strip() for t in parsed_title.split("|")]

    targets = [parsed_title, main_anime_title]
    if sub_anime_title_string:
        targets.append(sub_anime_title_string)
    targets.extend(v_bar_split_title)

    # Reconstruct season-qualified title from anitopy's split fields.
    # anitopy parses "Mushoku Tensei S3 - 04" as anime_title="Mushoku Tensei"
    # + anime_season="3" separately, so we rebuild "Mushoku Tensei S3" here
    # so a query of "Mushoku Tensei S3" gets a 1.0 match, not ~0.92.
    raw_anime_season = anime_parsed_data.get("anime_season") or anime_parsed_data.get("season")
    if raw_anime_season and parsed_title:
        try:
            season_num = int(raw_anime_season) if not isinstance(raw_anime_season, list) else int(raw_anime_season[0])
            if season_num and season_num > 1:
                targets.append(f"{parsed_title} S{season_num}")
                targets.append(f"{main_anime_title} S{season_num}")
        except (ValueError, TypeError, IndexError):
            pass

    # Also add season-stripped versions so a no-season torrent can still match
    # a season-qualified query (e.g. "Youjo Senki" torrent vs "Youjo Senki S2" query)
    for t in list(targets):
        stripped = fix_anime_season(t)["title"]
        if stripped and stripped != t:
            targets.append(stripped)
    targets = list(set(t for t in targets if t))

    # Strip quoted episode numbers (e.g., ' "01"') from search_query for title comparison
    # e.g. 'Youjo Senki S2 "01"' → 'Youjo Senki S2'
    clean_search_query = re.sub(r'\s*"\d+"$', '', search_query).strip()

    title_match = find_best_match(clean_search_query, targets)
    best_rating = title_match["bestMatch"]["rating"]

    best_target = title_match["bestMatch"].get("target", "")
    if best_rating < 0.70:
        return get_result(0.0,
            f"Title similarity too low: {best_rating*100:.1f}% < 70% "
            f"(query '{clean_search_query}' best matched '{best_target}')"
        )

    resolution_match = (
        resolution == "0" or
        resolution in parsed_resolution
    )

    if search_mode == "EPISODE":
        if not has_episodes:
            return get_result(0.0, "No episode requested")

        parsed_episode_val = anime_parsed_data.get("episode_number")
        if not parsed_episode_val:
            return get_result(0.0, "Episode number missing from candidate")

        parsed_episodes = []
        if isinstance(parsed_episode_val, list):
            for ep_str in parsed_episode_val:
                try:
                    parsed_episodes.append(float(ep_str))
                except ValueError:
                    pass
        else:
            try:
                parsed_episodes.append(float(parsed_episode_val))
            except ValueError:
                pass

        if not parsed_episodes:
            return get_result(0.0, "Invalid episode number format in candidate")

        wanted_episode = episodes[0]
        episode_match = any(wanted_episode == int(ep) for ep in parsed_episodes)

        page_number = -1
        nodes = air_dates.get("nodes", []) if air_dates else []
        for idx, node in enumerate(nodes):
            if node.get("episode") == wanted_episode:
                page_number = idx
                break

        if page_number == -1 and not ignore_airdate_checks:
            return get_result(0.0, "Episode not in AniList airing schedule (may not have aired yet)")

        airing_at_epoch = nodes[page_number]["airingAt"] if page_number != -1 else 0.0
        config = get_config()
        threshold_hours = getattr(config, 'air_date_threshold_hours', 48.0) or 48.0
        buffer_seconds = int(threshold_hours * 3600)

        air_date_match = (
            ignore_airdate_checks or
            (page_number != -1 and matches_airdate_with_buffer(
                airing_at_epoch,
                pub_epoch,
                buffer_seconds
            ))
        )

        score = float(episode_match) + float(resolution_match) + float(air_date_match) + best_rating

        rejection_reason = ""
        if score < 3.88:
            failed_checks = []
            if not episode_match:
                ep_found = ", ".join(str(int(e)) for e in parsed_episodes) if parsed_episodes else "none"
                failed_checks.append(
                    f"episode mismatch (wanted Ep{wanted_episode}, torrent has Ep{ep_found})"
                )
            if not resolution_match:
                failed_checks.append(
                    f"resolution mismatch (wanted {resolution}, got {parsed_resolution or 'none'})"
                )
            if not air_date_match and not ignore_airdate_checks and airing_at_epoch:
                diff_secs = pub_epoch - (airing_at_epoch - buffer_seconds)
                if diff_secs < 0:
                    # Published before (airing_time - threshold)
                    early_by = _fmt_duration(-diff_secs)
                    failed_checks.append(
                        f"air date: torrent uploaded {early_by} too early "
                        f"(uploaded {_fmt_epoch(pub_epoch)}, "
                        f"aired {_fmt_epoch(airing_at_epoch)}, "
                        f"threshold -{threshold_hours:.0f}h)"
                    )
                else:
                    failed_checks.append(
                        f"air date check failed "
                        f"(uploaded {_fmt_epoch(pub_epoch)}, "
                        f"aired {_fmt_epoch(airing_at_epoch)}, "
                        f"threshold -{threshold_hours:.0f}h)"
                    )
            rejection_reason = "Failed threshold — " + " | ".join(failed_checks)

        details = {
            "episode_match": episode_match,
            "resolution_match": resolution_match,
            "air_date_match": air_date_match,
            "title_similarity": best_rating
        }
        return get_result(score, rejection_reason, details)

    elif search_mode == "BATCH":
        parsed_release_info = _to_clean_string(anime_parsed_data.get("release_information"))
        explicit_batch = "batch" in parsed_release_info
        is_single_episode = has_episodes and episodes[-1] == 1
        is_batch = explicit_batch or not is_single_episode

        nodes = air_dates.get("nodes", []) if air_dates else []
        air_date_match_batch = (
            ignore_airdate_checks or
            (len(nodes) > 0 and matches_airdate_with_buffer(
                nodes[-1]["airingAt"],
                pub_epoch
            ))
        )

        episode_range_match = re.search(r'\d+\s*[-~]\s*\d+', file_name)
        if episode_range_match:
            range_str = episode_range_match.group(0)
            range_parts = re.split(r'[-~]', range_str)
            try:
                start_range = int(range_parts[0])
                end_range = int(range_parts[1])
                verify_range_ok = (start_range == 1 and end_range == episodes[-1])
            except Exception:
                verify_range_ok = False

            score = float(verify_range_ok) + float(resolution_match) + float(air_date_match_batch) + best_rating

            rejection_reason = ""
            if score < 3.88:
                failed_checks = []
                if not verify_range_ok:
                    failed_checks.append(
                        f"batch range mismatch (found '{range_str}', expected 01-{episodes[-1] if episodes else '?'})"
                    )
                if not resolution_match:
                    failed_checks.append(
                        f"resolution mismatch (wanted {resolution}, got {parsed_resolution or 'none'})"
                    )
                if not air_date_match_batch and nodes:
                    last_node_epoch = nodes[-1]["airingAt"]
                    config = get_config()
                    threshold_hours = getattr(config, 'air_date_threshold_hours', 48.0) or 48.0
                    diff = pub_epoch - (last_node_epoch - int(threshold_hours * 3600))
                    if diff < 0:
                        failed_checks.append(
                            f"air date: batch uploaded {_fmt_duration(-diff)} too early "
                            f"(uploaded {_fmt_epoch(pub_epoch)}, "
                            f"last ep aired {_fmt_epoch(last_node_epoch)}, "
                            f"threshold -{threshold_hours:.0f}h)"
                        )
                    else:
                        failed_checks.append(
                            f"air date check failed "
                            f"(uploaded {_fmt_epoch(pub_epoch)}, "
                            f"last ep aired {_fmt_epoch(last_node_epoch)}, "
                            f"threshold -{threshold_hours:.0f}h)"
                        )
                rejection_reason = "Failed threshold — " + " | ".join(failed_checks)

            details = {
                "batch_range_match": verify_range_ok,
                "resolution_match": resolution_match,
                "air_date_match": air_date_match_batch,
                "title_similarity": best_rating
            }
            return get_result(score, rejection_reason, details)

        score = float(is_batch) + float(resolution_match) + float(air_date_match_batch) + best_rating
        rejection_reason = ""
        if score < 3.88:
            failed_checks = []
            if not is_batch:
                failed_checks.append("not a batch torrent (single-episode release)")
            if not resolution_match:
                failed_checks.append(
                    f"resolution mismatch (wanted {resolution}, got {parsed_resolution or 'none'})"
                )
            if not air_date_match_batch and nodes:
                last_node_epoch = nodes[-1]["airingAt"]
                config = get_config()
                threshold_hours = getattr(config, 'air_date_threshold_hours', 48.0) or 48.0
                diff = pub_epoch - (last_node_epoch - int(threshold_hours * 3600))
                if diff < 0:
                    failed_checks.append(
                        f"air date: batch uploaded {_fmt_duration(-diff)} too early "
                        f"(uploaded {_fmt_epoch(pub_epoch)}, "
                        f"last ep aired {_fmt_epoch(last_node_epoch)}, "
                        f"threshold -{threshold_hours:.0f}h)"
                    )
                else:
                    failed_checks.append(
                        f"air date check failed "
                        f"(uploaded {_fmt_epoch(pub_epoch)}, "
                        f"last ep aired {_fmt_epoch(last_node_epoch)}, "
                        f"threshold -{threshold_hours:.0f}h)"
                    )
            rejection_reason = "Failed threshold — " + " | ".join(failed_checks)
            
        details = {
            "is_batch": is_batch,
            "resolution_match": resolution_match,
            "air_date_match": air_date_match_batch,
            "title_similarity": best_rating
        }
        return get_result(score, rejection_reason, details)

    return get_result(0.0, "Unsupported search mode")
