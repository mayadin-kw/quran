# القرآن الكريم — قراءة واستماع

موقع ثابت (HTML/CSS/JS بدون أي مكتبات) لقراءة القرآن الكريم برسم المصحف العثماني، مع الاستماع والتفسير والبحث. يعمل على GitHub Pages مباشرة.

## المصادر
- **نص القرآن الكريم:** [Tanzil.net](https://tanzil.net) (الرواية العثمانية، ترقيم صفحات مصحف المدينة ٦٠٤ صفحة) — يُنشر النص كما هو دون أي تعديل.
- **التفسير:** تفسير السعدي (عبر Quran.com API)، وصوته مولَّد بـ Google Gemini TTS.
- **التلاوات:** [EveryAyah.com](https://everyayah.com)، ملف لكل آية، وتُشغَّل مباشرة من هناك.

## إعادة بناء ملفات البيانات
```
python3 tools/build_data.py <مجلد فيه quran-uthmani.json و quran-simple-clean.json و ar.muyassar.json>
```
(الملفات من `https://api.alquran.cloud/v1/quran/<edition>`)

## التفسير (السعدي) وصوته
- النص: `python3 tools/saadi_text.py` يبني `data/tafsir.json` من تفسير السعدي (Quran.com API).
- الصوت: `tools/saadi_tts.py` يقرأ التفسير بصوت Gemini TTS (صوت Orus) — ملف لكل وحدة تفسير، مع `index.json`.
  يعمل على السيرفر كخدمة `quran-tafsir-tts` (يكمل تلقائياً كلما تجددت الحصة المجانية)، والملفات تُقدَّم من
  `https://162-35-27-249.sslip.io/quran-audio/tafsir/` (الرابط في `js/reciters.js`).
