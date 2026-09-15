from __future__ import annotations

from pydantic import BaseModel, Field


class WordResult(BaseModel):
    expectedWordIndex: int | None = None
    expected: str | None = None
    recognized: str | None = None
    status: str
    confidence: float | None = None


class CheckResponse(BaseModel):
    success: bool
    verseKey: str | None = None
    recognizedText: str = ""
    normalizedRecognizedText: str = ""
    confidence: float | None = None
    correct: bool = False
    words: list[WordResult] = Field(default_factory=list)
    firstMismatch: dict | None = None
    error: str | None = None
