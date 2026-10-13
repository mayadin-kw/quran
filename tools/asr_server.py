"""Live Quran recitation recognition for the Tasmee' page (runs on the VPS).

WebSocket at ws://127.0.0.1:8088/ws (Caddy serves it as wss://…/quran-asr/ws).
The browser streams 16 kHz mono 16-bit PCM in small binary messages; the server
answers with JSON {"type": "partial" | "final", "text": "..."}:
  partial — the current phrase so far, re-recognised (quick model) about every
            second while the reader speaks;
  final   — the phrase once the reader pauses (or after MAX_PHRASE seconds).

Models (Tarteel's Quran fine-tunes of Whisper, CTranslate2 form, run by faster-whisper on the CPU;
both output Quranic text with the diacritics actually heard):
  partials — tarteel-ai/whisper-tiny-ar-quran (hafizku/faster-whisper-tiny-ar-quran), ~0.7 s per update
  finals   — tarteel-ai/whisper-base-ar-quran (OdyAsh/faster-whisper-base-ar-quran, Apache-2.0), more accurate

Setup on the server (see README):
  python3 -m venv venv && venv/bin/pip install faster-whisper==1.1.1 websockets==13.1 requests
  venv/bin/python -c "from huggingface_hub import snapshot_download as d; d('OdyAsh/faster-whisper-base-ar-quran', local_dir='model'); d('hafizku/faster-whisper-tiny-ar-quran', local_dir='model-tiny')"
  venv/bin/python asr_server.py
"""
import asyncio, json, logging, os, time
from http import HTTPStatus
import numpy as np
import websockets
from faster_whisper import WhisperModel

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get('ASR_MODEL', os.path.join(HERE, 'model'))
FAST_DIR = os.environ.get('ASR_FAST_MODEL', os.path.join(HERE, 'model-tiny'))
THREADS = int(os.environ.get('ASR_THREADS', '2'))  # leave a core for the other services on the server
ORIGINS = os.environ.get('ASR_ORIGINS', 'https://mayadin-kw.github.io,https://yadin-kw.github.io,http://localhost:8765').split(',')
SR = 16000
FRAME = SR * 30 // 1000          # 30 ms energy frames
SPEECH_RMS = 0.012               # louder than this counts as speech
PAUSE = 0.7                      # seconds of quiet that end a phrase
MAX_PHRASE = 25.0                # longest phrase sent to the model at once (it reads up to 30 s)
MIN_VOICE = 1.0                  # seconds of voice before a phrase is recognised: shorter bits make the model guess
PRE_ROLL = 0.3                   # audio kept from before speech starts
PARTIAL_EVERY = 0.4
MAX_CLIENTS = 4
MAX_SESSION = 45 * 60

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger('asr')
model = WhisperModel(MODEL_DIR, device='cpu', compute_type='int8', cpu_threads=THREADS)
fast = WhisperModel(FAST_DIR, device='cpu', compute_type='int8', cpu_threads=THREADS) if os.path.isdir(FAST_DIR) else model
busy = asyncio.Lock()            # one recognition at a time: the CPU is small
clients = set()


def recognise(audio, quick=False):
    # بلا vad_filter: مرشّح الصمت يقص المدود الطويلة فيضيع كلمات (السيرفر يقطع الصمت بنفسه)
    segments, _ = (fast if quick else model).transcribe(audio, language='ar', beam_size=1, vad_filter=False,
                                   condition_on_previous_text=False, without_timestamps=True)
    return ' '.join(s.text.strip() for s in segments).strip()


async def run(audio, quick=False):
    async with busy:
        return await asyncio.get_running_loop().run_in_executor(None, recognise, audio, quick)


async def session(ws):
    if len(clients) >= MAX_CLIENTS:
        await ws.close(1013, 'busy')
        return
    clients.add(ws)
    started = time.time()
    phrase = np.zeros(0, np.float32)
    state = {'speech': False, 'quiet': 0.0, 'voice': 0.0, 'version': 0, 'decoded': 0}
    pending = np.zeros(0, np.float32)

    async def send(kind, text):
        if text:
            await ws.send(json.dumps({'type': kind, 'text': text}, ensure_ascii=False))

    async def partials():
        while True:
            await asyncio.sleep(PARTIAL_EVERY)
            if state['voice'] < MIN_VOICE or len(phrase) - state['decoded'] < SR * 0.3 or busy.locked():
                continue
            version, audio = state['version'], phrase.copy()
            text = await run(audio, quick=True)
            if version == state['version']:  # the phrase was not closed meanwhile
                state['decoded'] = len(audio)
                await send('partial', text)

    async def close_phrase():
        nonlocal phrase
        audio, voice = phrase, state['voice']
        state.update(speech=False, quiet=0.0, voice=0.0, decoded=0, version=state['version'] + 1)
        phrase = np.zeros(0, np.float32)
        if voice >= MIN_VOICE / 2:
            await send('final', await run(audio))

    task = asyncio.create_task(partials())
    try:
        async for msg in ws:
            if time.time() - started > MAX_SESSION:
                break
            if not isinstance(msg, bytes):
                continue
            pending = np.concatenate([pending, np.frombuffer(msg, np.int16).astype(np.float32) / 32768])
            n = len(pending) // FRAME
            for k in range(n):
                frame = pending[k * FRAME:(k + 1) * FRAME]
                loud = np.sqrt(np.mean(frame ** 2)) > SPEECH_RMS
                phrase = np.concatenate([phrase, frame])
                if loud:
                    state['speech'], state['quiet'] = True, 0.0
                    state['voice'] += 0.03
                elif state['speech']:
                    state['quiet'] += 0.03
                else:
                    phrase = phrase[-int(SR * PRE_ROLL):]
                if state['speech'] and (state['quiet'] >= PAUSE or len(phrase) >= SR * MAX_PHRASE):
                    await close_phrase()
            pending = pending[n * FRAME:]
    except websockets.ConnectionClosed:
        pass
    finally:
        task.cancel()
        clients.discard(ws)


async def main():
    async with websockets.serve(session, '127.0.0.1', 8088, origins=ORIGINS, max_size=2 ** 20, ping_interval=20, ping_timeout=60,
                                process_request=lambda path, headers: None if path == '/ws' else (HTTPStatus.NOT_FOUND, [], b'')):
        log.info('listening on 127.0.0.1:8088 (%d threads)', THREADS)
        await asyncio.Future()


if __name__ == '__main__':
    asyncio.run(main())
