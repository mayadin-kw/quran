"""Generates spoken tafsir audio with Google Cloud Text-to-Speech.

One MP3 per ayah in ../audio/tafsir/<SSSAAA>.mp3. Each file is the ayah's tafsir
parts read in order (ayah fragment, then its explanation, sentence by sentence) —
the same parts and order the site builds in tafsirItems() + chunksOf() in js/app.js.
The end time (ms) of every part goes into ../audio/tafsir/index.json so the site
can highlight the text in sync.

Usage:
  export GOOGLE_TTS_KEY=...            # API key with the Text-to-Speech API enabled
  python3 tools/tafsir_audio.py --voice ar-XA-Chirp3-HD-Charon --surah 1
  python3 tools/tafsir_audio.py --voice ar-XA-Chirp3-HD-Charon --surah 1-114

Already generated ayat are skipped, so the run can be stopped and resumed.
--sample writes a single ayah to ./sample.mp3 to try a voice.
"""
import argparse, base64, json, os, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'audio', 'tafsir')
API = 'https://texttospeech.googleapis.com/v1/text:synthesize?key='


# ---- نفس منطق الموقع (js/app.js) ----
def speakable(text):
    text = re.sub('ـ?ٰ', 'ا', text)
    text = text.replace('ٱ', 'ا').replace('ءَا', 'آ')
    text = re.sub('[ࣰ-ࣲ]', lambda m: chr(ord(m.group()) - 0x08F0 + 0x064B), text)
    text = re.sub('[ۖ-ۭـ]', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def chunks_of(text):
    out = []
    for p in filter(None, re.split(r'(?<=[.،؛:!؟])\s+', text)):
        ws = p.split(' ')
        for s in range(0, len(ws), 22):
            out.append(' '.join(ws[s:s + 22]))
    return out


def parts_of(words, segs):
    items = [{'q': ' '.join(words[fr:to + 1]) if fr >= 0 else '', 'e': e} for fr, to, e in segs]
    if not any(x['q'] for x in items):
        if items: items[0]['q'] = ' '.join(words)
        else: items.append({'q': ' '.join(words), 'e': ''})
    parts = []
    for it in items:
        if it['q']: parts.append(speakable(it['q']))
        if it['e']: parts.extend(chunks_of(it['e']))
    return parts


# ---- MP3: مدة كل مقطع، وحذف إطار Xing/Info حتى يصح دمج المقاطع ----
BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],   # MPEG-1 Layer III
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],       # MPEG-2/2.5 Layer III
}
RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def mp3_frames(data):
    """Returns (audio bytes without ID3/Xing, duration in seconds)."""
    i = 0
    if data[:3] == b'ID3':
        i = 10 + ((data[6] & 0x7f) << 21 | (data[7] & 0x7f) << 14 | (data[8] & 0x7f) << 7 | (data[9] & 0x7f))
    out, dur = bytearray(), 0.0
    while i + 4 <= len(data):
        h = data[i:i + 4]
        if h[0] != 0xFF or (h[1] & 0xE0) != 0xE0:
            i += 1
            continue
        ver, layer = (h[1] >> 3) & 3, (h[1] >> 1) & 3
        br_i, sr_i, pad = h[2] >> 4, (h[2] >> 2) & 3, (h[2] >> 1) & 1
        if ver == 1 or layer != 1 or br_i in (0, 15) or sr_i == 3:
            i += 1
            continue
        sr = RATES[ver][sr_i]
        br = BITRATES[1 if ver == 3 else 2][br_i] * 1000
        spf = 1152 if ver == 3 else 576
        size = (spf // 8) * br // sr + pad
        frame = data[i:i + size]
        if b'Xing' not in frame[:64] and b'Info' not in frame[:64]:
            out += frame
            dur += spf / sr
        i += size
    return bytes(out), dur


def synth(text, key, voice, rate):
    body = json.dumps({
        'input': {'text': text},
        'voice': {'languageCode': '-'.join(voice.split('-')[:2]), 'name': voice},
        'audioConfig': {'audioEncoding': 'MP3', 'speakingRate': rate},
    }).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request(API + key, body, {'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return base64.b64decode(json.load(r)['audioContent'])
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors='replace')
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(2 ** attempt)
                continue
            raise SystemExit(f'Google TTS error {e.code}: {msg}')
        except (urllib.error.URLError, TimeoutError):
            if attempt < 5:
                time.sleep(2 ** attempt)
                continue
            raise


def build_ayah(parts, key, voice, rate):
    audio, ends, t = bytearray(), [], 0.0
    for p in parts:
        frames, d = mp3_frames(synth(p, key, voice, rate))
        audio += frames
        t += d
        ends.append(round(t * 1000))
    return bytes(audio), ends


def surah_range(s):
    a, _, b = s.partition('-')
    return range(int(a), int(b or a) + 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', required=True, help='e.g. ar-XA-Chirp3-HD-Charon or ar-XA-Wavenet-B')
    ap.add_argument('--surah', default='1', help='surah or range, e.g. 2 or 1-114')
    ap.add_argument('--rate', type=float, default=1.0, help='speaking rate (0.25–2)')
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--sample', help='write one ayah (s:a, e.g. 2:2) to ./sample.mp3')
    args = ap.parse_args()
    key = os.environ.get('GOOGLE_TTS_KEY')
    if not key: sys.exit('Set GOOGLE_TTS_KEY first.')

    Q = json.load(open(os.path.join(ROOT, 'data', 'quran.json')))
    T = json.load(open(os.path.join(ROOT, 'data', 'tafsir.json')))
    ayat = Q['ayat']

    if args.sample:
        s, a = map(int, args.sample.split(':'))
        i = next(k for k, x in enumerate(ayat) if x[0] == s and x[1] == a)
        audio, ends = build_ayah(parts_of(ayat[i][7], T[i]), key, args.voice, args.rate)
        open('sample.mp3', 'wb').write(audio)
        print(f'sample.mp3 — {ends[-1] / 1000:.1f}s, {len(ends)} parts')
        return

    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, 'index.json')
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else {'voice': args.voice, 'ayat': {}}
    if index['voice'] != args.voice:
        sys.exit(f"index.json was made with {index['voice']}; delete audio/tafsir to switch voice.")

    surahs = set(surah_range(args.surah))
    todo = [i for i, x in enumerate(ayat) if x[0] in surahs and str(i) not in index['ayat']]
    chars = sum(len(p) for i in todo for p in parts_of(ayat[i][7], T[i]))
    print(f'{len(todo)} ayat to generate, ~{chars:,} characters')

    def job(i):
        audio, ends = build_ayah(parts_of(ayat[i][7], T[i]), key, args.voice, args.rate)
        s, a = ayat[i][0], ayat[i][1]
        with open(os.path.join(OUT, f'{s:03d}{a:03d}.mp3'), 'wb') as f: f.write(audio)
        return i, ends

    done = 0
    with ThreadPoolExecutor(args.workers) as ex:
        for fut in as_completed([ex.submit(job, i) for i in todo]):
            i, ends = fut.result()
            index['ayat'][str(i)] = ends
            done += 1
            if done % 25 == 0 or done == len(todo):
                json.dump(index, open(idx_path, 'w'), separators=(',', ':'))
                print(f'  {done}/{len(todo)}')
    json.dump(index, open(idx_path, 'w'), separators=(',', ':'))


if __name__ == '__main__':
    main()
