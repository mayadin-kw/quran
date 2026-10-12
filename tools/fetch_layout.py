"""Downloads the Madani mushaf (QCF V1) word layout per page from api.quran.com.
Usage: python3 fetch_layout.py <out_dir>"""
import json, sys, os, urllib.request, concurrent.futures, time

out = sys.argv[1]
URL = ('https://api.quran.com/api/v4/verses/by_page/{p}?words=true&mushaf=1&per_page=50&page={n}'
       '&word_fields=code_v1,line_number,text_imlaei,text_uthmani')

def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            time.sleep(1 + attempt * 2)
    raise RuntimeError(url)

def page(p):
    path = os.path.join(out, f'{p}.json')
    if os.path.exists(path):
        return
    verses, n = [], 1
    while n:
        d = get(URL.format(p=p, n=n))
        verses += d['verses']
        n = d['pagination']['next_page']
    json.dump(verses, open(path, 'w'), ensure_ascii=False)

with concurrent.futures.ThreadPoolExecutor(6) as ex:
    list(ex.map(page, range(1, 605)))
print('done')
