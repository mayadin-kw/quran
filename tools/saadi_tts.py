"""Reads Tafsir as-Sa'di aloud with a Gemini TTS voice: one audio clip per tafsir unit.

Units come from ../data/tafsir.json (tools/saadi_text.py). To save requests, several
consecutive units go into one request separated by a "[long pause]" tag; the audio is cut
at the N-1 longest silences, which that tag makes clearly longer than sentence pauses.
A cut is accepted only if those silences stand out (or, failing that, each one is a long
pause close to where the text lengths put the boundary) and every piece's length fits its
text; otherwise the group is halved and retried, down to one unit per request.
Units longer than CHUNK characters are read in several requests and joined.

When the quota runs out (HTTP 429) it waits and carries on, so it can run for days on
the free tier. Finished clips are kept; re-running skips them.

Output: <out>/<SSSAAA>.m4a (HE-AAC 24 kbps with macOS afconvert, else AAC 40 kbps with
ffmpeg), named after the unit's last ayah, and
<out>/index.json: {"ext", "ayat": [last ayah index of each clip], "shared": {other
ayah index of a unit: its last ayah index}} — the format js/app.js reads.

Key: GEMINI_API_KEY, or the file .work/gemini.key.
Usage: python3 tools/saadi_tts.py <out dir> [surah or range, e.g. 78-114]
Needs numpy, and afconvert (macOS) or ffmpeg.
"""
import base64, json, os, re, subprocess, sys, time, urllib.error, urllib.request, wave
import shutil
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MODEL, VOICE = 'gemini-3.8-flash-tts', 'Orus'
BATCH = 3000          # characters per request (about 5 minutes of audio)
CHUNK = 3000          # longer units are read in pieces of at most this size
MAX_UNITS = 6         # bigger groups split less reliably, wasting requests
SEP = '\n\n[long pause]\n\n'
HOP = 240             # 10 ms at 24 kHz
SILENCE_DB = -45


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def speech_text(t):
    t = t.replace('{', ' ').replace('}', ' ').replace('[', '').replace(']', '').replace(',', '،')
    return re.sub(r'\s+', ' ', t).strip()


def chunks(text):
    """Pieces of at most CHUNK characters, cut after sentences."""
    out, cur = [], ''
    for s in re.split(r'(?<=[.؟!:])\s+', text):
        if cur and len(cur) + len(s) + 1 > CHUNK:
            out.append(cur)
            cur = s
        else:
            cur = f'{cur} {s}'.strip()
    return out + [cur] if cur else out


def key():
    k = os.environ.get('GEMINI_API_KEY')
    return k or open(os.path.join(ROOT, '.work', 'gemini.key')).read().strip()


class Quota(Exception):
    pass


def synth(text):
    """Mono float32 samples at 24 kHz."""
    body = json.dumps({'contents': [{'parts': [{'text': text}]}],
                       'generationConfig': {'responseModalities': ['AUDIO'],
                                            'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': VOICE}}}}}).encode()
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent'
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, body, {'Content-Type': 'application/json', 'x-goog-api-key': key()})
            d = json.load(urllib.request.urlopen(req, timeout=600))
            data = base64.b64decode(d['candidates'][0]['content']['parts'][0]['inlineData']['data'])
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors='replace')
            if e.code == 429:
                raise Quota(msg)
            if e.code >= 500 and attempt < 4:
                time.sleep(10 * (attempt + 1))
                continue
            raise SystemExit(f'Gemini error {e.code}: {msg[:400]}')
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError) as e:
            if attempt < 4:
                time.sleep(10 * (attempt + 1))
                continue
            raise
    if data[:4] == b'RIFF':  # skip the WAV header
        i = 12
        while data[i:i + 4] != b'data':
            i += 8 + int.from_bytes(data[i + 4:i + 8], 'little')
        data = data[i + 8:]
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768


def synth_waiting(text):
    """synth(), sleeping through quota limits."""
    waits = 0
    while True:
        try:
            return synth(text)
        except Quota as q:
            waits += 1
            daily = 'PerDay' in str(q) or waits > 6
            delay = re.search(r'"retryDelay": "(\d+)s"', str(q))
            pause = int(delay.group(1)) + 30 if delay else (3600 if daily else 65)
            log(f'quota reached, waiting {pause // 60} min' + (' (daily limit)' if daily else ''))
            time.sleep(pause)


def silences(x):
    """[(start sample, end sample)] of pauses of at least 0.25 s."""
    n = len(x) // HOP
    db = 20 * np.log10(np.sqrt((x[:n * HOP].reshape(n, HOP) ** 2).mean(1)) + 1e-6)
    out, st = [], None
    for i, quiet in enumerate(np.append(db < SILENCE_DB, False)):
        if quiet and st is None:
            st = i
        elif not quiet and st is not None:
            if i - st >= 25:
                out.append((st * HOP, i * HOP))
            st = None
    return out


