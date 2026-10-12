(() => {
  'use strict';

  /* ================= أدوات عامة ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
  const pad3 = (n) => String(n).padStart(3, '0');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* التخزين غير متاح */ } },
  };

  const ICON = {
    listen: '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3" y="13" width="4" height="7" rx="1.5"/><rect x="17" y="13" width="4" height="7" rx="1.5"/></svg>',
    tafsir: '<svg viewBox="0 0 24 24"><path d="M12 6c-2.2-1.5-5-2-8-1.6v13c3-.4 5.8.1 8 1.6 2.2-1.5 5-2 8-1.6v-13c-3-.4-5.8.1-8 1.6zM12 6v13"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  };

  const TOTAL_PAGES = 604;
  const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
  const els = {
    home: $('#home'), reader: $('#reader'), pager: $('#pager'), track: $('#track'), loading: $('#loading'),
    titleSurah: $('#titleSurah'), titleJuz: $('#titleJuz'),
    drawer: $('#drawer'), scrim: $('#scrim'), panels: $('#panels'), menuBtn: $('#menuBtn'),
    search: $('#searchInput'), searchClear: $('#searchClear'), results: $('#searchResults'),
    jumpPage: $('#jumpPage'), reciter: $('#reciterSelect'),
    listenSurah: $('#listenSurah'), listenFrom: $('#listenFrom'), listenTo: $('#listenTo'), rangeFields: $('#rangeFields'),
    withTafsir: $('#withTafsir'),
    player: $('#player'), toast: $('#toast'),
    navPrev: $('#navPrev'), navNext: $('#navNext'),
  };

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => els.toast.classList.remove('show'), 2200);
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
  // ayat[i] = [سورة, آية, صفحة, جزء, ربع حزب, رموز خط المصحف[], أرقام الأسطر[], كلمات بالرسم العثماني[]]
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
  const ayahText = (i) => Q.ayat[i][7].join(' ');
  const ayahRef = (i) => `سورة ${surahOf(i).name} - الآية ${ar(Q.ayat[i][1])}`;

  let tafsirPromise = null;
  const loadTafsir = () => (tafsirPromise ||= fetch('data/tafsir.json').then((r) => r.json()).catch((e) => { tafsirPromise = null; throw e; }));

  /* ================= خطوط صفحات المصحف ================= */
  const fontState = new Map(); // رقم الصفحة → Promise
  function loadPageFont(p) {
    if (p < 1 || p > TOTAL_PAGES) return Promise.resolve();
    if (!fontState.has(p)) {
      const face = new FontFace(`p${p}`, `url(fonts/p${p}.woff2) format("woff2")`, { display: 'block' });
      fontState.set(p, face.load().then((loaded) => { document.fonts.add(loaded); }).catch(() => {
        fontState.delete(p);
      }));
    }
    return fontState.get(p);
  }

  /* ================= التنقل بين الصفحة الرئيسية والمصحف ================= */
  let built = false;

  async function showReader() {
    els.home.hidden = true;
    els.reader.hidden = false;
    if (built) { layoutAll(); return; }
    els.loading.hidden = false;
    const startPage = Math.min(TOTAL_PAGES, Math.max(1, +store.get('q.page', 1) || 1));
    try {
      await Promise.all([loadData(), loadPageFont(startPage),
        document.fonts ? Promise.race([document.fonts.load('20px "Amiri Quran"'), sleep(2500)]) : null]);
    } catch {
      els.loading.innerHTML = '<span>تعذّر تحميل المصحف، تحقق من الاتصال ثم أعد تحميل الصفحة.</span>';
      return;
    }
    buildPager();
    fillSelects();
    built = true;
    goTo(startPage);
    els.loading.hidden = true;
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

  /* ================= صفحة المصحف ================= */
  // مقاسات الصفحة بوحدة حجم الخط f — يجب أن تطابق style.css
  const K = 15;     // عرض السطر ÷ حجم الخط (أعرض سطر في المصحف ≈ 14.83)
  const LH = 1.72;  // ارتفاع السطر ÷ حجم الخط
  const PAGE_W = K + 2.1;
  const PAGE_H = 15 * LH + 3.55;

  function pageHTML(p) {
    const from = pageStart[p];
    const to = pageStart[p + 1];
    const first = Q.ayat[from];
    const count = Q.shortPages[p] || 15;
    const lines = Array.from({ length: count + 1 }, () => []);
    for (let i = from; i < to; i++) {
      const [, , , , , glyphs, lns] = Q.ayat[i];
      const last = glyphs.length - 1;
      glyphs.forEach((g, k) => {
        lines[lns[k]].push(k === last
          ? `<span class="w end" data-i="${i}" data-k="e">${g}</span>`
          : `<span class="w" data-i="${i}" data-k="${k}">${g}</span>`);
      });
    }
    const special = {};
    (Q.marks[p] || []).forEach(([kind, line, s]) => { special[line] = [kind, s]; });
    let body = '';
    for (let l = 1; l <= count; l++) {
      const sp = special[l];
      if (sp && sp[0] === 'h') {
        const su = Q.surahs[sp[1] - 1];
        body += `<div class="line surah-line"><div class="surah-band"><span class="sb-meta">${su.type}</span>`
          + `<span class="sb-name">سورة ${su.name}</span><span class="sb-meta">${ar(su.count)} آية</span></div></div>`;
      } else if (sp && sp[0] === 'b') {
        body += `<div class="line basmala" data-s="${sp[1]}">${BASMALA}</div>`;
      } else {
        body += `<div class="line${lines[l].length ? '' : ' empty'}">${lines[l].join('')}</div>`;
      }
    }
    return `<div class="page${p <= 2 ? ' opening' : ''}" data-p="${p}"><div class="page-frame">`
      + `<div class="page-head"><span>سورة ${Q.surahs[first[0] - 1].name}</span><span>الجزء ${ar(first[3])}</span></div>`
      + `<div class="lines" style="font-family:p${p}"><div class="marks"></div>${body}</div>`
      + `<div class="page-foot"><span>${ar(p)}</span></div></div></div>`;
  }

  /* ---- الألواح الثلاثة: التالية (يسار) / الحالية / السابقة (يمين) ---- */
  let current = 1;
  const panes = { next: null, cur: null, prev: null };
  let f = 20; // حجم الخط الحالي

  function buildPager() {
    ['next', 'cur', 'prev'].forEach((k) => {
      const d = document.createElement('div');
      d.className = 'pane';
      els.track.appendChild(d);
      panes[k] = d;
    });
    placePanes();
  }

  function placePanes() {
    panes.next.style.transform = 'translateX(-100%)';
    panes.cur.style.transform = 'translateX(0)';
    panes.prev.style.transform = 'translateX(100%)';
    panes.cur.setAttribute('aria-hidden', 'false');
    panes.next.setAttribute('aria-hidden', 'true');
    panes.prev.setAttribute('aria-hidden', 'true');
  }

  function fillPane(pane, p) {
    if (p < 1 || p > TOTAL_PAGES) { pane.innerHTML = ''; pane.dataset.p = ''; return; }
    if (pane.dataset.p === String(p)) return;
    pane.dataset.p = p;
    pane.innerHTML = pageHTML(p);
    const page = pane.firstElementChild;
    page.classList.add('font-wait');
    loadPageFont(p).then(() => {
      if (pane.dataset.p !== String(p)) return;
      page.classList.remove('font-wait');
      markShortLines(page);
      layoutPage(pane);
      drawMarks(pane);
    });
    layoutPage(pane);
  }

  // الأسطر القصيرة (أواخر بعض السور) تُوسَّط كما في المصحف المطبوع بدل توزيعها على عرض السطر
  function markShortLines(page) {
    $$('.line', page).forEach((line) => {
      const ws = line.children;
      if (!ws.length || !ws[0].classList.contains('w')) return;
      let sum = 0;
      for (const w of ws) sum += w.offsetWidth;
      line.classList.toggle('short', sum < line.offsetWidth * 0.9);
    });
  }

  function computeFit() {
    const w = els.pager.clientWidth - 12;
    const h = els.pager.clientHeight - 12;
    f = Math.max(10, Math.min(w / PAGE_W, h / PAGE_H, 40));
  }

  // مقياس إضافي عند ظهور مشغل الصوت حتى تبقى الصفحة كاملة ظاهرة
  function fitTransform() {
    const h = els.pager.clientHeight;
    const pageH = f * PAGE_H + 8;
    const playerH = els.player.hidden ? 0 : els.player.offsetHeight + 18;
    const avail = h - playerH - 8;
    const s = Math.min(1, avail / pageH);
    const ty = Math.max(4, (avail - pageH * s) / 2 + 4);
    return { s, ty };
  }

  function layoutPage(pane) {
    const page = pane && pane.firstElementChild;
    if (!page) return;
    page.style.setProperty('--f', `${f}px`);
    const { s, ty } = fitTransform();
    page.style.transform = `translate(-50%, ${ty}px) scale(${s})`;
  }

  function layoutAll() {
    if (!built) return;
    computeFit();
    Object.values(panes).forEach(layoutPage);
    Object.values(panes).forEach(drawMarks);
    if (pop) setTimeout(placePop, 380);
  }

  function renderAround(p) {
    fillPane(panes.cur, p);
    fillPane(panes.next, p + 1);
    fillPane(panes.prev, p - 1);
    loadPageFont(p + 2);
    loadPageFont(p - 2);
  }

  function setCurrent(p) {
    current = p;
    store.set('q.page', p);
    const first = Q.ayat[pageStart[p]];
    els.titleSurah.textContent = `سورة ${Q.surahs[first[0] - 1].name}`;
    els.titleJuz.textContent = `الجزء ${ar(first[3])} · صفحة ${ar(p)}`;
    els.navPrev.disabled = p <= 1;
    els.navNext.disabled = p >= TOTAL_PAGES;
  }

  let animating = null;
  function goTo(p, { animate = false } = {}) {
    p = Math.max(1, Math.min(TOTAL_PAGES, p));
    if (!panes.cur.dataset.p) computeFit();
    if (animating) return animating.then(() => goTo(p, { animate }));
    if (p === current && panes.cur.dataset.p === String(p)) return Promise.resolve();
    if (animate && Math.abs(p - current) === 1) return slide(p > current ? 1 : -1);
    removePop();
    setCurrent(p);
    renderAround(p);
    drawMarks(panes.cur);
    return Promise.resolve();
  }

  // dir = 1 للصفحة التالية (تأتي من اليسار)، -1 للسابقة
  function slide(dir) {
    const w = els.pager.clientWidth;
    removePop();
    els.track.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1)';
    void els.track.offsetWidth;
    els.track.style.transform = `translateX(${dir === 1 ? w : -w}px)`;
    animating = new Promise((resolve) => {
      let t = 0;
      const done = () => {
        els.track.removeEventListener('transitionend', done);
        clearTimeout(t);
        els.track.style.transition = 'none';
        els.track.style.transform = 'translateX(0)';
        if (dir === 1) { const old = panes.prev; panes.prev = panes.cur; panes.cur = panes.next; panes.next = old; }
        else { const old = panes.next; panes.next = panes.cur; panes.cur = panes.prev; panes.prev = old; }
        placePanes();
        setCurrent(current + dir);
        renderAround(current);
        drawMarks(panes.cur);
        animating = null;
        resolve();
      };
      t = setTimeout(done, 450);
      els.track.addEventListener('transitionend', done);
    });
    return animating;
  }

  /* ---- السحب يمين ويسار ---- */
  let drag = null;
  let suppressClick = false;
  els.pager.addEventListener('pointerdown', (e) => {
    if (!built || animating || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('.pop')) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, active: false, id: e.pointerId };
  });
  els.pager.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      drag.active = true;
      els.pager.setPointerCapture(e.pointerId);
      els.track.style.transition = 'none';
      removePop();
    }
    let d = dx;
    if ((d > 0 && current >= TOTAL_PAGES) || (d < 0 && current <= 1)) d *= 0.25; // مقاومة عند الأطراف
    drag.dx = d;
    els.track.style.transform = `translateX(${d}px)`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 50);
    const w = els.pager.clientWidth;
    const v = d.dx / (performance.now() - d.t);
    const dir = d.dx > 0 ? 1 : -1;
    const allowed = dir === 1 ? current < TOTAL_PAGES : current > 1;
    if (allowed && (Math.abs(d.dx) > w * 0.22 || Math.abs(v) > 0.45)) {
      if (sel) clearSelection();
      slide(dir);
    } else {
      els.track.style.transition = 'transform .25s ease-out';
      els.track.style.transform = 'translateX(0)';
    }
  };
  els.pager.addEventListener('pointerup', endDrag);
  els.pager.addEventListener('pointercancel', endDrag);

  new ResizeObserver(() => { if (built && !els.reader.hidden) layoutAll(); }).observe(els.pager);

  const pageNav = (dir) => { clearSelection(); goTo(current + dir, { animate: true }); };
  els.navPrev.addEventListener('click', (e) => { e.stopPropagation(); pageNav(-1); });
  els.navNext.addEventListener('click', (e) => { e.stopPropagation(); pageNav(1); });

  document.addEventListener('keydown', (e) => {
    if (els.reader.hidden) return;
    if (e.key === 'Escape') {
      if (els.drawer.classList.contains('open')) closeDrawer();
      else clearSelection();
      return;
    }
    if (els.drawer.classList.contains('open') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    // المصحف يُقلَّب من اليمين لليسار: السهم الأيسر = الصفحة التالية
    if (e.key === 'ArrowLeft') { e.preventDefault(); pageNav(1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); pageNav(-1); }
  });

  /* ================= التحديد (أزرق) والكلمات المبحوث عنها (أحمر) ================= */
  let sel = null;          // { i, words: Set|null }
  let playingAyah = null;
  let playingBasmala = null;

  // يرسم خلفية التحديد كمستطيل متصل لكل سطر خلف الكلمات
  function drawMarks(pane) {
    const page = pane && pane.firstElementChild;
    if (!page) return;
    const box = $('.marks', page);
    box.textContent = '';
    $$('.w.sel, .w.playing', page).forEach((w) => w.classList.remove('sel', 'playing'));
    $$('.basmala.playing', page).forEach((b) => b.classList.remove('playing'));
    const band = (i, cls) => {
      const byLine = new Map();
      $$(`.w[data-i="${i}"]`, page).forEach((w) => {
        w.classList.add(cls);
        const line = w.parentElement;
        const l = w.offsetLeft;
        const r = l + w.offsetWidth;
        const cur = byLine.get(line);
        if (!cur) byLine.set(line, [l, r]);
        else { cur[0] = Math.min(cur[0], l); cur[1] = Math.max(cur[1], r); }
      });
      byLine.forEach(([l, r], line) => {
        const m = document.createElement('div');
        m.className = `mark ${cls}`;
        m.style.cssText = `left:${line.offsetLeft + l}px;top:${line.offsetTop}px;width:${r - l}px;height:${line.offsetHeight}px`;
        box.appendChild(m);
      });
    };
    if (playingAyah !== null && (!sel || sel.i !== playingAyah)) band(playingAyah, 'playing');
    if (sel) {
      band(sel.i, 'sel');
      if (sel.words) {
        sel.words.forEach((k) => {
          const w = $(`.w[data-i="${sel.i}"][data-k="${k}"]`, page);
          if (!w) return;
          const line = w.parentElement;
          const m = document.createElement('div');
          m.className = 'mark hl';
          m.style.cssText = `left:${line.offsetLeft + w.offsetLeft}px;top:${line.offsetTop + line.offsetHeight * 0.14}px;width:${w.offsetWidth}px;height:${line.offsetHeight * 0.72}px`;
          box.appendChild(m);
        });
      }
    }
    if (playingBasmala !== null) {
      const b = $(`.basmala[data-s="${playingBasmala}"]`, page);
      if (b) b.classList.add('playing');
    }
  }
  const redrawMarks = () => Object.values(panes).forEach(drawMarks);

  function select(i, words = null) {
    sel = { i, words };
    redrawMarks();
    showActions();
  }

  function clearSelection() {
    removePop();
    if (!sel) return;
    sel = null;
    redrawMarks();
  }

  els.pager.addEventListener('click', (e) => {
    if (suppressClick || !built) return;
    if (e.target.closest('.pop, .page-arrow')) return;
    // إذا كانت هناك آية محددة: أي ضغطة تلغي التحديد فقط
    if (sel || pop) { clearSelection(); return; }
    let w = e.target.closest('.w');
    const line = !w && e.target.closest('.line');
    if (line && line.querySelector('.w')) {
      // ضغطة في الفراغ بين الكلمات تختار أقرب كلمة في السطر
      let best = Infinity;
      for (const c of line.children) {
        const r = c.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - e.clientX);
        if (d < best) { best = d; w = c; }
      }
    }
    if (w && panes.cur.contains(w)) select(+w.dataset.i);
  });

  /* ================= الخيارات المنبثقة والتفسير ================= */
  let pop = null;
  let popAyah = null;

  function removePop() {
    if (pop) { pop.remove(); pop = null; popAyah = null; }
  }

  function mountPop(node, i) {
    removePop();
    pop = node;
    popAyah = i;
    panes.cur.appendChild(node);
    placePop();
  }

  function placePop() {
    if (!pop) return;
    const page = panes.cur.firstElementChild;
    const marks = page ? $$('.mark.sel, .mark.playing', page) : [];
    const paneR = panes.cur.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const gap = 10;
    const limitBottom = paneR.height - (els.player.hidden ? 6 : els.player.offsetHeight + 22);
    let top;
    let ax;
    let cls;
    if (!marks.length) {
      top = Math.max(6, (limitBottom - ph) / 2);
      ax = paneR.width / 2;
      cls = 'center';
    } else {
      const rects = marks.map((m) => m.getBoundingClientRect());
      const firstR = rects.reduce((a, b) => (b.top < a.top ? b : a));
      const lastR = rects.reduce((a, b) => (b.bottom > a.bottom ? b : a));
      const spaceAbove = firstR.top - paneR.top;
      const spaceBelow = limitBottom - (lastR.bottom - paneR.top);
      if (spaceAbove >= ph + gap + 4) {
        top = firstR.top - paneR.top - ph - gap; ax = firstR.left + firstR.width / 2 - paneR.left; cls = 'above';
      } else if (spaceBelow >= ph + gap + 4) {
        top = lastR.bottom - paneR.top + gap; ax = lastR.left + lastR.width / 2 - paneR.left; cls = 'below';
      } else {
        top = Math.max(6, Math.min(limitBottom - ph, firstR.top - paneR.top - ph - gap));
        ax = firstR.left + firstR.width / 2 - paneR.left; cls = 'center';
      }
    }
    const left = Math.max(8, Math.min(paneR.width - pw - 8, ax - pw / 2));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    pop.style.setProperty('--arrow-x', `${Math.max(18, Math.min(pw - 18, ax - left))}px`);
    pop.classList.remove('above', 'below', 'center');
    pop.classList.add(cls);
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
      if (b.dataset.act === 'copy') copyText(`${ayahText(i)} ﴿${ayahRef(i)}﴾`, 'تم نسخ الآية');
    });
    mountPop(node, sel.i);
  }

  // يحوّل مقاطع تفسير الجلالين إلى [{q: جزء الآية أو '', f, t: أرقام الكلمات, e: الشرح}]
  function tafsirItems(i, segs) {
    const words = Q.ayat[i][7];
    const items = segs.map(([fr, to, e]) => ({ q: fr >= 0 ? words.slice(fr, to + 1).join(' ') : '', f: fr, t: to, e }));
    if (!items.some((x) => x.q)) {
      if (items.length) Object.assign(items[0], { q: ayahText(i), f: 0, t: words.length - 1 });
      else items.push({ q: ayahText(i), f: 0, t: words.length - 1, e: '' });
    }
    return items;
  }

  // يقسّم الشرح إلى جمل قصيرة للقراءة الصوتية
  function chunksOf(text) {
    const out = [];
    text.split(/(?<=[.،؛:!؟])\s+/).filter(Boolean).forEach((p) => {
      const ws = p.split(' ');
      for (let s = 0; s < ws.length; s += 22) out.push(ws.slice(s, s + 22).join(' '));
    });
    return out;
  }

  function tafsirListHTML(items) {
    return items.map((it, n) => {
      const e = chunksOf(it.e).map((c, ci) => `<span class="t-chunk" data-c="${ci}">${c.split(' ').map((w) => `<span class="t-w">${w}</span>`).join(' ')}</span>`).join(' ');
      return `<li class="t-item" data-n="${n}">${it.q ? `<div class="t-q">${it.q}</div>` : ''}${it.e ? `<div class="t-e">${e}</div>` : ''}</li>`;
    }).join('');
  }

  async function showTafsir(i) {
    const node = document.createElement('div');
    node.className = 'pop tafsir';
    node.dataset.i = i;
    node.innerHTML = `<div class="tafsir-head">
        <button type="button" class="icon-btn small" data-t="back" aria-label="رجوع للخيارات">${ICON.back}</button>
        <h3>تفسير الجلالين · ${surahOf(i).name} ${ar(Q.ayat[i][1])}</h3>
      </div>
      <div class="tafsir-tools">
        <button type="button" class="chip" data-t="listen">${ICON.listen}<span>استماع التفسير</span></button>
        <button type="button" class="chip" data-t="copy">${ICON.copy}<span>نسخ</span></button>
      </div>
      <ol class="tafsir-body"><li class="t-loading"><span class="spinner"></span></li></ol>`;
    let items = null;
    node.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      if (b.dataset.t === 'back') { if (player.isTafsirOf(i)) player.close(); showActions(); }
      if (b.dataset.t === 'copy' && items) {
        const text = items.map((it) => [it.q && `﴿${it.q}﴾`, it.e].filter(Boolean).join('\n')).join('\n\n');
        copyText(`${text}\n\n(تفسير الجلالين - ${ayahRef(i)})`, 'تم نسخ التفسير');
      }
      if (b.dataset.t === 'listen') {
        if (player.isTafsirOf(i)) player.close();
        else player.playTafsir(i);
      }
    });
    mountPop(node, i);
    try {
      items = tafsirItems(i, (await loadTafsir())[i]);
    } catch {
      items = null;
    }
    if (pop !== node) return;
    $('.tafsir-body', node).innerHTML = items ? tafsirListHTML(items) : '<li class="t-error">تعذّر تحميل التفسير، تحقق من الاتصال.</li>';
    syncTafsirButton();
  }

  function syncTafsirButton() {
    const b = pop && $('[data-t="listen"]', pop);
    if (!b) return;
    const on = player.isTafsirOf(+pop.dataset.i);
    b.classList.toggle('on', on);
    b.innerHTML = on ? `${ICON.stop}<span>إيقاف</span>` : `${ICON.listen}<span>استماع التفسير</span>`;
  }

  // تظليل ما يُقرأ داخل كادر التفسير
  function tafsirHighlight(i, n, part, chunk, word) {
    if (!pop || !pop.classList.contains('tafsir') || +pop.dataset.i !== i) return;
    $$('.t-item.active, .t-q.reading, .t-chunk.reading, .t-w.reading', pop).forEach((x) => x.classList.remove('active', 'reading'));
    if (n < 0) return;
    const item = $(`.t-item[data-n="${n}"]`, pop);
    if (!item) return;
    item.classList.add('active');
    if (part === 'q') { const q = $('.t-q', item); if (q) q.classList.add('reading'); }
    if (part === 'e') {
      const c = $(`.t-chunk[data-c="${chunk}"]`, item);
      if (c) {
        c.classList.add('reading');
        if (word >= 0) { const w = $$('.t-w', c)[word]; if (w) w.classList.add('reading'); }
      }
    }
    const body = $('.tafsir-body', pop);
    const ir = item.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    if (ir.top < br.top || ir.bottom > br.bottom) body.scrollTo({ top: body.scrollTop + ir.top - br.top - 8, behavior: 'smooth' });
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
    clearSelection();
    goTo(p, { animate: Math.abs(p - current) === 1 });
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
    player.playRange(s, from, to, els.withTafsir.checked);
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
        let str = '';
        const starts = [];
        const ends = [];
        const owner = [];
        line.split(' ').forEach((word, k) => {
          word.split('_').forEach((piece) => {
            if (!piece) return;
            if (str) str += ' ';
            starts.push(str.length);
            str += piece;
            ends.push(str.length);
            owner.push(k);
          });
        });
        return { str, starts, ends, owner };
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
      out.push({ i, words });
    });
    return out;
  }

  const MAX_RESULTS = 100;
  function snippet(i, words) {
    const all = Q.ayat[i][7];
    let from = 0;
    let to = all.length;
    if (all.length > 22 && words.size) {
      from = Math.max(0, Math.min(...words) - 7);
      to = Math.min(all.length, from + 20);
    }
    const body = all.slice(from, to).map((w, j) => `<span class="w${words.has(from + j) ? ' hl' : ''}">${w}</span>`).join(' ');
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
  els.results.addEventListener('click', async (e) => {
    const b = e.target.closest('.result');
    if (!b) return;
    const r = lastResults[+b.dataset.k];
    closeDrawer();
    sel = null;
    await goTo(Q.ayat[r.i][2]);
    await loadPageFont(current);
    select(r.i, r.words.size ? r.words : null);
  });

  /* ================= القراءة الصوتية للشرح (صوت الجهاز) ================= */
  const tts = (() => {
    const supported = 'speechSynthesis' in window;
    let voice = null;
    let ready = null;
    function pickVoice() {
      const vs = speechSynthesis.getVoices().filter((v) => /^ar/i.test(v.lang));
      voice = vs.find((v) => /ar[-_]SA/i.test(v.lang)) || vs[0] || null;
      return voice;
    }
    function init() {
      if (!supported) return Promise.resolve(null);
      return (ready ||= new Promise((resolve) => {
        if (pickVoice()) { resolve(voice); return; }
        speechSynthesis.addEventListener('voiceschanged', () => { if (pickVoice()) resolve(voice); });
        setTimeout(() => resolve(pickVoice()), 1500);
      }));
    }
    // تُستدعى داخل ضغطة المستخدم حتى تسمح المتصفحات (خصوصاً iPhone) بالكلام لاحقاً
    function unlock() {
      if (!supported) return;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      init();
    }
    let armLive = null;
    let live = null; // مرجع ثابت: كروم لا يرسل حدث النهاية إذا حُذف الكائن من الذاكرة
    function speak(text, onWord) {
      return new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        live = u;
        let guard = 0;
        const finish = (ok) => { clearTimeout(guard); if (live === u) live = null; resolve(ok); };
        // احتياط إذا علِق المحرك ولم يرسل حدث النهاية
        const arm = (ms) => { clearTimeout(guard); guard = setTimeout(() => { speechSynthesis.cancel(); finish(false); }, ms); };
        armLive = { arm, stop: () => clearTimeout(guard), ms: 3000 + text.length * 110 };
        arm(4000 + text.length * 120);
        u.onstart = () => arm(3000 + text.length * 110);
        u.lang = voice ? voice.lang : 'ar-SA';
        if (voice) u.voice = voice;
        u.rate = 0.95;
        const starts = [];
        text.split(' ').reduce((pos, w) => { starts.push(pos); return pos + w.length + 1; }, 0);
        u.onboundary = (e) => {
          if (e.name && e.name !== 'word') return;
          let k = 0;
          while (k + 1 < starts.length && starts[k + 1] <= e.charIndex) k++;
          onWord(k);
        };
        u.onend = () => finish(true);
        u.onerror = () => finish(false);
        if (speechSynthesis.paused) speechSynthesis.resume();
        speechSynthesis.speak(u);
      });
    }
    return {
      init, unlock, speak, warned: false,
      cancel: () => { if (supported) speechSynthesis.cancel(); },
      pause: () => { if (!supported) return; if (armLive) armLive.stop(); speechSynthesis.pause(); },
      resume: () => { if (!supported) return; if (armLive) armLive.arm(armLive.ms); speechSynthesis.resume(); },
    };
  })();

  /* ================= توقيت كلمات الآية (لتشغيل جزء منها أثناء التفسير) ================= */
  const timingCache = new Map();
  function timingFor(i) {
    const rid = window.WORD_TIMING_RECITERS[reciterId] || 7;
    const key = `${rid}:${i}`;
    if (!timingCache.has(key)) {
      const [s, a] = Q.ayat[i];
      timingCache.set(key, fetch(`https://api.quran.com/api/v4/recitations/${rid}/by_ayah/${s}:${a}?fields=segments`)
        .then((r) => r.json())
        .then((d) => {
          const file = d.audio_files && d.audio_files[0];
          if (!file || !file.segments || !file.segments.length) return null;
          let url = file.url;
          if (url.startsWith('//')) url = `https:${url}`;
          else if (!/^https?:/.test(url)) url = `https://verses.quran.com/${url}`;
          const seg = new Map();
          file.segments.forEach((x) => { if (x.length >= 4) seg.set(Number(x[1]) - 1, [Number(x[2]), Number(x[3])]); });
          return { url, seg };
        })
        .catch(() => { timingCache.delete(key); return null; }));
    }
    return timingCache.get(key);
  }

  /* ================= مشغل الصوت ================= */
  const player = (() => {
    const audio = new Audio();
    audio.preload = 'auto';
    const clip = new Audio();
    clip.preload = 'auto';
    const ui = {
      title: $('#playerTitle'), reciter: $('#playerReciter'), seek: $('#seek'),
      cur: $('#timeCur'), dur: $('#timeDur'),
      play: $('#pPlay'), prev: $('#pPrev'), next: $('#pNext'), back: $('#pBack'), fwd: $('#pFwd'),
    };
    // عناصر القائمة: { kind: 'ayah'|'basmala'|'tafsir', i?, s? }
    let queue = [];
    let qi = 0;
    let mode = 'single';   // single | range | withTafsir | tafsirOnly
    let finished = false;
    let seeking = false;
    let token = 0;         // يتغير عند كل إيقاف/انتقال لإلغاء أي تسلسل جارٍ
    let phase = null;      // 'audio' | 'clip' | 'speech'
    let paused = false;
    let preloader = null;

    const fmt = (t) => (Number.isFinite(t) ? ar(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`) : ar('0:00'));
    const urlFor = (it) => {
      const [s, a] = it.kind === 'basmala' ? [1, 1] : [Q.ayat[it.i][0], Q.ayat[it.i][1]];
      return `${window.AUDIO_BASE}${reciterId}/${pad3(s)}${pad3(a)}.mp3`;
    };
    const itemAyah = (it) => (it && it.kind !== 'basmala' ? it.i : null);

    function show() {
      if (!els.player.hidden) return;
      els.player.hidden = false;
      layoutAll();
    }
    function setState(state) {
      els.player.classList.toggle('playing', state === 'playing');
      els.player.classList.toggle('loading', state === 'loading');
    }

    function setButtons() {
      const it = queue[qi];
      const isTafsir = it && it.kind === 'tafsir';
      ui.back.disabled = isTafsir;
      ui.fwd.disabled = isTafsir;
      if (mode === 'single' || mode === 'tafsirOnly') {
        const i = itemAyah(it);
        ui.prev.disabled = i === null || i <= 0;
        ui.next.disabled = i === null || i >= Q.ayat.length - 1;
      } else {
        const i = itemAyah(it);
        ui.prev.disabled = !queue.slice(0, qi).some((x) => x.kind !== 'tafsir' && !(x.kind === 'ayah' && x.i === i));
        ui.next.disabled = !queue.slice(qi + 1).some((x) => x.kind === 'ayah' && x.i !== i);
      }
    }

    function updateInfo() {
      const it = queue[qi];
      if (!it) return;
      if (it.kind === 'basmala') ui.title.textContent = `سورة ${Q.surahs[it.s - 1].name} - البسملة`;
      else if (it.kind === 'tafsir') ui.title.textContent = `تفسير ${ayahRef(it.i)}`;
      else ui.title.textContent = ayahRef(it.i);
      ui.reciter.textContent = it.kind === 'tafsir' ? 'تفسير الجلالين' : reciterName();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: ui.title.textContent, artist: ui.reciter.textContent, album: 'القرآن الكريم' });
      }
      setButtons();
    }

    function setProgress(t, d) {
      if (seeking) return;
      const pct = d ? Math.min(100, (t / d) * 100) : 0;
      ui.seek.value = Math.round(pct * 10);
      ui.seek.style.setProperty('--pct', `${pct}%`);
      ui.cur.textContent = fmt(t);
      ui.dur.textContent = fmt(d);
    }

    function basmalaPage(s) {
      for (const [p, list] of Object.entries(Q.marks)) if (list.some(([k, , x]) => k === 'b' && x === s)) return +p;
      return Q.surahs[s - 1].page;
    }

    // ينقل المصحف دائماً إلى صفحة ما يُقرأ الآن ويظلله
    async function follow(it) {
      playingAyah = it.kind === 'basmala' ? null : it.i;
      playingBasmala = it.kind === 'basmala' ? it.s : null;
      const page = it.kind === 'basmala' ? basmalaPage(it.s) : Q.ayat[it.i][2];
      if (sel && sel.i !== playingAyah) clearSelection();
      else if (pop && popAyah !== playingAyah) removePop();
      if (page !== current) await goTo(page, { animate: Math.abs(page - current) === 1 });
      redrawMarks();
    }

    function stopAll() {
      token++;
      audio.pause();
      clip.pause();
      tts.cancel();
      phase = null;
      paused = false;
    }

    async function playAt(k) {
      stopAll();
      const my = token;
      qi = k;
      finished = false;
      const it = queue[qi];
      show();
      updateInfo();
      setProgress(0, 0);
      setState('loading');
      await follow(it);
      if (my !== token) return;
      if (it.kind === 'tafsir') { runTafsir(it.i, my); return; }
      phase = 'audio';
      audio.src = urlFor(it);
      audio.play().catch((err) => { if (err.name !== 'AbortError') setState('paused'); });
      const nx = queue[qi + 1];
      if (nx && nx.kind !== 'tafsir') { preloader = new Audio(); preloader.preload = 'auto'; preloader.src = urlFor(nx); }
      if (nx && nx.kind === 'tafsir') { loadTafsir(); timingFor(nx.i); }
    }

    function advance() {
      if (qi < queue.length - 1) { playAt(qi + 1); return; }
      finished = true;
      phase = null;
      setState('paused');
      tafsirHighlight(popAyah, -1);
      syncTafsirButton();
    }

    // تشغيل جزء من ملف الآية بين زمنين (بالملي ثانية)
    function playClip(url, start, end, my) {
      return new Promise((resolve) => {
        phase = 'clip';
        let timer = 0;
        const finish = () => { clearInterval(timer); clip.removeEventListener('playing', onPlaying); clip.onerror = null; resolve(); };
        const onPlaying = () => {
          setState('playing');
          clearInterval(timer);
          timer = setInterval(() => {
            if (my !== token) { finish(); return; }
            if (clip.currentTime * 1000 >= end - 20 || clip.ended) { clip.pause(); finish(); }
          }, 30);
        };
        clip.addEventListener('playing', onPlaying);
        clip.onerror = finish;
        const go = () => {
          clip.currentTime = start / 1000;
          clip.play().catch(finish);
        };
        if (clip.src !== url) {
          clip.src = url;
          clip.addEventListener('loadedmetadata', go, { once: true });
          clip.load();
        } else go();
      });
    }

    async function waitWhilePaused(my) {
      while (paused && my === token) await sleep(150);
    }

    async function runTafsir(i, my) {
      syncTafsirButton();
      let segs;
      try { segs = (await loadTafsir())[i]; } catch { toast('تعذّر تحميل التفسير'); setState('paused'); return; }
      if (my !== token) return;
      const items = tafsirItems(i, segs);
      if (mode === 'withTafsir' && (!pop || !pop.classList.contains('tafsir') || +pop.dataset.i !== i)) {
        sel = { i, words: null };
        redrawMarks();
        await showTafsir(i);
        if (my !== token) return;
      }
      syncTafsirButton();
      const [timing, voice] = await Promise.all([timingFor(i), tts.init()]);
      if (my !== token) return;
      if (!voice && !tts.warned) { tts.warned = true; toast('لا يوجد صوت عربي في جهازك لقراءة الشرح، ستُقرأ مقاطع الآية فقط'); }
      setState('playing');
      for (let n = 0; n < items.length; n++) {
        const it = items[n];
        setProgress(n, items.length);
        ui.cur.textContent = ar(n + 1);
        ui.dur.textContent = ar(items.length);
        if (it.q && timing) {
          const a = timing.seg.get(it.f);
          const b = timing.seg.get(it.t);
          if (a && b) {
            tafsirHighlight(i, n, 'q');
            await playClip(timing.url, a[0], b[1], my);
            if (my !== token) return;
            await waitWhilePaused(my);
          }
        }
        if (it.e && voice) {
          const chunks = chunksOf(it.e);
          for (let c = 0; c < chunks.length; c++) {
            tafsirHighlight(i, n, 'e', c, -1);
            phase = 'speech';
            await tts.speak(chunks[c], (w) => { if (my === token) tafsirHighlight(i, n, 'e', c, w); });
            if (my !== token) return;
            await waitWhilePaused(my);
          }
        }
        if (my !== token) return;
      }
      tafsirHighlight(i, -1);
      setProgress(1, 1);
      advance();
    }

    function stepAyah(dir) {
      const it = queue[qi];
      const i = itemAyah(it);
      if (mode === 'single' || mode === 'tafsirOnly') {
        const j = (i === null ? 0 : i) + dir;
        if (j < 0 || j >= Q.ayat.length) return;
        queue = [{ kind: mode === 'tafsirOnly' ? 'tafsir' : 'ayah', i: j }];
        if (mode === 'tafsirOnly') { sel = { i: j, words: null }; }
        playAt(0).then(() => { if (mode === 'tafsirOnly' && queue[0].i === j) showTafsir(j); });
        return;
      }
      let k = qi + dir;
      while (k >= 0 && k < queue.length) {
        const x = queue[k];
        if (x.kind !== 'tafsir' && !(x.kind === 'ayah' && x.i === i)) break;
        k += dir;
      }
      if (k >= 0 && k < queue.length) playAt(k);
    }

    audio.addEventListener('playing', () => setState('playing'));
    audio.addEventListener('pause', () => { if (phase === 'audio') setState('paused'); });
    audio.addEventListener('waiting', () => setState('loading'));
    audio.addEventListener('timeupdate', () => { if (phase === 'audio') setProgress(audio.currentTime, audio.duration); });
    audio.addEventListener('loadedmetadata', () => { if (phase === 'audio') setProgress(audio.currentTime, audio.duration); });
    audio.addEventListener('ended', () => { if (phase === 'audio') advance(); });
    audio.addEventListener('error', () => {
      if (!audio.getAttribute('src') || phase !== 'audio') return;
      setState('paused');
      toast('تعذّر تشغيل التلاوة، تحقق من الاتصال');
    });

    ui.play.addEventListener('click', () => {
      if (!queue.length) return;
      if (finished) { tts.unlock(); playAt(0); return; }
      if (phase === 'audio') { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); return; }
      paused = !paused;
      if (phase === 'clip') { if (paused) clip.pause(); else clip.play().catch(() => {}); }
      if (phase === 'speech') { if (paused) tts.pause(); else tts.resume(); }
      setState(paused ? 'paused' : 'playing');
    });
    ui.prev.addEventListener('click', () => { tts.unlock(); stepAyah(-1); });
    ui.next.addEventListener('click', () => { tts.unlock(); stepAyah(1); });
    ui.back.addEventListener('click', () => { if (phase === 'audio') audio.currentTime = Math.max(0, audio.currentTime - 5); });
    ui.fwd.addEventListener('click', () => {
      if (phase === 'audio' && Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration - 0.05, audio.currentTime + 5);
    });
    ui.seek.addEventListener('input', () => {
      if (phase !== 'audio') return;
      seeking = true;
      const pct = ui.seek.value / 10;
      ui.seek.style.setProperty('--pct', `${pct}%`);
      if (Number.isFinite(audio.duration)) ui.cur.textContent = fmt((pct / 100) * audio.duration);
    });
    ui.seek.addEventListener('change', () => {
      seeking = false;
      if (phase === 'audio' && Number.isFinite(audio.duration)) audio.currentTime = (ui.seek.value / 1000) * audio.duration;
    });
    $('#playerClose').addEventListener('click', () => api.close());

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => ui.play.click());
      navigator.mediaSession.setActionHandler('pause', () => ui.play.click());
      navigator.mediaSession.setActionHandler('previoustrack', () => stepAyah(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => stepAyah(1));
    }

    const api = {
      playSingle(i) {
        mode = 'single';
        queue = [{ kind: 'ayah', i }];
        playAt(0);
      },
      playTafsir(i) {
        tts.unlock();
        mode = 'tafsirOnly';
        queue = [{ kind: 'tafsir', i }];
        playAt(0);
        syncTafsirButton();
      },
      playRange(s, from, to, withTafsir) {
        tts.unlock();
        mode = withTafsir ? 'withTafsir' : 'range';
        queue = [];
        if (from === 1 && s !== 1 && s !== 9) queue.push({ kind: 'basmala', s });
        for (let a = from; a <= to; a++) {
          const i = surahStart[s] + a - 1;
          queue.push({ kind: 'ayah', i });
          if (withTafsir) queue.push({ kind: 'tafsir', i });
        }
        clearSelection();
        playAt(0);
      },
      isTafsirOf(i) {
        const it = queue[qi];
        return !!it && !finished && it.kind === 'tafsir' && it.i === i;
      },
      reciterChanged() {
        if (!queue.length || finished) return;
        if (queue[qi].kind !== 'tafsir') playAt(qi);
      },
      close() {
        stopAll();
        audio.removeAttribute('src');
        audio.load();
        queue = [];
        preloader = null;
        const wasOpen = !els.player.hidden;
        els.player.hidden = true;
        setState('paused');
        playingAyah = null;
        playingBasmala = null;
        if (built) {
          redrawMarks();
          if (wasOpen) layoutAll();
        }
        tafsirHighlight(popAyah, -1);
        syncTafsirButton();
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
