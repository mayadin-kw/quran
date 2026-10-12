"""Builds the compact data files in ../data from the alquran.cloud (Tanzil) editions.
Usage: python3 build_data.py <raw_dir>"""
import json, sys, os, re

raw = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'data')
load = lambda n: json.load(open(os.path.join(raw, n + '.json')))['data']['surahs']
U, S, T = load('quran-uthmani'), load('quran-simple-clean'), load('ar.muyassar')

NAME_FIX = {'ال عمران': 'آل عمران', 'المائـدة': 'المائدة', 'سبإ': 'سبأ', 'النبإ': 'النبأ'}
BASM_S = 'بسم الله الرحمن الرحيم'.split()

def align(uw, sw):
    """Merge vocative particles (يا) that the simple text writes separately."""
    if len(uw) == len(sw):
        return sw
    out, i = [], 0
    while i < len(sw):
        w = sw[i]
        if w in ('يا', 'ويا', 'أيا') and i + 1 < len(sw):
            out.append(w + '_' + sw[i + 1]); i += 2  # '_' keeps both parts searchable
        else:
            out.append(w); i += 1
    return out if len(out) == len(uw) else None

surahs, ayat, clean, tafsir = [], [], [], []
bad = 0
for su, ss, st in zip(U, S, T):
    n = su['number']
    first_page = su['ayahs'][0]['page']
    name = re.sub(r'[\u064B-\u065F\u0670\u06D6-\u06ED]', '', re.sub(r'^سُورَةُ\s*', '', su['name'])).replace('ٱ', 'ا')
    name = NAME_FIX.get(name, name)
    surahs.append({'n': n, 'name': name, 'type': 'مكية' if su['revelationType'] == 'Meccan' else 'مدنية',
                   'count': len(su['ayahs']), 'page': first_page})
    for a, b, c in zip(su['ayahs'], ss['ayahs'], st['ayahs']):
        uw, sw = a['text'].replace('\ufeff', '').split(), b['text'].replace('\ufeff', '').split()
        if a['numberInSurah'] == 1 and n not in (1, 9):
            uw = uw[4:]
            assert sw[:4] == BASM_S, (n, sw[:4])
            sw = sw[4:]
        al = align(uw, sw)
        if al is None:
            bad += 1
        ayat.append([n, a['numberInSurah'], a['page'], a['juz'], a['hizbQuarter'], ' '.join(uw)])
        clean.append(' '.join(al) if al else '!' + ' '.join(sw))  # '!' = no word alignment
        tafsir.append(c['text'])

dump = lambda name, obj: json.dump(obj, open(os.path.join(out, name), 'w', encoding='utf-8'),
                                   ensure_ascii=False, separators=(',', ':'))
dump('quran.json', {'surahs': surahs, 'ayat': ayat})
dump('search.json', clean)
dump('tafsir.json', tafsir)
print('ayat', len(ayat), 'unaligned', bad)