def split(x, lengths):
    """Cut x into len(lengths) pieces at the longest pauses, or None if the cut is doubtful."""
    n = len(lengths)
    if n == 1:
        return [x]
    gaps = silences(x)
    inner = [g for g in gaps if 0 < g[0] and g[1] < len(x)]
    if len(inner) < n - 1:
        return None
    by_len = sorted(inner, key=lambda g: g[1] - g[0], reverse=True)
    chosen = sorted(by_len[:n - 1])
    shortest = min(g[1] - g[0] for g in chosen)
    rest = by_len[n - 1][1] - by_len[n - 1][0] if len(by_len) >= n else 0
    if shortest >= 0.95 * 24000 and shortest - rest >= 0.25 * 24000:
        pieces = cut(x, chosen)
        if fits(pieces, lengths):
            return pieces
    # otherwise: near where each boundary should be (by text length), take the longest pause
    total, chosen, pos = sum(lengths), [], 0
    for k in range(n - 1):
        pos += lengths[k]
        expect = pos / total * len(x)
        near = [g for g in inner if abs((g[0] + g[1]) / 2 - expect) < 0.12 * len(x)
                and (not chosen or g[0] > chosen[-1][1])]
        if not near:
            return None
        g = max(near, key=lambda g: g[1] - g[0])
        if g[1] - g[0] < 0.9 * 24000:
            return None
        chosen.append(g)
    pieces = cut(x, chosen)
    return pieces if fits(pieces, lengths) else None


def cut(x, gaps):
    cuts = [0] + [(a + b) // 2 for a, b in gaps] + [len(x)]
    return [x[cuts[k]:cuts[k + 1]] for k in range(len(cuts) - 1)]


def fits(pieces, lengths):
    """Every piece is within a factor of 1.6 of the length its text predicts."""
    rate = sum(len(p) for p in pieces) / sum(lengths)
    return all(0.62 < len(p) / (l * rate) < 1.6 for p, l in zip(pieces, lengths))


def trim(x, pad=0.2):
    n = len(x) // HOP
    loud = np.nonzero(20 * np.log10(np.sqrt((x[:n * HOP].reshape(n, HOP) ** 2).mean(1)) + 1e-6) > SILENCE_DB)[0]
    if not len(loud):
        return x
    p = int(pad * 24000)
    return x[max(0, loud[0] * HOP - p):min(len(x), (loud[-1] + 1) * HOP + p)]


def save(x, path, work):
    tmp = os.path.join(work, 'clip.wav')
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
        w.writeframes((np.clip(trim(x), -1, 1) * 32767).astype(np.int16).tobytes())
    if shutil.which('afconvert'):
        cmd = ['afconvert', '-f', 'm4af', '-d', 'aach', '-b', '24000', tmp, path + '.part']
    else:
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'aac', '-b:a', '40k',
               '-movflags', '+faststart', '-f', 'mp4', path + '.part']
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.replace(path + '.part', path)


def main():
    out = os.path.abspath(sys.argv[1])
    first, _, last = (sys.argv[2] if len(sys.argv) > 2 else '1-114').partition('-')
    surahs = range(int(first), int(last or first) + 1)
    work = os.path.join(ROOT, '.work', 'tts')
    os.makedirs(out, exist_ok=True)
    os.makedirs(work, exist_ok=True)
    Q = json.load(open(os.path.join(ROOT, 'data', 'quran.json')))
    units = json.load(open(os.path.join(ROOT, 'data', 'tafsir.json')))['units']
    name = lambda u: '{:03d}{:03d}.m4a'.format(*Q['ayat'][u[1]][:2])

    def write_index():
        idx = {'ext': 'm4a', 'ayat': [], 'shared': {}}
        for u in units:
            if os.path.exists(os.path.join(out, name(u))):
                idx['ayat'].append(u[1])
                idx['shared'].update({str(k): u[1] for k in range(u[0], u[1])})
        json.dump(idx, open(os.path.join(out, 'index.json.part'), 'w'), separators=(',', ':'))
        os.replace(os.path.join(out, 'index.json.part'), os.path.join(out, 'index.json'))
        return len(idx['ayat'])

    todo = [u for u in units if Q['ayat'][u[0]][0] in surahs and u[2] and not os.path.exists(os.path.join(out, name(u)))]
    log(f'{len(todo)} units to read, {sum(len(u[2]) for u in todo):,} characters')
    queue, requests = [], 0
    # groups of consecutive short units; long units alone
    for u in todo:
        t = speech_text(u[2])
        if len(t) > BATCH:
            queue.append([(u, t)])
        elif queue and len(queue[-1]) < MAX_UNITS and len(queue[-1][0][1]) <= BATCH \
                and sum(len(t2) for _, t2 in queue[-1]) + len(t) <= BATCH:
            queue[-1].append((u, t))
        else:
            queue.append([(u, t)])

    while queue:
        group = queue.pop(0)
        if len(group) == 1 and len(group[0][1]) > CHUNK:
            u, t = group[0]
            parts = []
            for c in chunks(t):
                parts.append(trim(synth_waiting(c)))
                requests += 1
            save(np.concatenate([np.concatenate([p, np.zeros(9600, np.float32)]) for p in parts]), os.path.join(out, name(u)), work)
        else:
            x = synth_waiting(SEP.join(t for _, t in group))
            requests += 1
            pieces = split(x, [len(t) for _, t in group])
            if pieces is None:
                half = len(group) // 2
                log(f'unclear cut in a group of {len(group)} units, retrying in halves')
                queue[:0] = [group[:half], group[half:]]
                continue
            for (u, _), p in zip(group, pieces):
                save(p, os.path.join(out, name(u)), work)
        done = write_index()
        log(f'{done}/{len(units)} clips, {requests} requests this run, {len(queue)} groups left')
    write_index()
    log('done')


if __name__ == '__main__':
    main()
