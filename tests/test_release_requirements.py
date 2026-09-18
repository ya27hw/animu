"""Per-anime release requirements + selection behaviour. No network."""
import json

import anitopy
import pytest

from animu.config import get_config
from animu.prefs import ReleasePrefsManager
from animu.release_tracks import (
    AUDIO_JPN_EXPLICIT,
    AUDIO_MULTI,
    AUDIO_OTHER,
    LABEL_JPN,
    LABEL_MULTI,
    LABEL_ORIGINAL,
    LABEL_SUB_ENG,
    LABEL_SUB_UNKNOWN,
    LABEL_UNKNOWN,
    SUB_ENG_DECLARED,
    SUB_UNKNOWN,
    detect_audio_language,
    detect_subtitle_language,
)

TRK_JPN = "[ToonsHub] Tomb Raider King S01E11 1080p CR WEB-DL AAC2.0 H.264 (Dogulwang, Multi-Subs, Japanese Dub)"
TRK_ENG = "[Yameii] Tomb Raider King - S01E09 [English Dub] [CR WEB-DL 1080p H264 AAC] [F24C7AD1] (Dogul Wang)"


@pytest.fixture()
def store(tmp_path):
    return ReleasePrefsManager(path=str(tmp_path / "release_prefs.json"))


def test_prefs_empty_by_default(store):
    assert store.get(184356) == {}
    assert store.is_enrolled(184356) is False


def test_prefs_set_and_read_back(store):
    store.set(184356, require_japanese_audio=True, require_english_subs=True)
    prefs = store.get(184356)
    assert prefs["require_japanese_audio"] is True
    assert prefs["require_english_subs"] is True
    assert store.is_enrolled(184356) is True
    # Persisted to disk, keyed by string media id.
    raw = json.loads(open(store.path, encoding="utf-8").read())
    assert raw["184356"]["require_english_subs"] is True


def test_prefs_partial_update_keeps_other_flag(store):
    store.set(184356, require_japanese_audio=True)
    store.set(184356, require_english_subs=True)
    assert store.get(184356) == {"require_japanese_audio": True, "require_english_subs": True}


def test_prefs_delete_and_get_all(store):
    store.set(184356, require_japanese_audio=True)
    store.set(999, require_english_subs=True)
    assert set(store.get_all()) == {"184356", "999"}
    assert store.delete(184356) is True
    assert store.get(184356) == {}
    assert store.delete(184356) is False


def test_prefs_survives_reload(tmp_path):
    path = str(tmp_path / "release_prefs.json")
    ReleasePrefsManager(path=path).set(184356, require_japanese_audio=True)
    assert ReleasePrefsManager(path=path).get(184356)["require_japanese_audio"] is True


def test_prefs_corrupt_file_is_not_fatal(tmp_path):
    path = tmp_path / "release_prefs.json"
    path.write_text("{not json", encoding="utf-8")
    assert ReleasePrefsManager(path=path).get(184356) == {}


def test_global_config_flags_exist_and_default_off():
    from animu.config import MAP_ATTR_TO_JSON, MAP_JSON_TO_ATTR, ProfileConfig

    assert ProfileConfig(media_id=1).prefer_japanese_dub is False
    assert ProfileConfig(media_id=1).require_english_subs is False
    assert MAP_JSON_TO_ATTR["preferJapaneseDub"] == "prefer_japanese_dub"
    assert MAP_JSON_TO_ATTR["requireEnglishSubs"] == "require_english_subs"
    assert MAP_ATTR_TO_JSON["prefer_japanese_dub"] == "preferJapaneseDub"
    assert MAP_ATTR_TO_JSON["require_english_subs"] == "requireEnglishSubs"


def test_global_require_english_subs_feeds_requirements(monkeypatch):
    from animu import prefs as prefs_module

    cfg = get_config()
    monkeypatch.setattr(cfg, "require_english_subs", True)
    assert prefs_module.get_requirements(1)["require_english_subs"] is True
    monkeypatch.setattr(cfg, "require_english_subs", False)
    assert prefs_module.get_requirements(1)["require_english_subs"] is False


# ---------------------------------------------------------------------------
# verify_query: the blanket "dub" rejection must become language-aware
# ---------------------------------------------------------------------------

from animu.utils import verify_query


