"""Live recitation checking for the Tasmee' page (runs on the VPS).

WebSocket at ws://127.0.0.1:8088/ws (Caddy serves it as wss://…/quran-asr/ws).

The page sends 16 kHz mono 16-bit PCM as binary messages, plus JSON:
  {"type": "expect", "words": [Uthmani words of the range], "ptr": n}   at the start
  {"type": "ptr", "ptr": n}       when the page moved on by itself (a skip, a word shown after 3 tries)

The server answers with JSON:
  {"type": "match", "items": [p, ...]}    expected words heard, confirmed while the reader speaks
                                           (asr_ctc.py: Quran CTC model, aligned every 0.3 s)
  {"type": "partial", "text": "..."}       speech after the last confirmed word, so far (display only)
  {"type": "verify", "text": "...", "items": [p, ...], "cut": bool}
                                           after a pause (or STALL seconds without progress), the
                                           phrase as Tarteel's Whisper model heard it, with diacritics:
                                           the page checks the harakat of the words confirmed in it
                                           (items) and judges the rest as mistakes, skips or re-reading;
                                           cut: the phrase was cut while the reader spoke (its last
                                           word may be incomplete)

Setup on the server (see README):
  python3 -m venv venv && venv/bin/pip install faster-whisper==1.1.1 websockets==13.1 requests
  venv/bin/python -c "from huggingface_hub import snapshot_download as d; d('OdyAsh/faster-whisper-base-ar-quran', local_dir='model')"
  fc/: model_int8.onnx, fb.bin, vocab.json from mrmuminov/quran-fastconformer-ctc-ar (onnx/ folder)
  venv/bin/python asr_server.py
"""
import asyncio, json, logging, os, time
from http import HTTPStatus
import numpy as np
import websockets
from faster_whisper import WhisperModel
import asr_ctc

HERE = os.path.dirname(os.path.abspath(__file__))
ORIGINS = os.environ.get('ASR_ORIGINS', 'https://mayadin-kw.github.io,https://yadin-kw.github.io,http://localhost:8765').split(',')
SR = 16000
FRAME = SR * 30 // 1000          # 30 ms energy frames
SPEECH_RMS = 0.012               # louder than this counts as voice
PAUSE = 0.6                      # seconds of quiet that end a phrase
STEP_EVERY = 0.3                 # how often the expected words are aligned
STALL = 4.0                      # speech this long that matches nothing: verify the phrase now
MIN_VOICE = 0.6                  # seconds of voice in a phrase before Whisper hears it (it invents words in silence)
MAX_CLIENTS = 4
MAX_SESSION = 45 * 60

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger('asr')
ctc = asr_ctc.Model(os.path.join(HERE, 'fc'), threads=2)
whisper = WhisperModel(os.path.join(HERE, 'model'), device='cpu', compute_type='int8', cpu_threads=1)
ctc_lock = asyncio.Lock()        # the CPU is small: one alignment at a time, one Whisper pass at a time
whisper_lock = asyncio.Lock()
clients = set()


def transcribe(audio):
    # no vad_filter: Silero VAD cut long madd and lost words
    segments, _ = whisper.transcribe(audio, language='ar', beam_size=1, vad_filter=False,
                                     condition_on_previous_text=False, without_timestamps=True)
    return ' '.join(s.text.strip() for s in segments).strip()


async def in_thread(lock, fn, *args):
    async with lock:
        return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


