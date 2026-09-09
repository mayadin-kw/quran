const $ = (s) => document.querySelector(s);
const home = $('#home'), reader = $('#reader'), image = $('#quranImage');
const numberFormat = new Intl.NumberFormat('ar-EG');
let currentPage = 1, touchStart = 0;
const STORAGE_BASE_URL = 'https://firebasestorage.googleapis.com/v0/b/ihfad-2fecd.firebasestorage.app/o/';

function imagePath(page) {
  const fileName = `quran-pages/page-${String(PAGE_MAP[page - 1].pdfPage).padStart(3, '0')}.jpg`;
  return `${STORAGE_BASE_URL}${encodeURIComponent(fileName)}?alt=media`;
}
function preloadNearby() {
  [currentPage - 1, currentPage + 1].filter(p => p >= 1 && p <= 604).forEach(p => { const preloaded = new Image(); preloaded.src = imagePath(p); });
}
function renderPage(direction = '') {
  const page = PAGE_MAP[currentPage - 1];
  image.className = '';
  image.src = imagePath(currentPage);
  image.alt = `صفحة ${numberFormat.format(currentPage)} من المصحف الشريف`;
  if (direction) { void image.offsetWidth; image.classList.add(direction === 'right' ? 'turn-right' : 'turn-left'); }
  const from = page.verses[0][0], to = page.verses.at(-1)[0];
  $('#surahLabel').textContent = `الآيات ${from} إلى ${to}`;
  $('#footerPage').textContent = `الصفحة ${numberFormat.format(currentPage)} من ٦٠٤`;
  $('#pageSelect').value = currentPage;
  $('#previousPage').disabled = currentPage === 1;
  $('#nextPage').disabled = currentPage === 604;
  preloadNearby();
}
function setPage(page, direction = '') { const next = Math.min(604, Math.max(1, Number(page))); if (next === currentPage && direction) return; currentPage = next; renderPage(direction); }
function showReader() { home.classList.add('hidden'); reader.classList.remove('hidden'); renderPage(); }
function showHome() { reader.classList.add('hidden'); home.classList.remove('hidden'); closeMenu(); }
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
$('#goToPage').addEventListener('click', () => { setPage($('#pageSelect').value); closeMenu(); });
$('#previousPage').addEventListener('click', () => setPage(currentPage - 1, 'left'));
$('#nextPage').addEventListener('click', () => setPage(currentPage + 1, 'right'));
$('#swipeArea').addEventListener('touchstart', e => touchStart = e.changedTouches[0].screenX, {passive:true});
$('#swipeArea').addEventListener('touchend', e => {
  const delta = e.changedTouches[0].screenX - touchStart;
  // الانتقال المطلوب: من اليسار إلى اليمين ينقل إلى الصفحة التالية.
  if (delta > 45) setPage(currentPage + 1, 'right');
  if (delta < -45) setPage(currentPage - 1, 'left');
}, {passive:true});