def _vq(title, episode=11, query='Tomb Raider King "11"'):
    return verify_query(
        query,
        anitopy.parse(title) or {},
        "1080",
        "EPISODE",
        "Sat, 04 Oct 2025 10:00:00 GMT",
        {"nodes": []},
        True,
        0,
        episode,
        verbose=True,
    )


def test_english_dub_still_rejected():
    score, details = _vq(TRK_ENG)
    assert score == 0.0
    assert details["rejection_reason"] == "Dubbed audio tracks"


def test_japanese_dub_not_rejected_when_preference_enabled(monkeypatch):
    monkeypatch.setattr(get_config(), "prefer_japanese_dub", True)
    # Bracketed form: anitopy reports subtitles == "Dub", which used to zero it.
    score, details = _vq("[ToonsHub] Tomb Raider King - S01E11 [1080p][Japanese Dub].mkv")
    assert score > 0.0, details["rejection_reason"]
    assert details["rejection_reason"] == ""


def test_japanese_dub_still_rejected_when_preference_disabled(monkeypatch):
    monkeypatch.setattr(get_config(), "prefer_japanese_dub", False)
    score, _ = _vq("[ToonsHub] Tomb Raider King - S01E11 [1080p][Japanese Dub].mkv")
    assert score == 0.0  # exact current behaviour when the feature is off


def test_parenthesised_japanese_dub_was_never_rejected():
    score, details = _vq(TRK_JPN)
    assert score > 0.0, details["rejection_reason"]


# ---------------------------------------------------------------------------
# select_best_candidate: audio + subtitle gates
# ---------------------------------------------------------------------------

from animu.release_groups import select_best_candidate


def _cand(title, rating=4.0, seeders=100, group="ToonsHub", group_score=82.0,
          audio_rank=AUDIO_OTHER, audio_label=LABEL_UNKNOWN,
          sub_rank=SUB_ENG_DECLARED, sub_label=LABEL_SUB_ENG):
    return {
        "title": title,
        "rating": rating,
        "seeders": seeders,
        "release_group": group,
        "group_score": group_score,
        "censorship_class": 1,
        "audio_rank": audio_rank,
        "audio_label": audio_label,
        "subtitle_rank": sub_rank,
        "subtitle_label": sub_label,
        "item": {"title": title, "link": "http://nyaa.si/download/x.torrent"},
        "details": {},
    }


TRK_ANOZU_EP11 = "[AnoZu] Tomb Raider King S01E11 1080p CR WEB-DL AAC 2.0 H.264 | Dogulwang"
TRK_JPN_EP11 = "[ToonsHub] Tomb Raider King S01E11 1080p CR WEB-DL AAC2.0 H.264 (Dogulwang, Multi-Subs, Japanese Dub)"
TRK_KOR_EP11 = "[ToonsHub] Tomb Raider King S01E11 1080p CR WEB-DL AAC2.0 H.264 (Dogulwang, Multi-Subs, Korean Audio)"
TRK_DUAL_EP11 = "[ToonsHub] Tomb Raider King S01E11 1080p CR WEB-DL DUAL AAC2.0 H.264 (Dogulwang, Dual-Audio, Multi-Subs)"
TRK_BILI_EP11 = "[ToonsHub] Tomb Raider King S01E11 1080p BILI WEB-DL AAC2.0 H.265 (Dogulwang, Multi-Subs)"
TRK_VARYG_EP11 = "Tomb Raider King S01E11 Tian Fus Relic 1080p CR WEB-DL AAC2.0 H.264-VARYG (Dogul Wang, Multi-Subs)"
TRK_DOOMDOS_EP11 = "[Doomdos] - Tomb Raider King - 11 [1080p IQ WEB-DL]"
TRK_RAZE_EP11 = "[Raze] Tomb Raider King (Dogulwang) - 11 (MultiSub) x265 10bit 1080p 143.8561fps.mkv"