async def session(ws):
    if len(clients) >= MAX_CLIENTS:
        await ws.close(1013, 'busy')
        return
    clients.add(ws)
    started = time.time()
    se = asr_ctc.Session(ctc)
    st = {'voice': 0.0, 'quiet': 0.0, 'stepped': 0, 'rest': '', 'progress': time.time(),
          'phrase_start': 0, 'phrase_items': [], 'phrase_voice': 0.0}
    pending = np.zeros(0, np.float32)
    tasks = set()

    async def send(obj):
        try:
            await ws.send(json.dumps(obj, ensure_ascii=False))
        except websockets.ConnectionClosed:
            pass

    async def step(final=False):
        if not se.words or se.end - se.anchor < SR // 2:
            return
        st['stepped'] = se.end
        items, rest = await in_thread(ctc_lock, se.step, final)
        if items:
            st['progress'] = time.time()
            st['phrase_items'] += items
            await send({'type': 'match', 'items': items})
        if rest != st['rest']:
            st['rest'] = rest
            await send({'type': 'partial', 'text': rest})

    async def verify(audio, items, cut):
        text = await in_thread(whisper_lock, transcribe, audio)
        if text or items:
            await send({'type': 'verify', 'text': text, 'items': items, 'cut': cut})

    async def end_phrase(cut=False):
        """The reader paused (or is stuck): confirm what can be, then let Whisper hear the phrase."""
        await step(final=not cut)
        st['progress'] = time.time()
        items, st['phrase_items'] = st['phrase_items'], []
        voice, st['phrase_voice'] = st['phrase_voice'], 0.0
        audio = se.audio[max(0, st['phrase_start'] - se.base):]
        st['phrase_start'] = se.end
        if voice >= MIN_VOICE or items:
            task = asyncio.create_task(verify(audio.copy(), items, cut))
            tasks.add(task)
            task.add_done_callback(tasks.discard)

    async def loop():
        while True:
            await asyncio.sleep(STEP_EVERY)
            if st['voice'] <= 0 or se.end - st['stepped'] < SR // 10:
                continue
            if st['quiet'] >= PAUSE:
                st['voice'] = 0.0
                await end_phrase()
                continue
            await step()
            # stuck: saying something that matches nothing (not just holding a long madd)
            if time.time() - st['progress'] > STALL and sum(c.isalpha() for c in st['rest']) >= 6:
                await end_phrase(cut=True)

    runner = asyncio.create_task(loop())
    try:
        async for msg in ws:
            if time.time() - started > MAX_SESSION:
                break
            if isinstance(msg, str):
                d = json.loads(msg)
                if d.get('type') == 'expect':
                    se.expect(d['words'], int(d.get('ptr', 0)))
                    se.anchor = st['phrase_start'] = max(se.base, se.end - SR // 2)
                    st['progress'] = time.time()
                elif d.get('type') == 'ptr':  # the page moved on after judging a phrase
                    se.ptr = int(d['ptr'])
                    se.anchor = max(se.anchor, st['phrase_start'] - SR // 2)
                    st['progress'] = time.time()
                continue
            samples = np.frombuffer(msg, np.int16).astype(np.float32) / 32768
            se.feed(samples)
            pending = np.concatenate([pending, samples])
            n = len(pending) // FRAME
            for k in range(n):
                frame = pending[k * FRAME:(k + 1) * FRAME]
                if np.sqrt(np.mean(frame ** 2)) > SPEECH_RMS:
                    if st['voice'] <= 0:  # a new phrase: drop the silence before it, keep 0.5 s
                        st['phrase_start'] = max(st['phrase_start'], se.end - SR // 2)
                    st['voice'] += 0.03
                    st['phrase_voice'] += 0.03
                    st['quiet'] = 0.0
                elif st['voice'] > 0:
                    st['quiet'] += 0.03
            pending = pending[n * FRAME:]
    except websockets.ConnectionClosed:
        pass
    finally:
        runner.cancel()
        for task in tasks:
            task.cancel()
        clients.discard(ws)


async def main():
    async with websockets.serve(session, '127.0.0.1', 8088, origins=ORIGINS, max_size=2 ** 20,
                                ping_interval=20, ping_timeout=60,
                                process_request=lambda path, headers: None if path == '/ws' else (HTTPStatus.NOT_FOUND, [], b'')):
        log.info('listening on 127.0.0.1:8088')
        await asyncio.Future()


if __name__ == '__main__':
    asyncio.run(main())
