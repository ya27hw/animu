"""Audio + subtitle classification tests. Titles are real Nyaa release names."""
import anitopy

from animu.release_tracks import (
    AUDIO_JPN_EXPLICIT,
    AUDIO_MULTI,
    AUDIO_OTHER,
    LABEL_JPN,
    LABEL_MULTI,
    LABEL_ORIGINAL,
    LABEL_OTHER_DUB,
    LABEL_UNKNOWN,
    LABEL_SUB_ENG,
    LABEL_SUB_NONE,
    LABEL_SUB_OTHER,
    LABEL_SUB_UNKNOWN,
    SUB_ENG_DECLARED,
    SUB_NON_ENG_ONLY,
    SUB_UNKNOWN,
    detect_audio_language,
    detect_subtitle_language,
    is_japanese_dub,
)

TRK_JPN = "[ToonsHub] Tomb Raider King S01E11 1080p CR WEB-DL AAC2.0 H.264 (Dogulwang, Multi-Subs, Japanese Dub)"
TRK_KOR = "[ToonsHub] Tomb Raider King S01E11 1080p CR WEB-DL AAC2.0 H.264 (Dogulwang, Multi-Subs, Korean Audio)"
TRK_DUAL = "[ToonsHub] Tomb Raider King S01E09 1080p CR WEB-DL DUAL AAC2.0 H.264 (Dogulwang, Dual-Audio, Multi-Subs)"
TRK_VARYG = ("Tomb Raider King S01E08 The Secret of the Crow 1080p CR WEB-DL MULTi AAC2.0 H.264-VARYG "
             "(Dogulwang, Multi-Audio, Multi-Subs)")
TRK_ANOZU = "[AnoZu] Tomb Raider King S01E09 1080p CR WEB-DL Dual-Audio DDP 2.0 H.264 | Dogulwang"
TRK_ENG = "[Yameii] Tomb Raider King - S01E09 [English Dub] [CR WEB-DL 1080p H264 AAC] [F24C7AD1] (Dogul Wang)"
TRK_BILI = "[ToonsHub] Tomb Raider King S01E11 1080p BILI WEB-DL AAC2.0 H.265 (Dogulwang, Multi-Subs)"
TRK_RAZE = "[Raze] Tomb Raider King (Dogulwang) - 11 (MultiSub) x265 10bit 1080p 143.8561fps.mkv"
TRK_DOOMDOS = "[Doomdos] - Tomb Raider King - 第10话 - [1080p BILIBILI COM WEB-DL]"
TRK_FEIBAN = "[Feibanyama] Tomb Raider King S01E11 [IQIYI WebRip 2160p H265 Veryslow AAC Multi-Subs] (Dogul Wang)"


# ---------------------------- audio ---------------------------------------

def test_audio_explicit_japanese_dub_detected():
    assert detect_audio_language(TRK_JPN) == (AUDIO_JPN_EXPLICIT, LABEL_JPN)
    assert detect_audio_language("Show S01E01 1080p [JAP Dub] [Multi-Subs].mkv") == (AUDIO_JPN_EXPLICIT, LABEL_JPN)
    assert detect_audio_language("[Group] Show S01E01 1080p CR WEB-DL (Japanese Audio, Multi-Subs)") == (AUDIO_JPN_EXPLICIT, LABEL_JPN)
    # Bracketed form: anitopy reports subtitles == "Dub" for this one.
    assert detect_audio_language("[Group] Show - 01 [1080p][Japanese Dub].mkv") == (AUDIO_JPN_EXPLICIT, LABEL_JPN)
    assert detect_audio_language("[Group] Show - 01 [Dual Audio][Japanese Dub][1080p].mkv") == (AUDIO_JPN_EXPLICIT, LABEL_JPN)
    assert detect_audio_language("[Group] Show - 01 [JPN] [1080p].mkv") == (AUDIO_JPN_EXPLICIT, LABEL_JPN)


def test_audio_japanese_subtitle_tags_are_not_audio():
    assert detect_audio_language("[Group] Show - 01 [Japanese Subs].mkv") == (AUDIO_OTHER, LABEL_UNKNOWN)
    assert detect_audio_language("[Group] Show - 01 [JPN Subs] [1080p].mkv") == (AUDIO_OTHER, LABEL_UNKNOWN)


