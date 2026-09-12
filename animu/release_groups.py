import re
from typing import Optional, List, Dict, Any, Tuple

# (canonical_name, score, scope, confidence, evidence_note)
RELEASE_GROUP_TABLE = [
    ("SubsPlease",   95, "weekly",  "verified"),
    ("Erai-raws",    91, "weekly",  "verified"),
    ("sam",          90, "catalog", "verified"),
    ("CRUCiBLE",     89, "catalog", "verified"),
    ("Headpatter",   88, "catalog", "verified"),
    ("Moxie",        87, "catalog", "verified"),
    ("MTBB",         86, "catalog", "verified"),
    ("hchcsen",      85, "catalog", "verified"),
    ("-ZR-",         84, "catalog", "verified"),
    ("NAN0",         84, "catalog", "verified"),
    ("ToonsHub",     82, "weekly",  "verified"),
    ("smol",         82, "catalog", "verified"),
    ("VARYG",        81, "weekly",  "verified"),
    ("Okay-Subs",    81, "catalog", "verified"),
    ("GetItTwisted", 80, "catalog", "verified"),
    ("TTGA",         79, "catalog", "verified"),
    ("LostYears",    79, "both",    "verified"),
    ("PMR",          79, "catalog", "verified"),
    ("LYS1TH3A",     77, "catalog", "verified"),
    ("YURASUKA",     76, "catalog", "verified"),
    ("YURI",         75, "catalog", "verified"),
    ("koala",        74, "catalog", "verified"),
    ("LazyRemux",    74, "catalog", "verified"),
    ("Orphan",       73, "catalog", "verified"),
    ("FLE",          73, "catalog", "verified"),
    ("Mehul",        72, "catalog", "verified"),
    ("Kawatare",     72, "catalog", "verified"),
    ("nekotan",      71, "catalog", "verified"),
    ("Lulu",         71, "catalog", "verified"),
    ("Vodes",        70, "catalog", "verified"),
    ("ZeroBuild",    70, "catalog", "verified"),
    ("Arid",         69, "catalog", "verified"),
    ("Drag",         68, "catalog", "verified"),
    ("ASW",          68, "weekly",  "reported"),
    ("Judas",        66, "weekly",  "reported"),
    ("Beatrice-Raws",66, "both",    "reported"),
    ("Ironclad",     65, "weekly",  "verified"),
    ("MiniMTBB",     65, "catalog", "reported"),
    ("Anime Time",   64, "weekly",  "reported"),
    ("Hi10",         62, "both",    "reported"),
    ("neoHEVC",      60, "weekly",  "reported"),
    ("EMBER",        60, "weekly",  "reported"),
    ("Golumpa",      60, "weekly",  "verified"),
    ("Slyfox",       58, "weekly",  "unsourced"),
    ("Okami",        58, "weekly",  "unsourced"),
    ("Moozzi2",      55, "catalog", "reported"),
    ("Nanami",       54, "weekly",  "unsourced"),
    ("Yameii",       52, "weekly",  "unsourced"),
    ("Cleo",         52, "weekly",  "reported"),
]

DEAD_GROUPS = ["HorribleSubs"]   # shut down 2020; any "new" release is fake
UNKNOWN_GROUP_SCORE = 45.0

# Canonical group names mapping (lowercase -> canonical name)
CANONICAL_NAMES: Dict[str, str] = {row[0].lower(): row[0] for row in RELEASE_GROUP_TABLE}
for dead in DEAD_GROUPS:
    CANONICAL_NAMES[dead.lower()] = dead

# Canonical score map
GROUP_SCORE_MAP: Dict[str, float] = {row[0].lower(): float(row[1]) for row in RELEASE_GROUP_TABLE}

