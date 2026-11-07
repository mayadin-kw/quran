"""Live, word-by-word checking of a recitation against the expected text (used by asr_server.py).

Acoustic model: mrmuminov/quran-fastconformer-ctc-ar (CC-BY-4.0, derived from NVIDIA's
stt_ar_fastconformer_hybrid_large_pcd_v1.0), a character CTC model that outputs Uthmani text with
diacritics, run as ONNX (int8) on the CPU. About 25 output frames per second.

Instead of only transcribing, every few hundred milliseconds the recent audio is aligned (CTC
Viterbi) with the next expected words. A word is confirmed as soon as all its letters are found,
in order, with enough probability, and the audio has moved past it, so words appear while the
reader is still speaking, without waiting for a pause. Speech that does not continue the
expected text is judged by asr_server.py from Whisper's transcript of the phrase (more accurate
than this model's greedy text), and so are the harakat: this model's vowel posteriors gave false
alarms on professional reciters.

Model files in <dir>: model_int8.onnx, fb.bin (mel filterbank), vocab.json.
"""
import json
import numpy as np
import onnxruntime as ort

SR = 16000
FRAME = SR // 25                 # samples per output frame
CONTEXT = int(0.4 * SR)          # audio kept before the last confirmed word
MAX_WINDOW = 12 * SR             # longest audio aligned at once
LOOKAHEAD = 6                    # expected words tried per step
MIN_LETTER = 0.5                 # mean letter probability (relative to the frame's best) to accept a word
TAIL = 3                         # frames that must follow a word before it counts as finished

TANWEEN = {'ࣰ': 'ً', 'ࣱ': 'ٌ', 'ࣲ': 'ٍ'}  # open tanween → plain tanween
MARKS = set('ًٌٍَُِّْٰٓٔـ'
            'ۣۜ۟۠ۢۥۦ۪ۭۧۨ۫۬')


class Model:
    def __init__(self, folder, threads=2):
        self.fb = np.fromfile(f'{folder}/fb.bin', dtype=np.float32).reshape(80, 257).astype(np.float64)
        self.chars = json.load(open(f'{folder}/vocab.json', encoding='utf-8'))
        self.ids = {c: i for i, c in enumerate(self.chars)}
        self.blank = len(self.chars)
        self.space = self.ids[' ']
        self.mark_ids = [i for i, c in enumerate(self.chars) if c in MARKS]
        self.win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(400) / 399)
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        self.sess = ort.InferenceSession(f'{folder}/model_int8.onnx', opts, providers=['CPUExecutionProvider'])

    def features(self, wave):
        """NeMo log-mel: preemphasis .97, Hann(400) in a 512 FFT, hop 160, power, mel, log(x+2^-24), per-feature norm."""
        x = np.append(wave[0], wave[1:] - 0.97 * wave[:-1]).astype(np.float64)
        length = len(x) // 160
        frames = length + 1
        pad = np.pad(x, (256, 256 + 512))
        idx = np.arange(frames)[:, None] * 160 + 56 + np.arange(400)[None, :]
        seg = np.zeros((frames, 512))
        seg[:, 56:456] = pad[idx] * self.win
        logmel = np.log((np.abs(np.fft.rfft(seg, axis=1)) ** 2) @ self.fb.T + 2 ** -24).T
        mean = logmel[:, :length].mean(1, keepdims=True)
        std = logmel[:, :length].std(1, ddof=1, keepdims=True) + 1e-5
        out = np.zeros_like(logmel)
        out[:, :length] = (logmel[:, :length] - mean) / std
        return out[None].astype(np.float32), np.array([length], dtype=np.int64)

    def log_probs(self, wave):
        f, n = self.features(wave)
        return self.sess.run(None, {'features': f, 'lengths': n})[0][0]  # [frames, vocab + blank]

    def labels(self, word):
        """Label ids of a word in the model's alphabet, which are letters (not marks), and the
        index in `word` of each label's character."""
        out, letter, pos = [], [], []
        for k, ch in enumerate(word):
            ch = TANWEEN.get(ch, ch)
            if ch in self.ids and ch != ' ':
                out.append(self.ids[ch])
                letter.append(ch not in MARKS)
                pos.append(k)
        return out, letter, pos

    def greedy(self, lp):
        """[(char, frame)] by greedy CTC decoding."""
        best = lp.argmax(1)
        out, prev = [], -1
        for t, b in enumerate(best):
            if b != prev and b != self.blank:
                out.append((self.chars[b], t))
            prev = b
        return out