def test_audio_preference_beats_higher_seeder_count():
    # Live reproduction: 103 seeders, unspecified audio vs 89 seeders, Japanese dub.
    ano_zu = _cand(TRK_ANOZU_EP11, seeders=103, group="AnoZu", group_score=45.0)
    toons_jpn = _cand(TRK_JPN_EP11, seeders=89, audio_rank=AUDIO_JPN_EXPLICIT, audio_label=LABEL_JPN)
    toons_kor = _cand(TRK_KOR_EP11, seeders=59, audio_label=LABEL_ORIGINAL)

    off = select_best_candidate([ano_zu, toons_jpn, toons_kor], prefer_release_group=False)
    assert off["title"] == TRK_ANOZU_EP11  # today's behaviour: most seeders wins, wrong language

    on = select_best_candidate([ano_zu, toons_jpn, toons_kor],
                              prefer_release_group=False, prefer_japanese_dub=True)
    assert on["title"] == TRK_JPN_EP11
    assert on["audio_rank"] == AUDIO_JPN_EXPLICIT
    assert on["audio_label"] == LABEL_JPN


def test_audio_preference_falls_back_when_nothing_declares_japanese():
    raze = _cand(TRK_RAZE_EP11, seeders=17, group="Raze", group_score=45.0)
    bili = _cand(TRK_BILI_EP11, seeders=83)
    without = select_best_candidate([raze, bili], prefer_release_group=False)
    with_pref = select_best_candidate([raze, bili], prefer_release_group=False, prefer_japanese_dub=True)
    assert with_pref["title"] == without["title"] == TRK_BILI_EP11


def test_audio_preference_picks_multi_audio_over_untagged():
    multi = _cand(TRK_DUAL_EP11, seeders=55, audio_rank=AUDIO_MULTI, audio_label=LABEL_MULTI)
    untagged = _cand(TRK_BILI_EP11, seeders=200)
    res = select_best_candidate([multi, untagged], prefer_release_group=False, prefer_japanese_dub=True)
    assert res["title"] == TRK_DUAL_EP11


def test_require_japanese_audio_is_a_hard_gate():
    multi = _cand(TRK_DUAL_EP11, seeders=55, audio_rank=AUDIO_MULTI, audio_label=LABEL_MULTI)
    untagged = _cand(TRK_BILI_EP11, seeders=200)
    res = select_best_candidate([multi, untagged], prefer_release_group=False,
                                require_japanese_audio=True)
    assert res["title"] == TRK_DUAL_EP11
    # Nothing qualifies -> no download at all (visible, never a silent wrong pick).
    assert select_best_candidate([untagged], prefer_release_group=False,
                                 require_japanese_audio=True) is None


def test_require_english_subs_is_a_hard_gate():
    unknown_subs = _cand(TRK_DOOMDOS_EP11, seeders=300, sub_rank=SUB_UNKNOWN, sub_label=LABEL_SUB_UNKNOWN)
    eng_subs = _cand(TRK_JPN_EP11, seeders=89, audio_rank=AUDIO_JPN_EXPLICIT, audio_label=LABEL_JPN)

    res = select_best_candidate([unknown_subs, eng_subs], prefer_release_group=False,
                                require_english_subs=True)
    assert res["title"] == TRK_JPN_EP11
    assert select_best_candidate([unknown_subs], prefer_release_group=False,
                                 require_english_subs=True) is None


def test_requirements_pick_the_japanese_dub_english_subs_release():
    pool = [
        _cand(TRK_ANOZU_EP11, seeders=103, group="AnoZu", group_score=45.0),
        _cand(TRK_DOOMDOS_EP11, seeders=120, group="Doomdos", group_score=45.0,
              sub_rank=SUB_UNKNOWN, sub_label=LABEL_SUB_UNKNOWN),
        _cand(TRK_DUAL_EP11, seeders=55, audio_rank=AUDIO_MULTI, audio_label=LABEL_MULTI),
        _cand(TRK_JPN_EP11, seeders=89, audio_rank=AUDIO_JPN_EXPLICIT, audio_label=LABEL_JPN),
    ]
    res = select_best_candidate(pool, prefer_release_group=False, prefer_japanese_dub=True,
                                require_japanese_audio=True, require_english_subs=True)
    assert res["title"] == TRK_JPN_EP11


def test_candidates_without_the_new_keys_still_selectable():
    old_style = {"title": "x", "rating": 4.0, "seeders": 10, "release_group": None,
                 "group_score": 45.0, "censorship_class": 1, "item": {"title": "x"}, "details": {}}
    assert select_best_candidate([old_style], prefer_japanese_dub=True)["title"] == "x"



