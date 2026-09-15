from quran_asr.aligner import align
from quran_asr.normalizer import normalize


def statuses(expected, recognized):
    return [(item.expected_index, item.status) for item in align(expected, recognized)]


def test_substitution_is_ordered():
    assert statuses(["ا", "ب", "ج", "د"], ["ا", "ب", "س", "د"]) == [(0, "correct"), (1, "correct"), (2, "wrong"), (3, "correct")]


def test_missing_and_extra_are_reported():
    assert statuses(["ا", "ب", "ج"], ["ا", "ج"]) == [(0, "correct"), (1, "missing"), (2, "correct")]
    assert statuses(["ا", "ب"], ["ا", "ب", "ج"]) == [(0, "correct"), (1, "correct"), (None, "extra")]


def test_normalizer_preserves_word_identity_but_removes_marks():
    assert normalize("ٱلرَّحْمَٰنِـ") == "الرحمن"