def align(model, lp, words):
    """CTC Viterbi of `words` (list of model.labels results) against lp, with free start and end.

    Only letters are aligned: a diacritic the model wrote differently (a reciter stopping on a
    word changes its last vowel) must not reject the word, so marks are merged into blank, like
    space (CTC is unsure where spaces go). Emissions are relative to each frame's best label, so
    frames outside the words cost nothing and a letter that is not really there costs a lot.
    Returns paths: paths[j] is, for the best path through words 0..j only, [(letter
    confidence, first frame, last frame)] per word. Each prefix has its own path: the path
    through more words would squeeze earlier words to make room for words not yet said.
    """
    T = lp.shape[0]
    rel = lp - lp.max(1, keepdims=True)
    blank = np.logaddexp.reduce(rel[:, [model.blank, model.space] + model.mark_ids], axis=1)
    words = [[l for l, is_letter in zip(w[0], w[1]) if is_letter] for w in words]
    y = [l for w in words for l in w]
    L = len(y)
    if not L or T < 2:
        return []
    S = 2 * L + 1
    ys = np.array(y)
    em = np.empty((T, S))
    em[:, 0::2] = blank[:, None]
    em[:, 1::2] = rel[:, ys]
    skip_ok = np.zeros(S, bool)
    skip_ok[3::2] = ys[1:] != ys[:-1]
    NEG = -1e9
    delta = np.full(S, NEG)
    delta[0], delta[1] = em[0, 0], em[0, 1]
    back = np.zeros((T, S), np.int8)  # 0 stay, 1 from s-1, 2 from s-2, 3 started here
    back[0, :2] = 3
    ends = np.cumsum([len(w) for w in words]) * 2 - 1  # state of each word's last label
    best_end = np.full(len(words), NEG)  # best score of a path that leaves after word j
    best_end_t = np.zeros(len(words), int)
    best_end_s = np.zeros(len(words), int)
    for t in range(1, T):
        s1 = np.concatenate(([NEG], delta[:-1]))
        s2 = np.concatenate(([NEG, NEG], delta[:-2]))
        s2[~skip_ok] = NEG
        cand = np.stack([delta, s1, s2])
        arg = cand.argmax(0)
        new = cand[arg, np.arange(S)]
        start = np.full(S, NEG)
        start[:2] = 0.0  # start here: the frames before cost nothing
        use_start = start > new
        new = np.where(use_start, start, new) + em[t]
        back[t] = np.where(use_start, 3, arg)
        delta = new
        for j, e in enumerate(ends):
            for s in (e, e + 1):
                if s < S and delta[s] > best_end[j]:
                    best_end[j], best_end_t[j], best_end_s[j] = delta[s], t, s
    paths = []
    for j in range(len(words)):
        if best_end[j] <= NEG / 2:
            break
        t, s = best_end_t[j], best_end_s[j]
        first = {}
        while t >= 0:
            if s % 2 == 1:
                first[s] = t  # earliest frame of this label (overwritten while going back)
            b = back[t, s]
            if b == 3:
                break
            s -= b
            t -= 1
        lo, stats = 0, []
        for w in words[:j + 1]:
            sts = [2 * (lo + i) + 1 for i in range(len(w))]
            lo += len(w)
            if any(st not in first for st in sts):
                return paths
            frames = [first[st] for st in sts]
            letters = [np.exp(em[first[st], st]) for st in sts]
            stats.append((float(np.mean(letters)) if letters else 0.0, min(frames), max(frames)))
        paths.append(stats)
    return paths


class Session:
    """State of one reader: the expected words, how far they got, and the audio not yet confirmed."""

    def __init__(self, model):
        self.m = model
        self.text, self.words = [], []
        self.ptr = 0
        self.audio = np.zeros(0, np.float32)
        self.base = 0        # absolute sample index of self.audio[0]
        self.anchor = 0      # absolute sample after the last confirmed word

    def expect(self, words, ptr=0):
        self.text = list(words)
        self.words = [self.m.labels(w) for w in words]
        self.ptr = ptr

    def feed(self, samples):
        self.audio = np.concatenate([self.audio, samples])
        drop = len(self.audio) - (MAX_WINDOW + CONTEXT + 4 * SR)
        if drop > 0:
            self.audio = self.audio[drop:]
            self.base += drop
            self.anchor = max(self.anchor, self.base)

    @property
    def end(self):
        return self.base + len(self.audio)

    def step(self, final=False):
        """Align the audio after the anchor. Returns (confirmed word indexes, unconfirmed text).
        With final=True (the reader paused) the last word counts even with no audio after it."""
        start = max(self.base, self.anchor - CONTEXT, self.end - MAX_WINDOW)
        x = self.audio[start - self.base:]
        if len(x) < SR // 2:
            return [], ''
        lp = self.m.log_probs(x)
        T = lp.shape[0]
        skip = max(0, (self.anchor - start) // FRAME)  # frames that belong to earlier words
        chars = [(c, t) for c, t in self.m.greedy(lp) if t >= skip]
        confirmed = []
        if self.ptr < len(self.words):
            paths = align(self.m, lp[skip:], self.words[self.ptr:self.ptr + LOOKAHEAD])
            limit = T - 1 - (0 if final else TAIL)
            n, end = 0, None  # the most words whose own path is good all along and finished
            for j, path in enumerate(paths):
                if all(c >= MIN_LETTER for c, _, _ in path) and path[-1][2] + skip <= limit:
                    n, end = j + 1, path[-1][2]
            if n:
                confirmed = list(range(self.ptr, self.ptr + n))
                self.ptr += n
                self.anchor = start + (end + skip + 1) * FRAME
            if confirmed:
                last = (self.anchor - start) // FRAME
                chars = [(c, t) for c, t in chars if t >= last]
        return confirmed, ''.join(c for c, _ in chars).strip()
