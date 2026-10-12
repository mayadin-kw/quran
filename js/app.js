(() => {
  'use strict';

  /* ================= أدوات عامة ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
  const pad3 = (n) => String(n).padStart(3, '0');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* التخزين غير متاح */ } },
  };

  const ICON = {
    listen: '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3" y="13" width="4" height="7" rx="1.5"/><rect x="17" y="13" width="4" height="7" rx="1.5"/></svg>',
    tafsir: '<svg viewBox="0 0 24 24"><path d="M12 6c-2.2-1.5-5-2-8-1.6v13c3-.4 5.8.1 8 1.6 2.2-1.5 5-2 8-1.6v-13c-3-.4-5.8.1-8 1.6zM12 6v13"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  };

  const TOTAL_PAGES = 604;
  const els = {
    home: $('#home'), reader: $('#reader'), pager: $('#pager'), loading: $('#loading'),
    titleSurah: $('#titleSurah'), titleJuz: $('#titleJuz'),
    drawer: $('#drawer'), scrim: $('#scrim'), panels: $('#panels'), menuBtn: $('#menuBtn'),
    search: $('#searchInput'), searchClear: $('#searchClear'), results: $('#searchResults'),
    jumpPage: $('#jumpPage'), reciter: $('#reciterSelect'),
    listenSurah: $('#listenSurah'), listenFrom: $('#listenFrom'), listenTo: $('#listenTo'), rangeFields: $('#rangeFields'),
    player: $('#player'), toast: $('#toast'),
    navPrev: $('#navPrev'), navNext: $('#navNext'),
  };

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  async function copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    toast(msg || 'تم النسخ');
  }

  /* ================= البيانات ================= */
  // ayat[i] = [سورة, آية, صفحة, جزء, ربع حزب, نص]
  let Q = null;
  const pageStart = [];
  const surahStart = [];
  let dataPromise = null;

  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch('data/quran.json')
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((d) => {
          Q = d;
          Q.ayat.forEach((a, i) => {
            if (pageStart[a[2]] === undefined) pageStart[a[2]] = i;
            if (a[1] === 1) surahStart[a[0]] = i;
          });
          pageStart[TOTAL_PAGES + 1] = Q.ayat.length;
        })
        .catch((e) => { dataPromise = null; throw e; });
    }
    return dataPromise;
  }

  const surahOf = (i) => Q.surahs[Q.ayat[i][0] - 1];
  const ayahRef = (i) => `سورة ${surahOf(i).name} - الآية ${ar(Q.ayat[i][1])}`;

  let tafsirPromise = null;
  const loadTafsir = () => (tafsirPromise ||= fetch('data/tafsir.json').then((r) => r.json()).catch((e) => { tafsirPromise = null; throw e; }));

  /* ================= التنقل بين الصفحة الرئيسية والمصحف ================= */
  let built = false;

  async function showReader() {
    els.home.hidden = true;
    els.reader.hidden = false;
    if (built) { scrollToPage(current, false); return; }
    els.loading.hidden = false;
    try {
      await Promise.all([
        loadData(),
        document.fonts ? Promise.race([document.fonts.load('30px "Amiri Quran"'), new Promise((r) => setTimeout(r, 3000))]) : null,
      ]);
    } catch {
      els.loading.innerHTML = '<span>تعذّر تحميل المصحف، تحقق من الاتصال ثم أعد تحميل الصفحة.</span>';
      return;
    }
    buildPager();
    fillSelects();
    built = true;
    els.loading.hidden = true;
    goTo(+store.get('q.page', 1) || 1, { smooth: false });
  }

  function showHome() {
    player.close();
    closeDrawer();
    clearSelection();
    els.reader.hidden = true;
    els.home.hidden = false;
  }

  function route() {
    if (location.hash === '#read') showReader();
    else showHome();
  }

  $('#startBtn').addEventListener('click', () => {
    history.pushState({ reader: true }, '', '#read');
    showReader();
  });
  $('#backBtn').addEventListener('click', () => {
    if (history.state && history.state.reader) history.back();
    else { history.replaceState(null, '', location.pathname + location.search); showHome(); }
  });
  window.addEventListener('popstate', route);

  /* ================= صفحات المصحف ================= */
  let current = 1;
  let lockScrollUntil = 0;
  const rendered = new Set();
  const slotOf = (p) => els.pager.children[p - 1];

  function buildPager() {
    const frag = document.createDocumentFragment();
    for (let p = 1; p <= TOTAL_PAGES; p++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.p = p;
      frag.appendChild(s);
    }
    els.pager.appendChild(frag);
  }

  function pageHTML(p) {
    const from = pageStart[p];
    const to = pageStart[p + 1];
    const first = Q.ayat[from];
    let html = `<div class="page${p <= 2 ? ' opening' : ''}"><div class="page-frame">`
      + `<div class="page-head"><span>سورة ${Q.surahs[first[0] - 1].name}</span><span>الجزء ${ar(first[3])}</span></div><div class="page-body">`;
    let open = false;
    for (let i = from; i < to; i++) {
      const [s, a, , , , text] = Q.ayat[i];
      if (a === 1) {
        if (open) { html += '</p>'; open = false; }
        const su = Q.surahs[s - 1];
        html += `<div class="surah-head"><span class="meta"><span>${su.type}</span><span>آياتها ${ar(su.count)}</span></span>`
          + `<span class="name">سورة ${su.name}</span></div>`;
        if (s !== 1 && s !== 9) html += `<div class="basmala" data-s="${s}">${Q.ayat[0][5]}</div>`;
      }
      if (!open) { html += '<p class="quran">'; open = true; }
      const words = text.split(' ').map((w, k) => `<span class="w" data-k="${k}">${w}</span>`).join(' ');
      html += `<span class="ayah" data-i="${i}">${words} <span class="num">${ar(a)}</span></span> `;
    }
    if (open) html += '</p>';
    return html + `</div><div class="page-foot"><span>${ar(p)}</span></div></div></div>`;
  }

  function ensureRendered(p) {
    for (let q = p - 2; q <= p + 2; q++) {
      if (q < 1 || q > TOTAL_PAGES || rendered.has(q)) continue;
      const slot = slotOf(q);
      slot.innerHTML = pageHTML(q);
      rendered.add(q);
      applyMarks(slot);
    }
    for (const q of rendered) {
      if (Math.abs(q - p) > 4) { slotOf(q).innerHTML = ''; rendered.delete(q); }
    }
  }

  function scrollToPage(p, smooth) {
    lastWidth = els.pager.clientWidth;
    const left = -(p - 1) * els.pager.clientWidth; // الاتجاه من اليمين لليسار
    if (smooth) lockScrollUntil = performance.now() + 900;
    els.pager.scrollTo({ left, behavior: smooth ? 'smooth' : 'instant' });
  }

  function goTo(p, { smooth = false } = {}) {
    p = Math.max(1, Math.min(TOTAL_PAGES, p));
    const changed = p !== current;
    scrollToPage(p, smooth);
    onPageChange(p, { byUser: false, changed });
  }

  function onPageChange(p, { byUser }) {
    if (byUser && p !== current) clearSelection();
    current = p;
    store.set('q.page', p);
    ensureRendered(p);
    const first = Q.ayat[pageStart[p]];
    els.titleSurah.textContent = `سورة ${Q.surahs[first[0] - 1].name}`;
    els.titleJuz.textContent = `الجزء ${ar(first[3])} · صفحة ${ar(p)}`;
    els.navPrev.disabled = p <= 1;
    els.navNext.disabled = p >= TOTAL_PAGES;
  }

  let lastWidth = 0;
  els.pager.addEventListener('scroll', () => {
    // أثناء تغيّر حجم الشاشة تكون قيم التمرير مؤقتة وغير صحيحة
    if (performance.now() < lockScrollUntil || els.pager.clientWidth !== lastWidth) return;
    const p = Math.round(Math.abs(els.pager.scrollLeft) / els.pager.clientWidth) + 1;
    if (p !== current && p >= 1 && p <= TOTAL_PAGES) onPageChange(p, { byUser: true });
  }, { passive: true });
  els.pager.addEventListener('scrollend', () => { lockScrollUntil = 0; });

  new ResizeObserver(() => {
    if (!built || els.reader.hidden) return;
    const w = els.pager.clientWidth;
    if (w === lastWidth || !w) return;
    lastWidth = w;
    scrollToPage(current, false);
    if (pop) placePop();
  }).observe(els.pager);

  els.navPrev.addEventListener('click', () => goTo(current - 1, { smooth: true }));
  els.navNext.addEventListener('click', () => goTo(current + 1, { smooth: true }));

  document.addEventListener('keydown', (e) => {
    if (els.reader.hidden) return;
    if (e.key === 'Escape') {
      if (els.drawer.classList.contains('open')) closeDrawer();
      else clearSelection();
      return;
    }
    if (els.drawer.classList.contains('open') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    // المصحف يُقلَّب من اليمين لليسار: السهم الأيسر = الصفحة التالية
    if (e.key === 'ArrowLeft') { e.preventDefault(); clearSelection(); goTo(current + 1, { smooth: true }); }
    if (e.key === 'ArrowRight') { e.preventDefault(); clearSelection(); goTo(current - 1, { smooth: true }); }
  });

  // يمرّر صفحة المصحف عمودياً حتى يظهر العنصر (بدون تحريك التمرير الأفقي)
  function revealInSlot(el, center) {
    const slot = el.closest('.slot');
    if (!slot) return;
    const sr = slot.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const bottomPad = els.player.hidden ? 20 : 200;
    if (!center && r.top >= sr.top + 8 && r.bottom <= sr.bottom - bottomPad) return;
    const target = center
      ? slot.scrollTop + r.top - sr.top - (slot.clientHeight - bottomPad) / 2 + r.height / 2
      : slot.scrollTop + (r.top < sr.top + 8 ? r.top - sr.top - 12 : r.bottom - sr.bottom + bottomPad);
    slot.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  /* ================= التحديد (أزرق) والكلمات المبحوث عنها (أحمر) ================= */
  let sel = null; // { i, words: Set|null }
  let playingAyah = null;
  let playingBasmala = null;

  function applyMarks(root = els.pager) {
    $$('.ayah.sel, .ayah.playing, .basmala.playing, .w.hl', root).forEach((e) => e.classList.remove('sel', 'playing', 'hl'));
    if (sel) {
      const a = $(`.ayah[data-i="${sel.i}"]`, root);
      if (a) {
        a.classList.add('sel');
        if (sel.words) sel.words.forEach((k) => { const w = $(`.w[data-k="${k}"]`, a); if (w) w.classList.add('hl'); });
      }
    }
    if (playingAyah !== null) { const a = $(`.ayah[data-i="${playingAyah}"]`, root); if (a) a.classList.add('playing'); }
    if (playingBasmala !== null) { const b = $(`.basmala[data-s="${playingBasmala}"]`, root); if (b) b.classList.add('playing'); }
  }

  function select(i, words = null) {
    if (sel && sel.i === i && !words && pop) return; // نفس الآية: تبقى الخيارات كما هي
    sel = { i, words };
    applyMarks();
    showActions();
  }

  function clearSelection() {
    removePop();
    if (!sel) return;
    sel = null;
    applyMarks();
  }

  document.addEventListener('click', (e) => {
    if (els.reader.hidden || !built) return;
    const t = e.target;
    if (t.closest('.pop, .drawer, .scrim, .player')) return;
    const ayah = t.closest('.ayah');
    if (ayah && els.pager.contains(ayah)) { select(+ayah.dataset.i); return; }
    clearSelection();
  });

  /* ================= الخيارات المنبثقة والتفسير ================= */
  let pop = null;

  function removePop() {
    if (pop) { pop.remove(); pop = null; }
  }

  function selectedAyahEl() {
    return sel && $(`.ayah[data-i="${sel.i}"]`, slotOf(Q.ayat[sel.i][2]));
  }

  function mountPop(node) {
    removePop();
    const ayah = selectedAyahEl();
    if (!ayah) return;
    pop = node;
    ayah.closest('.page').appendChild(pop);
    placePop();
    revealInSlot(pop);
  }

  function placePop() {
    const ayah = selectedAyahEl();
    if (!pop || !ayah) return;
    const page = ayah.closest('.page');
    const slot = page.closest('.slot');
    const pr = page.getBoundingClientRect();
    const rects = ayah.getClientRects();
    const first = rects[0];
    const last = rects[rects.length - 1];
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const gap = 12;
    let anchor = first;
    let above = first.top - ph - gap >= slot.getBoundingClientRect().top + 6;
    if (!above) anchor = last;
    const ax = anchor.left + anchor.width / 2 - pr.left;
    const top = above ? first.top - pr.top - ph - gap : last.bottom - pr.top + gap;
    const left = Math.max(8, Math.min(page.clientWidth - pw - 8, ax - pw / 2));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    pop.style.setProperty('--arrow-x', `${Math.max(18, Math.min(pw - 18, ax - left))}px`);
    pop.classList.toggle('above', above);
    pop.classList.toggle('below', !above);
  }

  function showActions() {
    const node = document.createElement('div');
    node.className = 'pop';
    node.innerHTML = `<div class="pop-actions">
      <button type="button" data-act="listen">${ICON.listen}<span>استماع</span></button>
      <button type="button" data-act="tafsir">${ICON.tafsir}<span>تفسير</span></button>
      <button type="button" data-act="copy">${ICON.copy}<span>نسخ</span></button></div>`;
    node.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !sel) return;
      const i = sel.i;
      if (b.dataset.act === 'listen') { removePop(); player.playSingle(i); }
      if (b.dataset.act === 'tafsir') showTafsir(i);
      if (b.dataset.act === 'copy') copyText(`${Q.ayat[i][5]} ﴿${ayahRef(i)}﴾`, 'تم نسخ الآية');
    });
    mountPop(node);
  }

  async function showTafsir(i) {
    const node = document.createElement('div');
    node.className = 'pop tafsir';
    node.innerHTML = `<div class="tafsir-head">
        <button type="button" class="icon-btn small" data-t="back" aria-label="رجوع للخيارات">${ICON.back}</button>
        <h3>التفسير الميسر · ${surahOf(i).name} ${ar(Q.ayat[i][1])}</h3>
        <button type="button" class="copy-chip" data-t="copy">${ICON.copy}<span>نسخ</span></button>
      </div>
      <div class="tafsir-body"><span class="spinner" style="display:block;margin:8px auto;color:var(--gold)"></span></div>`;
    let text = '';
    node.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      if (b.dataset.t === 'back') showActions();
      if (b.dataset.t === 'copy' && text) copyText(`${text}\n(التفسير الميسر - ${ayahRef(i)})`, 'تم نسخ التفسير');
    });
    mountPop(node);
    try {
      const t = await loadTafsir();
      text = t[i];
    } catch {
      text = '';
    }
    if (pop !== node) return;
    $('.tafsir-body', node).textContent = text || 'تعذّر تحميل التفسير، تحقق من الاتصال.';
    placePop();
    revealInSlot(node);
  }

  /* ================= القائمة الجانبية ================= */
  function openDrawer() {
    clearSelection();
    els.drawer.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    els.menuBtn.setAttribute('aria-expanded', 'true');
    els.scrim.hidden = false;
  }
  function closeDrawer() {
    els.drawer.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.menuBtn.setAttribute('aria-expanded', 'false');
    els.scrim.hidden = true;
    setTimeout(() => showPanel('main', false), 300);
  }
  function showPanel(name, animate = true) {
    const isMain = name === 'main';
    els.panels.classList.toggle('sub', !isMain);
    $$('.panel', els.panels).forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    els.panels.classList.remove('back-anim');
    if (isMain && animate) { void els.panels.offsetWidth; els.panels.classList.add('back-anim'); }
    if (name === 'jump') els.jumpPage.value = current;
    if (name === 'listen' && Q) { els.listenSurah.value = Q.ayat[pageStart[current]][0]; fillAyahSelects(); }
  }

  els.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(); });
  els.scrim.addEventListener('click', closeDrawer);
  $$('[data-close-drawer]').forEach((b) => b.addEventListener('click', closeDrawer));
  $$('[data-open-panel]').forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.openPanel)));
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => showPanel('main')));

  function option(value, label) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function fillSelects() {
    const jf = document.createDocumentFragment();
    for (let p = 1; p <= TOTAL_PAGES; p++) {
      jf.appendChild(option(p, `صفحة ${ar(p)} — ${Q.surahs[Q.ayat[pageStart[p]][0] - 1].name}`));
    }
    els.jumpPage.appendChild(jf);
    const sf = document.createDocumentFragment();
    Q.surahs.forEach((s) => sf.appendChild(option(s.n, `${ar(s.n)}. سورة ${s.name}`)));
    els.listenSurah.appendChild(sf);
  }

  $('#jumpGo').addEventListener('click', () => {
    const p = +els.jumpPage.value;
    closeDrawer();
    goTo(p, { smooth: Math.abs(p - current) === 1 });
  });

  // ---- إعدادات الاستماع ----
  let rangeMode = 'full';
  function fillAyahSelects() {
    const count = Q.surahs[els.listenSurah.value - 1].count;
    [els.listenFrom, els.listenTo].forEach((s) => {
      s.textContent = '';
      for (let a = 1; a <= count; a++) s.appendChild(option(a, ar(a)));
    });
    els.listenFrom.value = 1;
    els.listenTo.value = count;
  }
  els.listenSurah.addEventListener('change', fillAyahSelects);
  els.listenFrom.addEventListener('change', () => {
    if (+els.listenTo.value < +els.listenFrom.value) els.listenTo.value = els.listenFrom.value;
  });
  els.listenTo.addEventListener('change', () => {
    if (+els.listenTo.value < +els.listenFrom.value) els.listenFrom.value = els.listenTo.value;
  });
  $$('.segmented button').forEach((b) => b.addEventListener('click', () => {
    rangeMode = b.dataset.range;
    $$('.segmented button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    els.rangeFields.hidden = rangeMode !== 'part';
  }));
  $('#listenGo').addEventListener('click', () => {
    const s = +els.listenSurah.value;
    const count = Q.surahs[s - 1].count;
    const from = rangeMode === 'part' ? +els.listenFrom.value : 1;
    const to = rangeMode === 'part' ? +els.listenTo.value : count;
    closeDrawer();
    player.playRange(s, from, to);
  });

  // ---- اختيار القارئ ----
  const RECITERS = window.RECITERS;
  let reciterId = store.get('q.reciter', RECITERS[0].id);
  if (!RECITERS.some((r) => r.id === reciterId)) reciterId = RECITERS[0].id;
  RECITERS.forEach((r) => els.reciter.appendChild(option(r.id, r.name)));
  els.reciter.value = reciterId;
  els.reciter.addEventListener('change', () => {
    reciterId = els.reciter.value;
    store.set('q.reciter', reciterId);
    toast(`القارئ: ${reciterName()}`);
    player.reciterChanged();
  });
  const reciterName = () => RECITERS.find((r) => r.id === reciterId).name;

  /* ================= البحث ================= */
  const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ﻿]/g;
  const normalize = (s) => s.replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ').trim();

  let searchIndex = null;
  let searchPromise = null;
  function loadSearch() {
    return (searchPromise ||= Promise.all([loadData(), fetch('data/search.json').then((r) => r.json())]).then(([, lines]) => {
      searchIndex = lines.map((line) => {
        const aligned = line[0] !== '!';
        let str = '';
        const starts = [];
        const ends = [];
        const owner = [];
        (aligned ? line : line.slice(1)).split(' ').forEach((word, k) => {
          word.split('_').forEach((piece) => {
            const n = normalize(piece);
            if (!n) return;
            if (str) str += ' ';
            starts.push(str.length);
            str += n;
            ends.push(str.length);
            owner.push(k);
          });
        });
        return { str, starts, ends, owner, aligned };
      });
    }).catch((e) => { searchPromise = null; throw e; }));
  }

  function runSearch(q) {
    const nq = normalize(q);
    if (nq.length < 2) return null;
    const out = [];
    searchIndex.forEach((e, i) => {
      let pos = e.str.indexOf(nq);
      if (pos < 0) return;
      const words = new Set();
      while (pos >= 0) {
        const end = pos + nq.length;
        for (let j = 0; j < e.starts.length; j++) if (e.starts[j] < end && e.ends[j] > pos) words.add(e.owner[j]);
        pos = e.str.indexOf(nq, pos + 1);
      }
      out.push({ i, words: e.aligned ? words : null });
    });
    return out;
  }

  const MAX_RESULTS = 100;
  function snippet(i, words) {
    const all = Q.ayat[i][5].split(' ');
    let from = 0;
    let to = all.length;
    if (all.length > 22 && words && words.size) {
      const firstHit = Math.min(...words);
      from = Math.max(0, firstHit - 7);
      to = Math.min(all.length, from + 20);
    }
    const body = all.slice(from, to).map((w, j) => `<span class="w${words && words.has(from + j) ? ' hl' : ''}">${w}</span>`).join(' ');
    return (from > 0 ? '… ' : '') + body + (to < all.length ? ' …' : '');
  }

  let lastResults = [];
  function renderResults(q) {
    const res = runSearch(q);
    if (!res) { els.results.hidden = true; return; }
    lastResults = res;
    if (!res.length) {
      els.results.innerHTML = '<div class="no-results">لا توجد نتائج مطابقة</div>';
    } else {
      const shown = res.slice(0, MAX_RESULTS);
      els.results.innerHTML = `<div class="results-count">عدد النتائج: ${ar(res.length)}${res.length > MAX_RESULTS ? ` (يُعرض أول ${ar(MAX_RESULTS)})` : ''}</div>`
        + shown.map((r, k) => `<button type="button" class="result" data-k="${k}">
            <div class="result-meta"><span>سورة ${surahOf(r.i).name} · الآية ${ar(Q.ayat[r.i][1])}</span><span>صفحة ${ar(Q.ayat[r.i][2])}</span></div>
            <div class="result-text">${snippet(r.i, r.words)}</div></button>`).join('');
      els.results.scrollTop = 0;
    }
    els.results.hidden = false;
  }

  let searchTimer = 0;
  els.search.addEventListener('focus', () => { loadSearch().catch(() => {}); });
  els.search.addEventListener('input', () => {
    const q = els.search.value;
    els.searchClear.hidden = !q;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try { await loadSearch(); } catch { toast('تعذّر تحميل فهرس البحث'); return; }
      if (els.search.value === q) renderResults(q);
    }, 160);
  });
  els.searchClear.addEventListener('click', () => {
    els.search.value = '';
    els.searchClear.hidden = true;
    els.results.hidden = true;
    els.search.focus();
  });
  els.results.addEventListener('click', (e) => {
    const b = e.target.closest('.result');
    if (!b) return;
    const r = lastResults[+b.dataset.k];
    const p = Q.ayat[r.i][2];
    closeDrawer();
    goTo(p, { smooth: false });
    sel = null;
    select(r.i, r.words && r.words.size ? r.words : null);
    const a = selectedAyahEl();
    if (a) revealInSlot(a, true);
    setTimeout(placePop, 350);
  });

  /* ================= مشغل الصوت ================= */
  const player = (() => {
    const audio = new Audio();
    audio.preload = 'auto';
    const ui = {
      title: $('#playerTitle'), reciter: $('#playerReciter'), seek: $('#seek'),
      cur: $('#timeCur'), dur: $('#timeDur'),
      play: $('#pPlay'), prev: $('#pPrev'), next: $('#pNext'), back: $('#pBack'), fwd: $('#pFwd'),
    };
    let queue = [];   // عناصر: { i } لآية، أو { basmala: s } للبسملة
    let qi = 0;
    let mode = 'single';
    let finished = false;
    let seeking = false;
    let preloader = null;

    const fmt = (t) => (Number.isFinite(t) ? ar(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`) : ar('0:00'));
    const urlFor = (it) => {
      const [s, a] = it.basmala ? [1, 1] : [Q.ayat[it.i][0], Q.ayat[it.i][1]];
      return `${window.AUDIO_BASE}${reciterId}/${pad3(s)}${pad3(a)}.mp3`;
    };

    function show() {
      els.player.hidden = false;
      document.body.classList.add('player-open');
    }

    function setButtons() {
      const it = queue[qi];
      if (mode === 'range') {
        ui.prev.disabled = qi <= 0;
        ui.next.disabled = qi >= queue.length - 1;
      } else {
        ui.prev.disabled = !it || it.i <= 0;
        ui.next.disabled = !it || it.i >= Q.ayat.length - 1;
      }
    }

    function updateInfo() {
      const it = queue[qi];
      if (!it) return;
      ui.title.textContent = it.basmala
        ? `سورة ${Q.surahs[it.basmala - 1].name} - البسملة`
        : ayahRef(it.i);
      ui.reciter.textContent = reciterName();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: ui.title.textContent, artist: reciterName(), album: 'القرآن الكريم' });
      }
      setButtons();
    }

    function follow(it) {
      playingAyah = it.basmala ? null : it.i;
      playingBasmala = it.basmala || null;
      const page = it.basmala ? Q.surahs[it.basmala - 1].page : Q.ayat[it.i][2];
      const moved = page !== current;
      if (moved) {
        if (sel) clearSelection();
        goTo(page, { smooth: Math.abs(page - current) === 1 });
      }
      applyMarks();
      const delay = moved ? 450 : 0;
      setTimeout(() => {
        const el = it.basmala
          ? $(`.basmala[data-s="${it.basmala}"]`, slotOf(page))
          : $(`.ayah[data-i="${it.i}"]`, slotOf(page));
        if (el) revealInSlot(el);
      }, delay + 60);
    }

    function playAt(k) {
      qi = k;
      finished = false;
      const it = queue[qi];
      show();
      els.player.classList.add('loading');
      follow(it);
      updateInfo();
      setProgress(0, 0);
      audio.src = urlFor(it);
      audio.play().catch((err) => { if (err.name !== 'AbortError') els.player.classList.remove('loading'); });
      const nx = queue[qi + 1];
      if (nx) { preloader = new Audio(); preloader.preload = 'auto'; preloader.src = urlFor(nx); }
    }

    function setProgress(t, d) {
      if (seeking) return;
      const pct = d ? (t / d) * 100 : 0;
      ui.seek.value = Math.round(pct * 10);
      ui.seek.style.setProperty('--pct', `${pct}%`);
      ui.cur.textContent = fmt(t);
      ui.dur.textContent = fmt(d);
    }

    function step(dir) {
      if (mode === 'range') {
        const k = qi + dir;
        if (k >= 0 && k < queue.length) playAt(k);
        return;
      }
      const it = queue[qi];
      const i = (it ? it.i : 0) + dir;
      if (i < 0 || i >= Q.ayat.length) return;
      queue = [{ i }];
      if (sel) { sel = { i, words: null }; removePop(); }
      playAt(0);
    }

    function stopMarks() {
      playingAyah = null;
      playingBasmala = null;
      applyMarks();
    }

    audio.addEventListener('playing', () => { els.player.classList.remove('loading'); els.player.classList.add('playing'); });
    audio.addEventListener('pause', () => els.player.classList.remove('playing'));
    audio.addEventListener('waiting', () => els.player.classList.add('loading'));
    audio.addEventListener('timeupdate', () => setProgress(audio.currentTime, audio.duration));
    audio.addEventListener('loadedmetadata', () => setProgress(audio.currentTime, audio.duration));
    audio.addEventListener('ended', () => {
      if (qi < queue.length - 1) { playAt(qi + 1); return; }
      finished = true;
      els.player.classList.remove('playing');
      setProgress(audio.duration, audio.duration);
    });
    audio.addEventListener('error', () => {
      if (!audio.getAttribute('src')) return;
      els.player.classList.remove('loading', 'playing');
      toast('تعذّر تشغيل التلاوة، تحقق من الاتصال');
    });

    ui.play.addEventListener('click', () => {
      if (!queue.length) return;
      if (finished) { playAt(0); return; }
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    });
    ui.prev.addEventListener('click', () => step(-1));
    ui.next.addEventListener('click', () => step(1));
    ui.back.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); });
    ui.fwd.addEventListener('click', () => {
      if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration - 0.05, audio.currentTime + 5);
    });
    ui.seek.addEventListener('input', () => {
      seeking = true;
      const pct = ui.seek.value / 10;
      ui.seek.style.setProperty('--pct', `${pct}%`);
      if (Number.isFinite(audio.duration)) ui.cur.textContent = fmt((pct / 100) * audio.duration);
    });
    ui.seek.addEventListener('change', () => {
      seeking = false;
      if (Number.isFinite(audio.duration)) audio.currentTime = (ui.seek.value / 1000) * audio.duration;
    });
    $('#playerClose').addEventListener('click', () => api.close());

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => audio.play());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    }

    const api = {
      playSingle(i) {
        mode = 'single';
        queue = [{ i }];
        playAt(0);
      },
      playRange(s, from, to) {
        mode = 'range';
        queue = [];
        if (from === 1 && s !== 1 && s !== 9) queue.push({ basmala: s });
        for (let a = from; a <= to; a++) queue.push({ i: surahStart[s] + a - 1 });
        clearSelection();
        playAt(0);
      },
      reciterChanged() {
        if (!queue.length) return;
        ui.reciter.textContent = reciterName();
        if (!finished) playAt(qi);
      },
      close() {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        queue = [];
        preloader = null;
        els.player.hidden = true;
        els.player.classList.remove('playing', 'loading');
        document.body.classList.remove('player-open');
        stopMarks();
      },
    };
    return api;
  })();

  /* ================= البدء ================= */
  loadData().catch(() => {});
  if (location.hash === '#read') {
    history.replaceState({ reader: false }, '', location.href);
    showReader();
  }
})();
