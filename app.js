const $ = (s) => document.querySelector(s);
const home = $('#home'), reader = $('#reader'), image = $('#quranImage');
const numberFormat = new Intl.NumberFormat('ar-EG');
const STORAGE_BASE_URL = 'https://firebasestorage.googleapis.com/v0/b/ihfad-2fecd.firebasestorage.app/o/';
const SURAH_NAMES = ['', 'الفاتحة', 'البقرة', 'آل عمران', 'النساء', 'المائدة', 'الأنعام', 'الأعراف', 'الأنفال', 'التوبة', 'يونس', 'هود', 'يوسف', 'الرعد', 'إبراهيم', 'الحجر', 'النحل', 'الإسراء', 'الكهف', 'مريم', 'طه', 'الأنبياء', 'الحج', 'المؤمنون', 'النور', 'الفرقان', 'الشعراء', 'النمل', 'القصص', 'العنكبوت', 'الروم', 'لقمان', 'السجدة', 'الأحزاب', 'سبأ', 'فاطر', 'يس', 'الصافات', 'ص', 'الزمر', 'غافر', 'فصلت', 'الشورى', 'الزخرف', 'الدخان', 'الجاثية', 'الأحقاف', 'محمد', 'الفتح', 'الحجرات', 'ق', 'الذاريات', 'الطور', 'النجم', 'القمر', 'الرحمن', 'الواقعة', 'الحديد', 'المجادلة', 'الحشر', 'الممتحنة', 'الصف', 'الجمعة', 'المنافقون', 'التغابن', 'الطلاق', 'التحريم', 'الملك', 'القلم', 'الحاقة', 'المعارج', 'نوح', 'الجن', 'المزمل', 'المدثر', 'القيامة', 'الإنسان', 'المرسلات', 'النبأ', 'النازعات', 'عبس', 'التكوير', 'الانفطار', 'المطففين', 'الانشقاق', 'البروج', 'الطارق', 'الأعلى', 'الغاشية', 'الفجر', 'البلد', 'الشمس', 'الليل', 'الضحى', 'الشرح', 'التين', 'العلق', 'القدر', 'البينة', 'الزلزلة', 'العاديات', 'القارعة', 'التكاثر', 'العصر', 'الهمزة', 'الفيل', 'قريش', 'الماعون', 'الكوثر', 'الكافرون', 'النصر', 'المسد', 'الإخلاص', 'الفلق', 'الناس'];
let currentPage = 1, touchStart = 0;

function imagePath(page) {
  const fileName = `quran-pages/page-${String(PAGE_MAP[page - 1].pdfPage).padStart(3, '0')}.jpg`;
  return `${STORAGE_BASE_URL}${encodeURIComponent(fileName)}?alt=media`;
}
function showLoading(page) {
  $('#loadingMessage').textContent = `يتم تجهيز الصفحة ${numberFormat.format(page)} من المصحف الشريف`;
  $('#loadingOverlay').classList.add('show');
}
function hideLoading() { $('#loadingOverlay').classList.remove('show'); }
function preloadNearby() {
  [currentPage - 1, currentPage + 1].filter(p => p >= 1 && p <= 604).forEach(p => { const preloaded = new Image(); preloaded.src = imagePath(p); });
}
function renderPage(direction = '', withLoader = false) {
  const page = PAGE_MAP[currentPage - 1];
  const chapter = Number(page.verses[0][0].split(':')[0]);
  $('#surahLabel').textContent = `سورة ${SURAH_NAMES[chapter]}، صفحة ${numberFormat.format(currentPage)}`;
  $('#pageSelect').value = currentPage;
  if (withLoader) showLoading(currentPage);

  image.className = '';
  const settle = () => { hideLoading(); image.removeEventListener('error', failed); };
  const failed = () => { hideLoading(); toast('تعذر تحميل الصفحة. يرجى المحاولة مرة أخرى.'); };
  image.addEventListener('load', settle, { once: true });
  image.addEventListener('error', failed, { once: true });
  image.src = imagePath(currentPage);
  image.alt = `صفحة ${numberFormat.format(currentPage)} من المصحف الشريف`;
  if (image.complete && image.naturalWidth) settle();
  if (direction) { void image.offsetWidth; image.classList.add(direction === 'right' ? 'turn-right' : 'turn-left'); }
  preloadNearby();
}
function setPage(page, direction = '', withLoader = false) {
  const next = Math.min(604, Math.max(1, Number(page)));
  if (next === currentPage && direction) return;
  currentPage = next;
  renderPage(direction, withLoader);
}
function showReader() { home.classList.add('hidden'); reader.classList.remove('hidden'); renderPage('', true); }
function showHome() { reader.classList.add('hidden'); home.classList.remove('hidden'); closeMenu(); hideLoading(); }
function openMenu() { $('#sideMenu').classList.add('open'); $('#overlay').classList.add('open'); }
function closeMenu() { $('#sideMenu').classList.remove('open'); $('#overlay').classList.remove('open'); }
function toast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); }

for (let page = 1; page <= 604; page++) $('#pageSelect').add(new Option(`الصفحة ${numberFormat.format(page)}`, page));
$('#readButton').addEventListener('click', showReader);
$('#memorizeButton').addEventListener('click', () => toast('قسم التحفيظ سيكون الخطوة التالية بإذن الله.'));
$('#backButton').addEventListener('click', showHome);
$('#menuButton').addEventListener('click', openMenu);
$('#closeMenu').addEventListener('click', closeMenu);
$('#overlay').addEventListener('click', closeMenu);
$('#goToPage').addEventListener('click', () => { const target = $('#pageSelect').value; closeMenu(); setPage(target, '', true); });
$('#swipeArea').addEventListener('touchstart', e => touchStart = e.changedTouches[0].screenX, { passive: true });
$('#swipeArea').addEventListener('touchend', e => {
  const delta = e.changedTouches[0].screenX - touchStart;
  if (delta > 45) setPage(currentPage + 1, 'right');
  if (delta < -45) setPage(currentPage - 1, 'left');
}, { passive: true });