# Alias map (normalized to canonical)
ALIAS_MAP: Dict[str, str] = {
    "varyg": "VARYG",
    "ember": "EMBER",
    "hi10anime": "Hi10",
    "animetime": "Anime Time",
    "anime time": "Anime Time",
    "beatrice": "Beatrice-Raws",
    "beatrice-raws": "Beatrice-Raws",
    "minimtbb": "MiniMTBB",
    "mini mtbb": "MiniMTBB",
    "subs-please": "SubsPlease",
    "subs please": "SubsPlease",
    "erai": "Erai-raws",
    "erai_raws": "Erai-raws",
    "horriblesubs": "HorribleSubs",
    "horrible-subs": "HorribleSubs",
    "horrible subs": "HorribleSubs",
}

# Full alias mapping combining canonical names and aliases
ALL_ALIASES: Dict[str, str] = dict(CANONICAL_NAMES)
for k, v in ALIAS_MAP.items():
    ALL_ALIASES[k.lower()] = v

# Known attribute tokens to reject
ATTRIBUTE_TOKENS = {
    "1080p", "720p", "480p", "2160p", "4k", "1080i", "720i",
    "bd", "bdrip", "brrip", "web", "web-dl", "webdl", "webrip", "dvd", "dvdrip", "hdtv", "tv",
    "batch", "pack", "complete",
    "multi-subs", "multi-sub", "multisubs", "multisub", "multi", "dual audio", "dualaudio", "dual-audio",
    "aac", "aac2.0", "ddp2.0", "ac3", "flac", "dts", "mp3",
    "hevc", "avc", "x264", "x265", "h264", "h265", "h.264", "h.265", "av1",
    "10bit", "8bit", "10-bit", "8-bit", "hi10p",
    "raw", "raws", "uncensored", "censored", "repack", "remux", "v0", "v1", "v2", "v3",
    "cr", "fun", "nf", "amzn", "hidive"
}

# Scan targets for Step 4 sorted by length descending
SCAN_TARGETS: List[str] = sorted(ALL_ALIASES.keys(), key=lambda k: len(k), reverse=True)

TIER_SCORES: Dict[str, float] = {
    "S": 95.0,
    "A": 82.0,
    "B": 65.0,
    "C": 45.0,
    "D": 20.0
}

def normalize_group_name(raw_name: Optional[str]) -> str:
    """Normalises a release group name to its canonical form if known."""
    if not raw_name:
        return ""
    cleaned = raw_name.strip()
    return ALL_ALIASES.get(cleaned.lower(), cleaned)

def is_known_group(raw_name: Optional[str]) -> bool:
    """Check if the group name is in the canonical table or known aliases."""
    if not raw_name:
        return False
    return raw_name.strip().lower() in ALL_ALIASES

def is_dead_group(raw_name: Optional[str]) -> bool:
    """Check if the group is marked dead."""
    if not raw_name:
        return False
    canonical = normalize_group_name(raw_name)
    return canonical.lower() in [d.lower() for d in DEAD_GROUPS]

def is_attribute_token(token: str) -> bool:
    """Returns True if the token is a video/audio/attribute tag rather than a release group."""
    cleaned = token.strip()
    if not cleaned:
        return True
    lower = cleaned.lower()
    # A known release group is never an attribute
    if lower in ALL_ALIASES:
        return False
    # Pure numeric or CRC hex token
    if cleaned.isdigit() or re.match(r'^[0-9a-fA-F]{8}$', cleaned):
        return True
    if lower in ATTRIBUTE_TOKENS:
        return True
    # If all components separated by spaces/dots/hyphens are attributes/digits/crc
    words = [w.strip() for w in re.split(r'[\s._-]+', lower) if w.strip()]
    if words and all(w in ATTRIBUTE_TOKENS or w.isdigit() or re.match(r'^[0-9a-f]{8}$', w) for w in words):
        return True
    return False

