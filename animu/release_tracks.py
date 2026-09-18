"""Release audio + subtitle classification.

Korean/Chinese-origin shows are released on Nyaa with several alternative audio
tracks, and the same group often uploads two near-identical torrents per episode
(``... Korean Audio`` vs ``... Japanese Dub``). Nothing in the release name is a
hard signal of *quality*, so without an explicit preference the ranking falls
through to seeder count and the library ends up with a mix of audio languages.
The same titles also vary in whether they carry English subtitles at all.

This module classifies a torrent title on two independent axes.

Audio classes (higher is a stronger match for a release containing the Japanese
dub):

    2 = AUDIO_JPN_EXPLICIT  explicit Japanese audio/dub marker
    1 = AUDIO_MULTI         multi/dual audio (Japanese is one of the tracks)
    0 = AUDIO_OTHER         everything else

Subtitle classes:

    2 = SUB_ENG_DECLARED    English subtitles declared
    1 = SUB_UNKNOWN         no subtitle information in the title
    0 = SUB_NON_ENG_ONLY    declared non-English-only subtitles, or a raw

Only a *confirmed* Japanese track scores above 0. Bare scene tags that are
commonly used for multi-audio releases (``MULTi``, ``DUAL``) are deliberately
NOT treated as confirmation, because the same words appear in ``Multi-Subs``.
"""

import re
from typing import Any, Dict, Optional, Tuple

AUDIO_JPN_EXPLICIT = 2
AUDIO_MULTI = 1
AUDIO_OTHER = 0

SUB_ENG_DECLARED = 2
SUB_UNKNOWN = 1
SUB_NON_ENG_ONLY = 0

LABEL_JPN = "Japanese Dub"
LABEL_MULTI = "Multi/Dual Audio (incl. Japanese)"
LABEL_OTHER_DUB = "Non-Japanese Dub"
LABEL_ORIGINAL = "Korean/Chinese Audio"
LABEL_UNKNOWN = "Audio Unspecified"

LABEL_SUB_ENG = "English Subs"
LABEL_SUB_UNKNOWN = "Subs Unspecified"
LABEL_SUB_OTHER = "Non-English Subs"
LABEL_SUB_NONE = "No Subs (Raw)"

# Explicit Japanese audio markers ("Japanese Dub", "JPN Audio", "[Japanese]").
JAPANESE_AUDIO_PATTERNS = [
    r'\bjapanese\s+(?:dub|audio|language|track)\b',
    r'\bjap(?:anese)?\.?\s+dub\b',
    r'\bjpn\s+(?:dub|audio|track)\b',
    r'[\(\[]\s*japanese\s*[\)\]]',
]

# A bare "JPN" token is only an audio marker when it is not part of a subtitle
# tag ("[JPN Subs]" means Japanese subtitles, not a Japanese audio track).
JPN_TOKEN_PATTERN = r'\bjpn\b'
JPN_SUBTITLE_TAIL = r'[\s\-_.,]*(?:soft)?sub'

# Non-Japanese dub markers. A release that is explicitly some *other* language's
# dub does not contain the Japanese track, so it must not inherit the
# multi-audio class.
NON_JAPANESE_DUB_PATTERNS = [
    r'\b(?:english|eng)\s+dub\b',
    r'\b(?:spanish|spa|latino)\s+dub\b',
    r'\b(?:french|fre)\s+dub\b',
    r'\b(?:german|ger)\s+dub\b',
    r'\b(?:italian|ita)\s+dub\b',
    r'\b(?:portuguese|por|brazilian)\s+dub\b',
    r'\b(?:russian|rus)\s+dub\b',
    r'\b(?:arabic|hindi|tamil|telugu|filipino)\s+dub\b',
    r'\bdubbed\b',
]

# Multi/dual audio markers: several language tracks, so the Japanese dub is one
# of them. Written forms seen in the wild: "Multi-Audio", "Multi Audio",
# "MultiAudio", "Dual-Audio", "Dual Audio", "DualAudio".
MULTI_AUDIO_PATTERNS = [
    r'\bmulti[-\s_]?audio\b',
    r'\bdual[-\s_]?audio\b',
]

# Explicitly non-Japanese original-language markers ("Korean Audio" on a
# Korean-origin show, i.e. the original track without the Japanese dub).
ORIGINAL_LANGUAGE_PATTERNS = [
    r'\bkorean\s+(?:audio|dub|language|track)\b',
    r'\bkor\s+audio\b',
    r'\bchinese\s+(?:audio|dub|language|track)\b',
    r'\bchi\s+audio\b',
    r'\bmandarin\b',
    r'\bcantonese\b',
]

# "Multi-Subs" is the standard Nyaa tag for the Crunchyroll/Bilibili WEB-DL
# subtitle set, which always includes English. "MultiSub" is the scene spelling.
ENGLISH_SUB_PATTERNS = [
    r'\bmulti[-\s_]?subs?\b',
    r'\benglish\s+(?:soft)?subs?\b',
    r'\beng\s+(?:soft)?subs?\b',
    r'\be[-\s]?subs?\b',
    r'\[\s*subs?\s*\]',
]

