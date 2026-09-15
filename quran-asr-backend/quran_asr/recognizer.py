"""One process-wide Whisper Large-v3 Quran recognizer."""
from __future__ import annotations

import os
import time
from pathlib import Path

import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

MODEL_ID = os.getenv("QURAN_ASR_MODEL", "wasimlhr/whisper-quran-v1")


class QuranRecognizer:
    def __init__(self) -> None:
        self.pipe = None
        self.loaded = False

    def load(self) -> None:
        if self.loaded:
            return
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device.startswith("cuda") else torch.float32
        processor = AutoProcessor.from_pretrained(MODEL_ID)
        model = AutoModelForSpeechSeq2Seq.from_pretrained(MODEL_ID, torch_dtype=dtype, low_cpu_mem_usage=True)
        model.to(device)
        self.pipe = pipeline("automatic-speech-recognition", model=model, tokenizer=processor.tokenizer, feature_extractor=processor.feature_extractor, torch_dtype=dtype, device=0 if device.startswith("cuda") else -1)
        self.loaded = True

    def transcribe(self, wav_path: Path) -> tuple[str, float]:
        if not self.loaded or not self.pipe:
            raise RuntimeError("model_not_loaded")
        started = time.perf_counter()
        result = self.pipe(str(wav_path), generate_kwargs={"language": "ar", "task": "transcribe"})
        return str(result.get("text", "")).strip(), time.perf_counter() - started