def test_audio_multi_dual_is_rank_one():
    for title in (TRK_DUAL, TRK_ANOZU, TRK_VARYG):
        assert detect_audio_language(title) == (AUDIO_MULTI, LABEL_MULTI)
    assert detect_audio_language("Some Show S01E01 1080p WEB.mkv", {"audio_term": "Dual-Audio"}) == (AUDIO_MULTI, LABEL_MULTI)


def test_audio_non_japanese_dub_beats_multi_audio():
    assert detect_audio_language(TRK_ENG) == (AUDIO_OTHER, LABEL_OTHER_DUB)
    assert detect_audio_language("Show S01E01 1080p WEB-DL Dual Audio English Dub.mkv") == (AUDIO_OTHER, LABEL_OTHER_DUB)


def test_audio_korean_and_untagged_are_rank_zero():
    assert detect_audio_language(TRK_KOR) == (AUDIO_OTHER, LABEL_ORIGINAL)
    for title in (TRK_BILI, TRK_RAZE, TRK_DOOMDOS, TRK_FEIBAN):
        assert detect_audio_language(title) == (AUDIO_OTHER, LABEL_UNKNOWN)


def test_audio_empty_and_helper():
    assert detect_audio_language("") == (AUDIO_OTHER, LABEL_UNKNOWN)
    assert detect_audio_language(None) == (AUDIO_OTHER, LABEL_UNKNOWN)
    assert is_japanese_dub(TRK_JPN) is True
    assert is_japanese_dub(TRK_KOR) is False
    assert is_japanese_dub("") is False


# ---------------------------- subtitles -----------------------------------

def test_subs_multi_subs_spellings_are_english():
    for title in (TRK_JPN, TRK_KOR, TRK_DUAL, TRK_VARYG, TRK_BILI, TRK_FEIBAN):
        assert detect_subtitle_language(title) == (SUB_ENG_DECLARED, LABEL_SUB_ENG)
    assert detect_subtitle_language(TRK_RAZE) == (SUB_ENG_DECLARED, LABEL_SUB_ENG)   # "(MultiSub)"
    assert detect_subtitle_language("Show - 01 [English Subs].mkv") == (SUB_ENG_DECLARED, LABEL_SUB_ENG)
    assert detect_subtitle_language("[Group] Show - 01 (1080p) [E-Subs].mkv") == (SUB_ENG_DECLARED, LABEL_SUB_ENG)


def test_subs_untagged_is_unknown():
    # The Bilibili-sourced Doomdos uploads carry no subtitle tag at all.
    assert detect_subtitle_language(TRK_DOOMDOS) == (SUB_UNKNOWN, LABEL_SUB_UNKNOWN)
    assert detect_subtitle_language(TRK_ANOZU) == (SUB_UNKNOWN, LABEL_SUB_UNKNOWN)
    assert detect_subtitle_language("") == (SUB_UNKNOWN, LABEL_SUB_UNKNOWN)
    assert detect_subtitle_language(None) == (SUB_UNKNOWN, LABEL_SUB_UNKNOWN)


def test_subs_non_english_only_and_raw():
    assert detect_subtitle_language("[Group] Show - 01 [1080p][CHS].mkv") == (SUB_NON_ENG_ONLY, LABEL_SUB_OTHER)
    assert detect_subtitle_language("[Group] Show - 01 [BIG5][1080p].mkv") == (SUB_NON_ENG_ONLY, LABEL_SUB_OTHER)
    assert detect_subtitle_language("[Group] Show - 01 [JPN Subs].mkv") == (SUB_NON_ENG_ONLY, LABEL_SUB_OTHER)
    assert detect_subtitle_language("[Group] Show - 01 [1080p][RAW].mkv") == (SUB_NON_ENG_ONLY, LABEL_SUB_NONE)
    # A group name containing "Raws" must not read as a raw release.
    assert detect_subtitle_language("Show.S01E01.1080p.BD.x264-Beatrice-Raws.mkv") == (SUB_UNKNOWN, LABEL_SUB_UNKNOWN)


def test_subs_english_wins_over_chinese_tokens():
    # Real multi-language WEB-DL sets list several languages; English presence is what matters.
    assert detect_subtitle_language("[Group] Show - 01 (1080p) [Multi-Subs] [CHS].mkv") == (SUB_ENG_DECLARED, LABEL_SUB_ENG)
