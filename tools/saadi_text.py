"""Builds ../data/tafsir.json from Tafsir as-Sa'di (Quran.com API, tafsir id 91).

as-Sa'di sometimes explains several ayat in one passage. The API then either repeats the
passage on each of them or lists it only under the first, so consecutive ayat with the same
or no text are merged into one unit.

Output: {"units": [[first ayah index, last ayah index, text], ...]} in mushaf order.
Quotations of the Quran stay wrapped in { }.

Usage: python3 tools/saadi_text.py [cache dir]
"""
import json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
API = 'https://api.quran.com/api/v4/tafsirs/91/by_chapter/{}?per_page=300'


def chapter(s, cache):
    path = os.path.join(cache, f'{s}.json')
    if not os.path.exists(path):
        os.makedirs(cache, exist_ok=True)
        subprocess.run(['curl', '-sf', API.format(s), '-o', path], check=True)
    return json.load(open(path))['tafsirs']


def clean(html):
    t = re.sub('<[^>]+>', ' ', html)
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'\s*([{}])\s*', lambda m: ' {' if m.group(1) == '{' else '} ', t)  # one space outside braces
    t = re.sub(r'([.،:؛])(?=\S)', r'\1 ', t)
    return re.sub(r'\s+', ' ', t).strip()


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.work', 'saadi')
    Q = json.load(open(os.path.join(ROOT, 'data', 'quran.json')))
    text = {}
    for s in range(1, 115):
        for t in chapter(s, cache):
            text[t['verse_key']] = clean(t['text'])
    units = []
    for i, (s, a) in enumerate((x[0], x[1]) for x in Q['ayat']):
        t = text.get(f'{s}:{a}', '')
        last = units[-1] if units else None
        if last and Q['ayat'][last[0]][0] == s and (not t or t == last[2]):
            last[1] = i
        else:
            units.append([i, i, t])
    json.dump({'units': units}, open(os.path.join(ROOT, 'data', 'tafsir.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    print(len(units), 'units,', sum(1 for u in units if u[1] > u[0]), 'covering several ayat,',
          sum(len(u[2]) for u in units), 'chars')


if __name__ == '__main__':
    main()