def detect_release_group(title: str, parsed: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """
    Detect release group using layered detection semantics:
    1. Leading bracket [X] at the very start (rejecting attribute tokens).
    2. anitopy parsed['release_group'] when present and not an attribute.
    3. Scene suffix trailing -GROUP on dot/space-separated release name (2-24 chars).
    4. Known-group scan case-insensitive alias match anywhere in title against tier table.
    
    Normalisation: canonical name from tier table when known, otherwise raw detected token.
    Returns None when nothing is detected.
    """
    if not title:
        return None

    # 1. Leading bracket
    m_lead = re.match(r'^\s*\[([^\]]+)\]', title)
    if m_lead:
        cand = m_lead.group(1).strip()
        if not is_attribute_token(cand):
            return normalize_group_name(cand)

    # 2. anitopy
    if parsed is None:
        try:
            import anitopy
            parsed = anitopy.parse(title) or {}
        except Exception:
            parsed = {}
    
    cand_ani = parsed.get("release_group")
    if cand_ani:
        cand_ani_str = str(cand_ani).strip()
        if not is_attribute_token(cand_ani_str):
            return normalize_group_name(cand_ani_str)

    # 3. Scene suffix
    clean = title.strip()
    clean = re.sub(r'\.(mkv|mp4|avi|flv|webm|ts)$', '', clean, flags=re.I).strip()
    clean = re.sub(r'(\s*\[[0-9a-fA-F]{8}\]|\s*\([0-9a-fA-F]{8}\))+$', '', clean).strip()
    m_scene = re.search(r'-([A-Za-z0-9_]{2,24})$', clean)
    if m_scene:
        cand_scene = m_scene.group(1).strip()
        if not is_attribute_token(cand_scene):
            return normalize_group_name(cand_scene)

    # 4. Known-group scan
    for target in SCAN_TARGETS:
        pat = rf'(?<![A-Za-z0-9]){re.escape(target)}(?![A-Za-z0-9])'
        if re.search(pat, title, re.IGNORECASE):
            return ALL_ALIASES[target]

    return None

def get_group_score(group: Optional[str], overrides: Optional[Dict[str, Any]] = None) -> float:
    """Look up tier score for a group, applying any user overrides."""
    if not group:
        return UNKNOWN_GROUP_SCORE

    canonical = normalize_group_name(group)

    # Check overrides
    if overrides:
        for key, val in overrides.items():
            if key.strip().lower() in (canonical.lower(), group.strip().lower()):
                val_str = str(val).strip()
                tier_upper = val_str.upper()
                if tier_upper in TIER_SCORES:
                    return TIER_SCORES[tier_upper]
                try:
                    return float(val_str)
                except ValueError:
                    pass

    if is_dead_group(canonical):
        return 0.0

    canonical_lower = canonical.lower()
    if canonical_lower in GROUP_SCORE_MAP:
        return float(GROUP_SCORE_MAP[canonical_lower])

    return UNKNOWN_GROUP_SCORE

def get_group_tier(val: Any, overrides: Optional[Dict[str, Any]] = None) -> str:
    """Return tier letter (S, A, B, C, D) or 'Dead' for a group or numeric score."""
    if isinstance(val, (int, float)):
        score = float(val)
    elif isinstance(val, str):
        if is_dead_group(val):
            return "Dead"
        score = get_group_score(val, overrides)
    else:
        return "Unknown"

    if score >= 90:
        return "S"
    elif score >= 75:
        return "A"
    elif score >= 55:
        return "B"
    elif score >= 30:
        return "C"
    else:
        return "D"

def select_best_candidate(
    candidates: List[Dict[str, Any]],
    preferred_release_group: Optional[str] = None,
    release_group_misses: int = 0,
    prefer_uncensored: bool = True,
    prefer_release_group: bool = True,
    upgrade_margin: float = 0.0,
    downgrade_after_misses: int = 0,
    tier_overrides: Optional[Dict[str, Any]] = None,
    exclude_groups: Optional[List[str]] = None,
    score_threshold: float = 3.70
) -> Optional[Dict[str, Any]]:
    """
    Selects the best torrent candidate following normative precedence:
    1. Hard gates (SCORE_THRESHOLD, seeders > 0, exclusion, rejection reasons).
    2. Censorship class (uncensored > neutral > censored) when prefer_uncensored is on.
    3. Release-group preference:
       - Upgrades if a qualifying candidate strictly exceeds stored tier score + upgrade_margin.
       - Uses preferred group if qualifying release exists.
       - Fallback to highest tier candidate without forgetting stored preference (unless downgrade threshold reached).
    """
    if not candidates:
        return None

    ex_set = {g.strip().lower() for g in (exclude_groups or []) if g.strip()}

    # 1. Hard gates
    qualifying = []
    for c in candidates:
        if c.get("seeders", 0) <= 0:
            continue
        if c.get("rating", 0.0) < score_threshold:
            continue
        if c.get("details", {}).get("rejection_reason"):
            continue

        grp = c.get("release_group")
        if grp:
            if grp.lower() in ex_set or normalize_group_name(grp).lower() in ex_set:
                continue

        qualifying.append(c)

    if not qualifying:
        return None

    # 2. Censorship class
    if prefer_uncensored:
        max_class = max(c.get("censorship_class", 1) for c in qualifying)
        qualifying = [c for c in qualifying if c.get("censorship_class", 1) == max_class]

    if not qualifying:
        return None

    # 3. Release group preference disabled -> pure rating + seeders
    if not prefer_release_group:
        best_cand = max(qualifying, key=lambda c: (c.get("rating", 0.0), c.get("seeders", 0)))
        res = dict(best_cand["item"])
        res["release_group"] = best_cand.get("release_group")
        res["group_score"] = best_cand.get("group_score", UNKNOWN_GROUP_SCORE)
        res["preferred_release_group"] = preferred_release_group or ""
        res["release_group_misses"] = release_group_misses
        res["preference_switched"] = False
        return res

    # 3. Release group preference enabled
    best_overall = max(qualifying, key=lambda c: (c.get("group_score", UNKNOWN_GROUP_SCORE), c.get("rating", 0.0), c.get("seeders", 0)))
    current_pref = normalize_group_name(preferred_release_group) if preferred_release_group else ""

    if current_pref:
        stored_score = get_group_score(current_pref, tier_overrides)
        cand_group_norm = normalize_group_name(best_overall.get("release_group")) if best_overall.get("release_group") else ""

        is_upgrade = (
            best_overall.get("group_score", UNKNOWN_GROUP_SCORE) > (stored_score + upgrade_margin)
            and cand_group_norm
            and cand_group_norm.lower() != current_pref.lower()
            and not is_dead_group(cand_group_norm)
        )

        if is_upgrade:
            chosen = best_overall
            new_pref = cand_group_norm
            new_misses = 0
            switched = True
        else:
            # Check if preferred group has a qualifying candidate
            pref_matches = [
                c for c in qualifying
                if c.get("release_group") and normalize_group_name(c.get("release_group")).lower() == current_pref.lower()
            ]
            if pref_matches:
                chosen = max(pref_matches, key=lambda c: (c.get("rating", 0.0), c.get("seeders", 0)))
                new_pref = current_pref
                new_misses = 0
                switched = False
            else:
                # Fallback
                chosen = best_overall
                new_misses = release_group_misses + 1
                if downgrade_after_misses > 0 and new_misses >= downgrade_after_misses:
                    new_pref = cand_group_norm if cand_group_norm and not is_dead_group(cand_group_norm) else ""
                    new_misses = 0
                    switched = (new_pref.lower() != current_pref.lower())
                else:
                    new_pref = current_pref
                    switched = False
    else:
        # No stored preference yet
        chosen = best_overall
        cand_group_norm = normalize_group_name(chosen.get("release_group")) if chosen.get("release_group") else ""
        if cand_group_norm and not is_dead_group(cand_group_norm):
            new_pref = cand_group_norm
            new_misses = 0
            switched = True
        else:
            new_pref = ""
            new_misses = 0
            switched = False

    res = dict(chosen["item"])
    res["release_group"] = chosen.get("release_group")
    res["group_score"] = chosen.get("group_score", UNKNOWN_GROUP_SCORE)
    res["preferred_release_group"] = new_pref
    res["release_group_misses"] = new_misses
    res["preference_switched"] = switched
    return res
