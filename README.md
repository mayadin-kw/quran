# القرآن الكريم — قراءة واستماع

موقع ثابت (HTML/CSS/JS بدون أي مكتبات) لقراءة القرآن الكريم برسم المصحف العثماني، مع الاستماع والتفسير والبحث. يعمل على GitHub Pages مباشرة.

## المصادر
- **نص القرآن الكريم:** [Tanzil.net](https://tanzil.net) (الرواية العثمانية، ترقيم صفحات مصحف المدينة ٦٠٤ صفحة) — يُنشر النص كما هو دون أي تعديل.
- **التفسير الميسر:** مجمع الملك فهد لطباعة المصحف الشريف (عبر api.alquran.cloud).
- **التلاوات:** [EveryAyah.com](https://everyayah.com)، ملف لكل آية، وتُشغَّل مباشرة من هناك.

## إعادة بناء ملفات البيانات
```
python3 tools/build_data.py <مجلد فيه quran-uthmani.json و quran-simple-clean.json و ar.muyassar.json>
```
(الملفات من `https://api.alquran.cloud/v1/quran/<edition>`)

## تسجيل صوت التفسير (Google Cloud Text-to-Speech)
يُنتج ملفاً واحداً لكل آية في `audio/tafsir/` (جزء الآية ثم شرحه) مع `index.json` لأزمنة المقاطع.
الآيات التي ليس لها ملف تُقرأ بصوت الجهاز.
```
export GOOGLE_TTS_KEY=...
python3 tools/tafsir_audio.py --voice ar-XA-Chirp3-HD-Charon --sample 2:2   # عيّنة: sample.mp3
python3 tools/tafsir_audio.py --voice ar-XA-Chirp3-HD-Charon --surah 1-114
```
