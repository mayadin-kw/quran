"""Builds the compact data files in ../data.

Inputs (in <raw_dir>):
  pages2/<p>.json          — output of fetch_layout.py (api.quran.com, Madani mushaf QCF V1 layout)
  quran-uthmani.json       — https://api.alquran.cloud/v1/quran/quran-uthmani (surah meta, juz, hizb)

The tafsir (data/tafsir.json) is built separately by saadi_text.py.

Usage: python3 build_data.py <raw_dir>
"""
import json, sys, os, re

raw = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'data')

DIAC = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ﻿]')


def norm(s):
    s = DIAC.sub('', s)
    for a, b in (('أ', 'ا'), ('إ', 'ا'), ('آ', 'ا'), ('ٱ', 'ا'), ('ى', 'ي'), ('ة', 'ه'), ('ؤ', 'و'), ('ئ', 'ي')):
        s = s.replace(a, b)
    return ' '.join(s.split())


NAME_FIX = {'ال عمران': 'آل عمران', 'المائـدة': 'المائدة', 'سبإ': 'سبأ', 'النبإ': 'النبأ'}
tanzil = json.load(open(os.path.join(raw, 'quran-uthmani.json')))['data']['surahs']

surahs, meta = [], {}
for su in tanzil:
    name = re.sub(r'^سُورَةُ\s*', '', su['name'])
    name = DIAC.sub('', name).replace('ٱ', 'ا')
    surahs.append({'n': su['number'], 'name': NAME_FIX.get(name, name),
                   'type': 'مكية' if su['revelationType'] == 'Meccan' else 'مدنية',
                   'count': len(su['ayahs']), 'page': su['ayahs'][0]['page']})
    for a in su['ayahs']:
        meta[(su['number'], a['numberInSurah'])] = (a['juz'], a['hizbQuarter'])

# ---- layout ----
ayat, search, first_line, max_line = [], [], {}, {}
for p in range(1, 605):
    for v in json.load(open(os.path.join(raw, 'pages2', f'{p}.json'))):
        s, a = map(int, v['verse_key'].split(':'))
        glyphs, lines, uth, iml = [], [], [], []
        for w in v['words']:
            glyphs.append(w['code_v1'])
            lines.append(w['line_number'])
            max_line[p] = max(max_line.get(p, 0), w['line_number'])
            if w['char_type_name'] == 'word':
                uth.append(w['text_uthmani'])
                iml.append(norm(w['text_imlaei']).replace(' ', '_'))
        assert v['words'][-1]['char_type_name'] == 'end' and len(uth) == len(glyphs) - 1, v['verse_key']
        if a == 1:
            first_line[s] = ((p - 1) * 15 + lines[0] - 1)
        juz, hizb = meta[(s, a)]
        ayat.append([s, a, p, juz, hizb, glyphs, lines, uth])
        search.append(' '.join(iml))
assert len(ayat) == 6236

# surah header ("h") and basmala ("b") lines, which may sit on the page before the surah
marks = {}
for s, g in first_line.items():
    items = [('h', g - 1)] if s in (1, 9) else [('h', g - 2), ('b', g - 1)]
    for kind, gl in items:
        marks.setdefault(str(gl // 15 + 1), []).append([kind, gl % 15 + 1, s])
lines_per_page = {str(p): max_line[p] for p in (1, 2)}

dump = lambda name, obj: json.dump(obj, open(os.path.join(out, name), 'w', encoding='utf-8'),
                                   ensure_ascii=False, separators=(',', ':'))
dump('quran.json', {'surahs': surahs, 'ayat': ayat, 'marks': marks, 'shortPages': lines_per_page})
dump('search.json', search)
print('ayat', len(ayat))
