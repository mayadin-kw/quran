const $ = (s) => document.querySelector(s);
const home = $('#home'), reader = $('#reader'), pageText = $('#quranText');
const numberFormat = new Intl.NumberFormat('ar-EG');
let currentPage = 1, pages = [], touchStart = 0;

function normalizeText(text) {
  return text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function makePages(text) {
  const sections = normalizeText(text).split(/(?=سورة\s)/g).filter(Boolean);
  const result = [];
  let buffer = '';
  const limit = Math.ceil(text.length / 604);
  sections.forEach(section => {
    while (section.length) {
      const room = Math.max(350, limit - buffer.length);
      let cut = section.length > room ? section.lastIndexOf(' ', room) : section.length;
      if (cut < 120) cut = Math.min(room, section.length);
      buffer += (buffer ? '\n\n' : '') + section.slice(0, cut).trim();
      section = section.slice(cut).trim();
      if (buffer.length >= limit || !section) { result.push(buffer); buffer = ''; }
    }
  });
  if (buffer) result.push(buffer);
  // Preserve the familiar 604-page navigation while retaining all supplied text.
  const pages604 = Array.from({ length: 604 }, (_, i) => result[i] || '');
  if (result.length > 604) result.slice(604).forEach((part, i) => pages604[603] += '\n\n' + part);
  return pages604;
}
function renderPage() {
  const content = pages[currentPage - 1] || 'هذه الصفحة قيد التجهيز.';
  const lines = content.split('\n');
  const first = lines[0]?.startsWith('سورة ') ? `<span class="surah">${lines.shift()}</span>` : '';
  pageText.innerHTML = first + lines.join('\n').replace(/\n/g, '<br>');
  $('#pageNumber').textContent = numberFormat.format(currentPage);
  $('#footerPage').textContent = `الصفحة ${numberFormat.format(currentPage)} من ٦٠٤`;
  $('#pageSelect').value = currentPage;
  $('#previousPage').disabled = currentPage === 1;
  $('#nextPage').disabled = currentPage === 604;
  $('#surahLabel').textContent = (content.match(/سورة\s+[^\n]+/) || ['القرآن الكريم'])[0];
  $('.quran-page').scrollTop = 0;
}
function setPage(page) { currentPage = Math.min(604, Math.max(1, Number(page))); renderPage(); }
function showReader() { home.classList.add('hidden'); reader.classList.remove('hidden'); if (pages.length) renderPage(); }
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
$('#previousPage').addEventListener('click', () => setPage(currentPage - 1));
$('#nextPage').addEventListener('click', () => setPage(currentPage + 1));
$('#swipeArea').addEventListener('touchstart', e => touchStart = e.changedTouches[0].screenX, {passive:true});
$('#swipeArea').addEventListener('touchend', e => { const delta = e.changedTouches[0].screenX - touchStart; if (Math.abs(delta) > 45) setPage(currentPage + (delta < 0 ? 1 : -1)); }, {passive:true});

fetch('quran.txt').then(r => { if (!r.ok) throw Error(); return r.text(); }).then(text => { pages = makePages(text); renderPage(); }).catch(() => { pageText.textContent = 'تعذّر تحميل نص القرآن. تأكد من وجود ملف quran.txt بجانب الصفحة.'; });
