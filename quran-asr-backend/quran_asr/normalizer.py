"""Conservative text normalization used only for Quran word matching."""
from __future__ import annotations

import re
import unicodedata

_MARKS = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
_NON_ARABIC = re.compile(r"[^\u0621-\u063A\u0641-\u064A\s]")


def normalize(text: str) -> str:
    """Keep lexical Arabic distinctions while removing non-lexical markings."""
    text = unicodedata.normalize("NFKC", text or "")
    text = _MARKS.sub("", text)
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ٱ", "ا").replace("ى", "ي")
    text = _NON_ARABIC.sub(" ", text)
    return " ".join(text.split())


def normalize_words(words: list[str]) -> list[str]:
    return [word for word in (normalize(word) for word in words) if word]
