# Quran ASR deployment

The GitHub Pages site now records real microphone audio and sends it to a
configurable HTTPS endpoint. It does not download a Whisper model into the
browser and does not describe browser speech recognition as Quran ASR.

## Selected deployment path

Use a separately hosted `POST /api/recitation/check` service running
`tarteel-ai/whisper-base-ar-quran` through Faster-Whisper/CTranslate2 INT8.
The model is Quran-focused and the model family is published under Apache-2.0.
It is a practical server-side baseline; a model download and measured latency
must be recorded on the chosen host before making accuracy claims.

The browser sends `audio`, `expectedText`, `expectedWords`, `verseKey`, and
`segmentIndex`. The response contract is:

```json
{
  "complete": false,
  "recognizedText": "…",
  "matchedWordIndexes": [0, 1],
  "mismatch": { "expectedWordIndex": 2 }
}
```

`matchedWordIndexes` drives the approved SVG word reveal directly. A mismatch
colours only the expected SVG word red; future words remain hidden.

Set `window.QuranASREndpoint` before `quran-asr-adapter.js` when the API lives
on a different HTTPS origin. Without that setting, the app calls the
same-origin path `/api/recitation/check`, which GitHub Pages cannot host.

## Why not browser-side Whisper now?

Quran-specific Whisper Base-class models are too large for an unconditional
mobile download and need device/WebGPU performance testing. The server path
keeps the reading site lightweight and gives a controlled place for audio
conversion, constrained word-sequence alignment, privacy policy, rate limits,
and objective accuracy evaluation.
