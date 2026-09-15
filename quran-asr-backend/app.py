from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from quran_asr.aligner import align
from quran_asr.normalizer import normalize, normalize_words
from quran_asr.recognizer import MODEL_ID, QuranRecognizer
from quran_asr.schemas import CheckResponse, WordResult

MAX_BYTES = 8 * 1024 * 1024
MAX_SECONDS = 30.0
MIN_SECONDS = 0.35
ALLOWED_MIME = {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"}
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "https://mayadin-kw.github.io").split(",")
REQUIRE_FIREBASE_AUTH = os.getenv("REQUIRE_FIREBASE_AUTH", "true").lower() == "true"
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "12"))
recognizer = QuranRecognizer()
rate_windows: dict[str, deque[float]] = defaultdict(deque)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Cloud Run receives readiness only after the model is resident in memory.
    await asyncio.to_thread(recognizer.load)
    yield


app = FastAPI(title="Quran ASR", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=True, allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])


def verify_firebase_token(request: Request) -> None:
    if not REQUIRE_FIREBASE_AUTH:
        return
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "firebase_auth_required")
    try:
        import firebase_admin
        from firebase_admin import auth
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        auth.verify_id_token(header[7:])
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(401, "invalid_firebase_token") from error


def rate_limit(request: Request) -> None:
    address = request.client.host if request.client else "unknown"
    now = time.monotonic(); window = rate_windows[address]
    while window and now - window[0] > 60: window.popleft()
    if len(window) >= RATE_LIMIT:
        raise HTTPException(429, "rate_limit_exceeded")
    window.append(now)


def duration_seconds(path: Path) -> float:
    output = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)], text=True).strip()
    return float(output)


def to_wav(source: Path, target: Path) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-ac", "1", "-ar", "16000", "-af", "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=1:stop_threshold=-45dB", str(target)], check=True, timeout=45)


def validate_form(surah: int, ayah: int, verse_key: str, start: int, end: int, expected_text: str, expected_words: list[str]) -> None:
    if not 1 <= surah <= 114 or ayah < 1 or verse_key != f"{surah}:{ayah}": raise HTTPException(422, "invalid_verse_metadata")
    if start < 0 or end < start or end - start > 80 or not expected_words or len(expected_words) > 100: raise HTTPException(422, "invalid_word_range")
    if len(expected_text) > 1200: raise HTTPException(422, "expected_text_too_long")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_ID, "modelLoaded": recognizer.loaded}


@app.get("/ready")
def ready() -> dict:
    if not recognizer.loaded: raise HTTPException(503, "model_loading")
    return {"status": "ready", "model": MODEL_ID}


@app.post("/api/recitation/check", response_model=CheckResponse)
async def check_recitation(request: Request, audio: UploadFile = File(...), surah: int = Form(...), ayah: int = Form(...), verseKey: str = Form(...), segmentStartWord: int = Form(...), segmentEndWord: int = Form(...), expectedText: str = Form(...), expectedWords: str = Form(...)) -> CheckResponse:
    verify_firebase_token(request); rate_limit(request)
    try: words_raw = json.loads(expectedWords)
    except json.JSONDecodeError as error: raise HTTPException(422, "invalid_expected_words") from error
    if not isinstance(words_raw, list) or not all(isinstance(word, str) for word in words_raw): raise HTTPException(422, "invalid_expected_words")
    validate_form(surah, ayah, verseKey, segmentStartWord, segmentEndWord, expectedText, words_raw)
    if audio.content_type not in ALLOWED_MIME: raise HTTPException(415, "unsupported_audio_type")
    data = await audio.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES: raise HTTPException(413, "audio_too_large")
    if not data: return CheckResponse(success=False, error="no_speech_detected")
    with tempfile.TemporaryDirectory(prefix="quran-asr-") as directory:
        source, wav = Path(directory) / "recording", Path(directory) / "recording.wav"
        source.write_bytes(data)
        try:
            if not MIN_SECONDS <= duration_seconds(source) <= MAX_SECONDS: return CheckResponse(success=False, error="no_speech_detected")
            to_wav(source, wav)
            recognized_text, latency = await asyncio.to_thread(recognizer.transcribe, wav)
        except (subprocess.SubprocessError, ValueError): return CheckResponse(success=False, error="invalid_audio")
    expected = normalize_words(words_raw); recognized = normalize_words(normalize(recognized_text).split())
    alignment = align(expected, recognized)
    results = [WordResult(expectedWordIndex=item.expected_index, expected=item.expected, recognized=item.recognized, status=item.status) for item in alignment]
    mismatch = next((item for item in alignment if item.status in {"wrong", "missing"}), None)
    correct = mismatch is None and not any(item.status == "extra" for item in alignment) and bool(expected)
    first_mismatch = None if mismatch is None else {"expectedWordIndex": mismatch.expected_index, "type": "substitution" if mismatch.status == "wrong" else "missing"}
    print(json.dumps({"event": "recognition", "verseKey": verseKey, "seconds": round(latency, 3), "correct": correct}), flush=True)
    return CheckResponse(success=True, verseKey=verseKey, recognizedText=recognized_text, normalizedRecognizedText=" ".join(recognized), confidence=None, correct=correct, words=results, firstMismatch=first_mismatch)