# Declared non-English-only subtitles: Chinese-script sets and Japanese-only subs.
NON_ENGLISH_SUB_PATTERNS = [
    r'\bchs\b',
    r'\bcht\b',
    r'\bbig5\b',
    r'\bgb\b',
    r'\bchinese\s+(?:soft)?subs?\b',
    r'\bchi\s+subs?\b',
    r'\bjapanese\s+(?:soft)?subs?\b',
    r'\bjpn\s+subs?\b',
    r'\bjap\s+subs?\b',
    r'\bspanish\s+subs?\b',
    r'\bfrench\s+subs?\b',
    r'[\u7b80\u7e41]',
]

# No subtitles at all. A bare "\braw\b" deliberately does not match the group
# name suffix in "…-Beatrice-Raws".
NO_SUB_PATTERNS = [
    r'\braw\b',
    r'\bno[-\s]?subs?\b',
]


def _matches_any(patterns, text: str) -> bool:
    """True when any regex in `patterns` matches `text` (case-insensitive)."""
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def _has_japanese_audio(title: str) -> bool:
    """True when the title declares a Japanese audio track (never a subtitle tag)."""
    if _matches_any(JAPANESE_AUDIO_PATTERNS, title):
        return True

    for match in re.finditer(JPN_TOKEN_PATTERN, title, re.IGNORECASE):
        tail = title[match.end():match.end() + 12]
        if not re.match(JPN_SUBTITLE_TAIL, tail, re.IGNORECASE):
            return True

    return False


def detect_audio_language(
    title: str,
    parsed: Optional[Dict[str, Any]] = None
) -> Tuple[int, str]:
    """Classify a release title's audio track. Returns ``(rank, label)``.

    Precedence is fixed and ordered:

    1. explicit Japanese audio marker           -> 2, "Japanese Dub"
    2. explicit non-Japanese dub marker         -> 0, "Non-Japanese Dub"
    3. multi/dual audio marker (title or anitopy audio_term) -> 1
    4. explicit Korean/Chinese audio marker     -> 0, "Korean/Chinese Audio"
    5. no marker at all                         -> 0, "Audio Unspecified"

    Rule 2 precedes rule 3 so a dub-only release can never be promoted to the
    multi-audio class by an unrelated "Dual Audio" token.
    """
    if not title:
        return AUDIO_OTHER, LABEL_UNKNOWN

    if _has_japanese_audio(title):
        return AUDIO_JPN_EXPLICIT, LABEL_JPN

    if _matches_any(NON_JAPANESE_DUB_PATTERNS, title):
        return AUDIO_OTHER, LABEL_OTHER_DUB

    if _matches_any(MULTI_AUDIO_PATTERNS, title):
        return AUDIO_MULTI, LABEL_MULTI

    if parsed:
        audio_term = str(parsed.get("audio_term") or "")
        if audio_term and _matches_any(MULTI_AUDIO_PATTERNS, audio_term):
            return AUDIO_MULTI, LABEL_MULTI

    if _matches_any(ORIGINAL_LANGUAGE_PATTERNS, title):
        return AUDIO_OTHER, LABEL_ORIGINAL

    return AUDIO_OTHER, LABEL_UNKNOWN


def detect_subtitle_language(
    title: str,
    parsed: Optional[Dict[str, Any]] = None
) -> Tuple[int, str]:
    """Classify a release title's subtitle tracks. Returns ``(rank, label)``.

    Precedence: English declared -> raw / non-English-only -> unknown. English is
    checked first because multi-language WEB-DL sets legitimately list other
    languages alongside English.
    """
    if not title:
        return SUB_UNKNOWN, LABEL_SUB_UNKNOWN

    if _matches_any(ENGLISH_SUB_PATTERNS, title):
        return SUB_ENG_DECLARED, LABEL_SUB_ENG

    if _matches_any(NO_SUB_PATTERNS, title):
        return SUB_NON_ENG_ONLY, LABEL_SUB_NONE

    if _matches_any(NON_ENGLISH_SUB_PATTERNS, title):
        return SUB_NON_ENG_ONLY, LABEL_SUB_OTHER

    return SUB_UNKNOWN, LABEL_SUB_UNKNOWN


def is_japanese_dub(title: str, parsed: Optional[Dict[str, Any]] = None) -> bool:
    """True when the release explicitly declares a Japanese audio/dub track."""
    return detect_audio_language(title, parsed)[0] == AUDIO_JPN_EXPLICIT


def has_english_subs(title: str, parsed: Optional[Dict[str, Any]] = None) -> bool:
    """True when the release declares English subtitles."""
    return detect_subtitle_language(title, parsed)[0] == SUB_ENG_DECLARED
