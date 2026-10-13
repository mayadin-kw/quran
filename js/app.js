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
    tsSetup: $('#tasmeeSetup'), tsReport: $('#tasmeeReport'), tsBar: $('#tsBar'),
  };

  function toast(msg, ms = 2200) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => els.toast.classList.remove('show'), ms);
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
  // تفسير السعدي: وحدات [أول آية، آخر آية، النص] — قد تشرح الوحدة عدة آيات. يُعاد مصفوفة: لكل آية وحدتها
  const loadTafsir = () => (tafsirPromise ||= fetch('data/tafsir.json').then((r) => r.json()).then(({ units }) => {
    const byAyah = [];
    units.forEach(([first, last, text]) => { const u = { first, last, text }; for (let k = first; k <= last; k++) byAyah[k] = u; });
    return byAyah;
  }).catch((e) => { tafsirPromise = null; throw e; }));

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
    els.tsSetup.hidden = true;
    els.tsReport.hidden = true;
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
    els.tsSetup.hidden = true;
    els.tsReport.hidden = true;
    els.home.hidden = false;
  }

  function route() {
    if (ts && location.hash !== '#tasmee-run') tsStop();
    if (location.hash === '#read') showReader();
    else if (location.hash === '#tasmee') showTasmeeSetup();
    else if (location.hash === '#tasmee-report' && tsLast) showTasmeeReport();
    else if (location.hash.startsWith('#tasmee')) { history.replaceState(null, '', '#tasmee'); showTasmeeSetup(); }
    else showHome();
  }

  $('#startBtn').addEventListener('click', () => {
    history.pushState({ reader: true }, '', '#read');
    showReader();
  });
  $('#backBtn').addEventListener('click', () => {
    if (ts) { tsFinish(); return; }
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
    const bar = !els.player.hidden ? els.player : !els.tsBar.hidden ? els.tsBar : null;
    const playerH = bar ? bar.offsetHeight + 18 : 0;
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
    if (ts) tsPaint(page);
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
    if (suppressClick || !built || ts) return;
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

  // يقسم نص السعدي عند كل اقتباس {…} من القرآن: [{q: الاقتباس أو '', e: الشرح الذي يليه}]
  function tafsirItems(unit) {
    const parts = unit.text.split(/\{([^}]*)\}/);
    const items = parts[0].trim() ? [{ q: '', e: parts[0].trim() }] : [];
    for (let k = 1; k < parts.length; k += 2) items.push({ q: parts[k].trim(), e: parts[k + 1].replace(/^[\s.،,:؛]+$/, '').trim() });
    return items;
  }
  const unitRef = (u) => `${surahOf(u.first).name} ${ar(Q.ayat[u.first][1])}${u.last > u.first ? `-${ar(Q.ayat[u.last][1])}` : ''}`;

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
        <h3>تفسير السعدي · ${surahOf(i).name} ${ar(Q.ayat[i][1])}</h3>
      </div>
      <div class="tafsir-tools">
        <button type="button" class="chip" data-t="listen">${ICON.listen}<span>استماع التفسير</span></button>
        <button type="button" class="chip" data-t="copy">${ICON.copy}<span>نسخ</span></button>
      </div>
      <ol class="tafsir-body"><li class="t-loading"><span class="spinner"></span></li></ol>`;
    let items = null;
    let unit = null;
    node.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      if (b.dataset.t === 'back') { if (player.isTafsirOf(i)) player.close(); showActions(); }
      if (b.dataset.t === 'copy' && items) {
        const text = items.map((it) => [it.q && `﴿${it.q}﴾`, it.e].filter(Boolean).join('\n')).join('\n\n');
        copyText(`${text}\n\n(تفسير السعدي - ${unitRef(unit)})`, 'تم نسخ التفسير');
      }
      if (b.dataset.t === 'listen') {
        if (player.isTafsirOf(i)) player.close();
        else player.playTafsir(i);
      }
    });
    mountPop(node, i);
    try {
      unit = (await loadTafsir())[i];
      items = tafsirItems(unit);
    } catch {
      items = null;
    }
    if (pop !== node) return;
    $('.tafsir-body', node).innerHTML = items ? tafsirListHTML(items) : '<li class="t-error">تعذّر تحميل التفسير، تحقق من الاتصال.</li>';
    if (unit && unit.last > unit.first) $('h3', node).textContent = `تفسير السعدي · ${unitRef(unit)}`;
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
  // instant: إغلاق فوري بلا حركة انزلاق — عند الانتقال لصفحة أو بدء التشغيل،
  // لأن إعادة رسم الصفحة تجمّد الحركة في الجوال فيظهر الدرج فارغاً فوق المشغّل.
  function closeDrawer(instant = false) {
    if (instant === true) {
      els.drawer.classList.add('instant');
      void els.drawer.offsetWidth;
      requestAnimationFrame(() => requestAnimationFrame(() => els.drawer.classList.remove('instant')));
    }
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
    closeDrawer(true);
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
    closeDrawer(true);
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
  let searchLines = null; // النص الإملائي لكل آية، كلماته بنفس ترتيب كلمات المصحف (والكلمة المركبة تُفصل بـ _)
  let searchPromise = null;
  function loadSearch() {
    return (searchPromise ||= Promise.all([loadData(), fetch('data/search.json').then((r) => r.json())]).then(([, lines]) => {
      searchLines = lines;
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
    closeDrawer(true);
    sel = null;
    await goTo(Q.ayat[r.i][2]);
    await loadPageFont(current);
    select(r.i, r.words.size ? r.words : null);
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
    // عناصر القائمة: { kind: 'ayah'|'basmala'|'tafsir', i?, s? }
    let queue = [];
    let qi = 0;
    let mode = 'single';   // single | range | withTafsir | tafsirOnly
    let finished = false;
    let seeking = false;
    let token = 0;         // يتغير عند كل إيقاف/انتقال لإلغاء أي تسلسل جارٍ
    let phase = null;      // 'audio' أثناء تشغيل ملف صوتي
    let tafsirSync = null; // أثناء تشغيل ملف تفسير مسجّل: { i }
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
      els.player.classList.toggle('is-loading', state === 'loading');
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
      ui.reciter.textContent = it.kind === 'tafsir' ? 'تفسير السعدي' : reciterName();
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
      tafsirSync = null;
      audio.pause();
      phase = null;
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
      if (nx && nx.kind === 'tafsir') loadTafsir();
    }

    function advance() {
      if (qi < queue.length - 1) { playAt(qi + 1); return; }
      finished = true;
      phase = null;
      setState('paused');
      tafsirHighlight(popAyah, -1);
      syncTafsirButton();
    }

    async function runTafsir(i, my) {
      syncTafsirButton();
      if (mode === 'withTafsir' && (!pop || !pop.classList.contains('tafsir') || +pop.dataset.i !== i)) {
        sel = { i, words: null };
        redrawMarks();
        await showTafsir(i);
        if (my !== token) return;
      }
      syncTafsirButton();
      const file = await tafsirAudioFile(i);
      if (my !== token) return;
      // آية شُرحت مع التي بعدها: في الاستماع المتتابع يأتي شرحها بعد الآية التالية
      if (file && file.shared && mode === 'withTafsir') { advance(); return; }
      if (file) { playTafsirFile(i, file.url); return; }
      if (!runTafsir.warned) { runTafsir.warned = true; toast('بعض الآيات لم يُسجَّل تفسيرها الصوتي بعد', 3500); }
      advance();
    }

    // التفسير الصوتي المسجّل (د. علي عطيف، tools/atif_split.py): ملف لكل آية
    let tafsirIndex = null;
    function tafsirAudioFile(i) {
      tafsirIndex ||= fetch(`${window.TAFSIR_AUDIO_BASE}index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      return tafsirIndex.then((x) => {
        if (!x) return null;
        const j = x.shared[i] ?? i;
        if (!x.ayat.includes(j)) return null;
        const [s, a] = Q.ayat[j];
        return { url: `${window.TAFSIR_AUDIO_BASE}${pad3(s)}${pad3(a)}.${x.ext}`, shared: j !== i };
      });
    }
    function playTafsirFile(i, url) {
      tafsirSync = { i };
      ui.back.disabled = false;
      ui.fwd.disabled = false;
      tafsirHighlight(i, 0);
      if (pop && +pop.dataset.i === i) $$('.t-chunk', pop).forEach((x) => x.classList.add('reading'));
      phase = 'audio';
      audio.src = url;
      audio.play().catch((err) => { if (err.name !== 'AbortError') setState('paused'); });
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
    audio.addEventListener('ended', () => {
      if (phase !== 'audio') return;
      if (tafsirSync) { tafsirHighlight(tafsirSync.i, -1); tafsirSync = null; }
      advance();
    });
    audio.addEventListener('error', () => {
      if (!audio.getAttribute('src') || phase !== 'audio') return;
      setState('paused');
      toast(tafsirSync ? 'تعذّر تشغيل التفسير، تحقق من الاتصال' : 'تعذّر تشغيل التلاوة، تحقق من الاتصال');
    });

    ui.play.addEventListener('click', () => {
      if (!queue.length) return;
      if (finished) { playAt(0); return; }
      if (phase === 'audio') { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
    });
    ui.prev.addEventListener('click', () => stepAyah(-1));
    ui.next.addEventListener('click', () => stepAyah(1));
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
        mode = 'tafsirOnly';
        queue = [{ kind: 'tafsir', i }];
        playAt(0);
        syncTafsirButton();
      },
      playRange(s, from, to, withTafsir) {
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

  /* ================= التسميع ================= */
  // يُخفي كلمات المقطع المختار، ويستمع للتلاوة عبر التعرف على الكلام في المتصفح (Web Speech API)،
  // ويُظهر كل كلمة تُقرأ صحيحة. الكلمة الخاطئة: مربع أحمر مكانها، وبعد ٣ محاولات تظهر بالأحمر.
  // إعادة قراءة كلمات ظاهرة: إطار أزرق خفيف. وفي النهاية تقرير مفصل.
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  // التعرّف على التلاوة من سيرفر الموقع (نموذج مدرَّب على القرآن، tools/asr_server.py).
  // واجهته مثل SpeechRecognition في المتصفح حتى يعمل التسميع مع أيهما: يبث صوت المايك
  // بدقة 16 كيلوهرتز، ويستقبل نص الجملة الجارية (partial) ثم نصها النهائي عند التوقف (final).
  let tsAudio = null; // سياق صوت واحد يُنشأ داخل ضغطة المستخدم ويبقى (سفاري يشترط ذلك)
  class ServerRec {
    start() {
      this.finals = [];
      this.partial = '';
      tsAudio ||= new (window.AudioContext || window.webkitAudioContext)();
      tsAudio.resume();
      const ws = new WebSocket(window.ASR_URL);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      let opened = false;
      ws.onopen = () => { opened = true; };
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.type === 'final') { this.finals.push(d.text); this.partial = ''; } else this.partial = d.text;
        const results = this.finals.map((t) => Object.assign([{ transcript: t }], { isFinal: true }));
        if (this.partial) results.push(Object.assign([{ transcript: this.partial }], { isFinal: false }));
        if (this.onresult) this.onresult({ results, server: true });
      };
      ws.onclose = () => {
        if (this.stopped) return;
        this.abort();
        if (this.onerror) this.onerror({ error: opened ? 'network' : 'server-unavailable' });
        if (this.onend) this.onend();
      };
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then((stream) => {
          if (this.stopped) { stream.getTracks().forEach((tr) => tr.stop()); return; }
          this.stream = stream;
          this.src = tsAudio.createMediaStreamSource(stream);
          this.proc = tsAudio.createScriptProcessor(4096, 1, 1);
          const ratio = tsAudio.sampleRate / 16000;
          this.proc.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const x = e.inputBuffer.getChannelData(0);
            const out = new Int16Array(Math.floor(x.length / ratio));
            for (let j = 0; j < out.length; j++) {
              const a = Math.floor(j * ratio);
              const b = Math.max(a + 1, Math.floor((j + 1) * ratio));
              let sum = 0;
              for (let q = a; q < b; q++) sum += x[q];
              out[j] = Math.max(-1, Math.min(1, sum / (b - a))) * 32767;
            }
            ws.send(out.buffer);
          };
          this.src.connect(this.proc);
          this.proc.connect(tsAudio.destination);
        })
        .catch(() => {
          this.abort();
          if (this.onerror) this.onerror({ error: 'not-allowed' });
        });
    }
    abort() {
      this.stopped = true;
      if (this.proc) { this.proc.onaudioprocess = null; this.proc.disconnect(); }
      if (this.src) this.src.disconnect();
      if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
      if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close();
    }
    stop() { this.abort(); }
  }
  const ts$ = {
    surah: $('#tsSurah'), from: $('#tsFrom'), to: $('#tsTo'), mic: $('#tsMic'), start: $('#tsStart'),
    support: $('#tsSupport'), progress: $('#tsProgress'), heard: $('#tsHeard'), rBody: $('#tsrBody'), rRange: $('#tsrRange'),
  };
  let ts = null;      // جلسة التسميع الجارية
  let tsLast = null;  // آخر جلسة منتهية (للتقرير وإعادة التسميع)
  const MAX_TRIES = 3;

  // الاستعاذة والبسملة قبل البدء لا تُحسب أخطاء
  const TS_PREAMBLE = new Set(normalize('اعوذ بالله من الشيطان الرجيم بسم الله الرحمن الرحيم').split(' '));
  // الحروف المقطعة تُنطق بأسمائها
  const LETTER_NAMES = { ا: 'الف', ل: 'لام', م: 'ميم', ر: 'را', ص: 'صاد', ك: 'كاف', ه: 'ها', ي: 'يا', ع: 'عين', ط: 'طا', س: 'سين', ح: 'حا', ق: 'قاف', ن: 'نون' };
  const MUQATTAAT = new Set(['الم', 'المص', 'الر', 'المر', 'كهيعص', 'طه', 'طسم', 'طس', 'يس', 'ص', 'حم', 'عسق', 'ق', 'ن']);

  const tsClean = (s) => normalize(s).replace(/[^ء-ي\s]/g, ' ').replace(/ء/g, '').replace(/\s+/g, ' ').trim();

  function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let x = 1; x <= a.length; x++) {
      const cur = [x];
      for (let y = 1; y <= b.length; y++) cur[y] = Math.min(prev[y] + 1, cur[y - 1] + 1, prev[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  // تطابق كلمتين مع تسامح بسيط مع اختلافات الإملاء والتعرّف
  function tsSame(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const L = Math.max(a.length, b.length);
    if (L < 4) return false;
    return lev(a, b) <= (L >= 8 ? 2 : 1);
  }

  // كلمات المقطع: لكل كلمة من المصحف طرق نطقها المقبولة (مصفوفات كلمات منطوقة)
  function tsWords(s, from, to) {
    const words = [];
    for (let a = from; a <= to; a++) {
      const i = surahStart[s] + a - 1;
      searchLines[i].split(' ').forEach((w, k) => {
        const pieces = w.split('_').map(tsClean).filter(Boolean);
        const alts = [pieces];
        if (k === 0 && MUQATTAAT.has(pieces.join('')) && (a === 1 || (s === 42 && a === 2))) {
          alts.push([...pieces.join('')].map((c) => LETTER_NAMES[c]).filter(Boolean));
        }
        words.push({ i, k, alts, state: 'hidden', tries: 0, heard: [] });
      });
    }
    return words;
  }

  // كم كلمة منطوقة (ابتداءً من t) تطابق كلمة المصحف رقم p؟ ٠ = لا تطابق
  function tsMatch(tokens, t, p) {
    const w = ts.words[p];
    if (!w || t >= tokens.length) return 0;
    for (const alt of w.alts) {
      if (alt.length && alt.every((piece, j) => tsSame(tokens[t + j], piece))) return alt.length;
      const joined = alt.join('');
      if (alt.length > 1 && tsSame(tokens[t], joined)) return 1;              // المتعرّف دمج كلمتين
      if (t + 1 < tokens.length && tsSame(tokens[t] + tokens[t + 1], joined)) return 2; // أو قسّم كلمة
    }
    return 0;
  }

  function tsStep(tokens, t, final) {
    const p = ts.ptr;
    let n = tsMatch(tokens, t, p);
    if (n) { tsReveal(p, n === 1 ? t : -1, tokens); return t + n; }
    // متابعة إعادة قراءة بدأت
    if (ts.againAt >= 0 && ts.againAt + 1 < p && (n = tsMatch(tokens, t, ts.againAt + 1))) { tsAgain(ts.againAt + 1); return t + n; }
    if (!final) return -1; // النتائج المؤقتة تُستعمل للإظهار السريع فقط، والأخطاء تُحسب من النتائج النهائية
    if (!ts.started && TS_PREAMBLE.has(tokens[t])) return t + 1;
    // تخطّى كلمة أو كلمتين (نسيان)
    for (let d = 1; d <= 3 && p + d < ts.words.length; d++) {
      n = tsMatch(tokens, t, p + d);
      if (n && (tokens[t].length >= 4 || tsMatch(tokens, t + n, p + d + 1))) {
        for (let q = p; q < p + d; q++) tsMiss(q, 'skip');
        tsReveal(p + d, n === 1 ? t : -1, tokens);
        return t + n;
      }
    }
    // يعيد قراءة كلمات سبق أن ظهرت
    for (let q = p - 1; q >= Math.max(0, p - 40); q--) {
      n = tsMatch(tokens, t, q);
      if (n && (tokens[t].length >= 3 || tsMatch(tokens, t + n, q + 1))) { tsAgain(q); return t + n; }
    }
    tsWrong(p, tokens[t]);
    return t + 1;
  }

  // t: موضع الكلمة المسموعة (لفحص الحركات)، أو -1 إن طابقت أكثر من كلمة مسموعة
  function tsReveal(p, t = -1, tokens = null) {
    const w = ts.words[p];
    if (w.tries) ts.mistakes.push({ p, type: 'fix' });
    const heard = t >= 0 && ts.cur ? ts.cur.raw[t] : '';
    if (heard) {
      const waqf = ts.cur.ends.has(t);
      // الكلمة طابقت بتسامح لا حرفياً: نطقها مختلف (حرف أو حركة)، والسيرفر يكتب بدقة
      const differs = !w.alts.some((alt) => alt.length === 1 && alt[0] === tokens[t]);
      if (tsHarakaError(Q.ayat[w.i][7][w.k], heard, waqf) || (differs && /[\u064B-\u0652]/.test(heard))) {
        w.haraka = heard;
        ts.mistakes.push({ p, type: 'haraka' });
      }
    }
    w.state = 'ok';
    ts.ptr = p + 1;
    tsBegin();
    ts.started = true;
    tsEndAgain();
    tsUpdate();
  }
  function tsBegin() {
    if (!ts.t0) ts.t0 = Date.now();
  }
  function tsWrong(p, heard) {
    const w = ts.words[p];
    tsBegin();
    w.tries++;
    w.heard.push(heard);
    w.state = 'wrong';
    if (w.tries >= MAX_TRIES) {
      tsMiss(p, 'forced');
      ts.ptr = p + 1;
    }
    tsEndAgain();
    tsUpdate();
  }
  function tsMiss(p, type) {
    ts.words[p].state = 'red';
    ts.mistakes.push({ p, type });
  }
  function tsAgain(q) {
    if (ts.againAt < 0) ts.rereads++;
    ts.againAt = q;
    ts.again.add(q);
    tsUpdate(false);
  }
  function tsEndAgain() {
    ts.againAt = -1;
    ts.again.clear();
  }

  // يلوّن كلمات الصفحة حسب حالتها
  function tsPaint(page) {
    $$('.w:not(.end)', page).forEach((el) => {
      const p = ts.index.get(`${el.dataset.i}:${el.dataset.k}`);
      const w = p === undefined ? null : ts.words[p];
      el.classList.toggle('t-ok', !!w && w.state === 'ok');
      el.classList.toggle('t-haraka', !!w && w.state === 'ok' && !!w.haraka);
      el.classList.toggle('t-wrong', !!w && w.state === 'wrong');
      el.classList.toggle('t-red', !!w && w.state === 'red');
      el.classList.toggle('t-again', p !== undefined && ts.again.has(p));
    });
  }

  function tsUpdate(follow = true) {
    Object.values(panes).forEach((pane) => pane.firstElementChild && tsPaint(pane.firstElementChild));
    const done = Math.min(ts.ptr, ts.words.length);
    ts$.progress.textContent = `${ar(done)} / ${ar(ts.words.length)} كلمة`;
    if (ts.ptr >= ts.words.length) { setTimeout(() => ts && tsFinish(), 900); return; }
    if (follow) {
      const page = Q.ayat[ts.words[ts.ptr].i][2];
      if (page !== current && !animating) goTo(page, { animate: Math.abs(page - current) === 1 });
    }
  }

  // نص التعرّف الحالي ككلمات، وعدد الكلمات النهائية منها.
  // كروم أندرويد يعيد أحياناً كل النص السابق في كل نتيجة جديدة، فتُستعمل آخر نتيجة فقط حينها.
  function tsTokens(results, fromServer) {
    const list = [...results].map((r) => {
      const words = [];
      const raw = [];
      r[0].transcript.trim().split(/\s+/).forEach((rw) => {
        const pieces = tsClean(rw).split(' ').filter(Boolean);
        pieces.forEach((c) => { words.push(c); raw.push(pieces.length === 1 ? rw : ''); });
      });
      return { words, raw, final: r.isFinal };
    });
    const cumulative = !fromServer && list.length > 1 && list.every((r, k) => !k || r.words.join(' ').startsWith(list[k - 1].words.join(' ')));
    const use = cumulative ? [list[list.length - 1]] : list;
    const tokens = [];
    const raw = [];
    const ends = new Set(); // آخر كلمة في كل جملة نهائية (موضع وقف)
    let finalCount = 0;
    use.forEach((r) => {
      tokens.push(...r.words);
      raw.push(...r.raw);
      if (r.final) { finalCount = tokens.length; ends.add(tokens.length - 1); }
    });
    return { tokens, raw, ends, finalCount };
  }

  // الحركات: تُقارن حركة كل حرف بين الرسم العثماني وما سُمع، إن كان للكلمتين نفس الحروف.
  // يُتجاهل آخر حرف في موضع الوقف (يُسكَّن عند الوقف)، وتُتجاهل الحروف التي لا حركة لها في أحدهما.
  const HARAKA = { '\u064E': 'a', '\u064B': 'a', '\u08F0': 'a', '\u064F': 'u', '\u064C': 'u', '\u08F1': 'u', '\u0650': 'i', '\u064D': 'i', '\u08F2': 'i' };
  function tsLetters(word) {
    const out = [];
    for (const ch of word.normalize('NFC')) {
      if (HARAKA[ch]) { if (out.length) out[out.length - 1].h = HARAKA[ch]; continue; }
      if (/[اٱىٰـۥۦ]/.test(ch) || !/[\u0621-\u064A]/.test(ch)) continue;
      out.push({ l: /[أإآؤئء]/.test(ch) ? 'ء' : ch === 'ة' ? 'ت' : ch, h: '' });
    }
    return out;
  }
  function tsHarakaError(expected, heard, waqf) {
    const a = tsLetters(expected);
    const b = tsLetters(heard);
    if (!b.some((x) => x.h) || a.length !== b.length || a.some((x, k) => x.l !== b[k].l)) return false;
    const last = waqf ? a.length - 1 : a.length;
    for (let k = 0; k < last; k++) if (a[k].h && b[k].h && a[k].h !== b[k].h) return true;
    return false;
  }

  function tsListen() {
    const useServer = window.ASR_URL && !(ts && ts.native);
    const rec = useServer ? new ServerRec() : new SpeechRec();
    rec.lang = 'ar-SA';
    rec.continuous = true;
    rec.interimResults = true;
    let consumed = 0;
    rec.onresult = (e) => {
      if (!ts || ts.rec !== rec) return;
      const { tokens, raw, ends, finalCount } = tsTokens(e.results, e.server);
      if (tokens.length) ts$.heard.textContent = tokens.slice(-7).join(' ');
      if (!ts.ready) return;
      ts.cur = { raw, ends };
      // آخر كلمة في النتيجة المؤقتة قد تكون مقطوعة: تنتظر التحديث التالي
      const limit = finalCount === tokens.length ? tokens.length : tokens.length - 1;
      let t = consumed;
      while (ts && t < limit && ts.ptr < ts.words.length) {
        const next = tsStep(tokens, t, t < finalCount);
        if (next < 0) break;
        t = next;
      }
      consumed = Math.max(consumed, t);
    };
    rec.onerror = (e) => {
      if (!ts || ts.rec !== rec) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast('لم يُسمح باستخدام المايكروفون. اسمح به من إعدادات المتصفح ثم أعد المحاولة', 5000);
        ts.running = false;
      } else if (e.error === 'server-unavailable' && SpeechRec) {
        ts.native = true; // سيرفر التسميع لا يرد: نكمل بالتعرّف المدمج في المتصفح
        toast('سيرفر التسميع غير متاح الآن، سيُستعمل التعرّف من المتصفح', 3500);
      } else if (e.error === 'network' || e.error === 'server-unavailable') {
        toast('التسميع يحتاج اتصالاً بالإنترنت', 3500);
      }
    };
    // المتصفح يوقف الاستماع بعد فترة صمت؛ نعيد تشغيله ما دامت الجلسة قائمة
    rec.onend = () => {
      if (ts && ts.rec === rec && ts.running) setTimeout(() => { if (ts && ts.rec === rec && ts.running) tsListen(); }, 250);
    };
    if (ts) ts.rec = rec;
    try { rec.start(); } catch { /* يبدأ في المحاولة التالية */ }
  }

  async function tsStart(s, from, to) {
    tsStop();
    ts = { s, from, to, words: [], index: new Map(), ptr: 0, againAt: -1, again: new Set(), rereads: 0, mistakes: [],
      started: false, ready: false, running: true, t0: 0, rec: null };
    tsListen(); // داخل ضغطة المستخدم حتى يسمح المتصفح بالمايكروفون
    els.reader.classList.add('tasmee');
    els.menuBtn.hidden = true;
    player.close();
    els.tsBar.hidden = false;
    ts$.heard.textContent = 'ابدأ القراءة…';
    await Promise.all([showReader(), loadSearch()]);
    if (!ts) return;
    ts.words = tsWords(s, from, to);
    ts.words.forEach((w, p) => ts.index.set(`${w.i}:${w.k}`, p));
    ts.ready = true;
    const page = Q.ayat[surahStart[s] + from - 1][2];
    clearSelection();
    await goTo(page);
    layoutAll();
    tsUpdate(false);
  }

  function tsStop() {
    if (!ts) return;
    ts.running = false;
    try { ts.rec && ts.rec.abort(); } catch { /* تم إيقافه */ }
    ts = null;
    els.reader.classList.remove('tasmee');
    els.menuBtn.hidden = false;
    els.tsBar.hidden = true;
    redrawMarks();
    if (built) layoutAll();
  }

  function tsFinish() {
    if (!ts) return;
    const session = ts;
    session.t1 = Date.now();
    tsLast = session;
    tsStop();
    history.replaceState({ tasmee: true }, '', '#tasmee-report');
    showTasmeeReport();
  }

  /* ---- صفحة الإعدادات ---- */
  let tsFilled = false;
  async function showTasmeeSetup() {
    els.home.hidden = true;
    els.reader.hidden = true;
    els.tsReport.hidden = true;
    els.tsSetup.hidden = false;
    if (!SpeechRec && !window.ASR_URL) {
      ts$.support.hidden = false;
      ts$.support.textContent = 'متصفحك لا يدعم التعرف على الكلام. استخدم Google Chrome أو Safari على الجوال أو الكمبيوتر.';
    }
    try { await Promise.all([loadData(), loadSearch()]); } catch { toast('تعذّر تحميل البيانات، تحقق من الاتصال'); return; }
    if (!tsFilled) {
      tsFilled = true;
      Q.surahs.forEach((x) => ts$.surah.appendChild(option(x.n, `${ar(x.n)}. سورة ${x.name}`)));
      let saved = null;
      try { saved = JSON.parse(store.get('q.ts', 'null')); } catch { /* إعداد قديم أو تالف */ }
      ts$.surah.value = saved && Q.surahs[saved.s - 1] ? saved.s : 1;
      tsFillAyat();
      if (saved && +ts$.surah.value === saved.s && saved.to <= Q.surahs[saved.s - 1].count) { ts$.from.value = saved.from; ts$.to.value = saved.to; }
    }
  }
  function tsFillAyat() {
    const count = Q.surahs[ts$.surah.value - 1].count;
    [ts$.from, ts$.to].forEach((sel) => {
      sel.textContent = '';
      for (let a = 1; a <= count; a++) sel.appendChild(option(a, ar(a)));
    });
    ts$.from.value = 1;
    ts$.to.value = count;
  }
  ts$.surah.addEventListener('change', tsFillAyat);
  ts$.from.addEventListener('change', () => { if (+ts$.to.value < +ts$.from.value) ts$.to.value = ts$.from.value; });
  ts$.to.addEventListener('change', () => { if (+ts$.to.value < +ts$.from.value) ts$.from.value = ts$.to.value; });

  ts$.mic.addEventListener('change', async () => {
    ts$.start.disabled = true;
    if (!ts$.mic.checked) return;
    if (!SpeechRec && !window.ASR_URL) { ts$.mic.checked = false; toast('متصفحك لا يدعم التعرف على الكلام'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
      ts$.start.disabled = false;
    } catch {
      ts$.mic.checked = false;
      toast('لم يُسمح باستخدام المايكروفون. اسمح به من إعدادات المتصفح', 4000);
    }
  });

  ts$.start.addEventListener('click', () => {
    const s = +ts$.surah.value;
    const from = +ts$.from.value;
    const to = +ts$.to.value;
    store.set('q.ts', JSON.stringify({ s, from, to }));
    history.pushState({ tasmee: true }, '', '#tasmee-run');
    tsStart(s, from, to);
  });
  $('#tsEnd').addEventListener('click', tsFinish);
  $('#tasmeeBtn').addEventListener('click', () => {
    history.pushState({ tasmee: true }, '', '#tasmee');
    showTasmeeSetup();
  });
  $$('[data-ts-home]').forEach((b) => b.addEventListener('click', () => {
    history.replaceState(null, '', location.pathname + location.search);
    showHome();
  }));

  /* ---- التقرير ---- */
  function showTasmeeReport() {
    const r = tsLast;
    els.home.hidden = true;
    els.reader.hidden = true;
    els.tsSetup.hidden = true;
    els.tsReport.hidden = false;
    const name = Q.surahs[r.s - 1].name;
    ts$.rRange.textContent = `سورة ${name} · الآيات ${ar(r.from)}–${ar(r.to)}`;
    const total = r.words.length;
    const read = Math.min(r.ptr, total);
    const count = (type) => r.mistakes.filter((m) => m.type === type).length;
    const fix = count('fix');
    const forced = count('forced');
    const skip = count('skip');
    const haraka = count('haraka');
    const clean = r.words.slice(0, read).filter((w) => w.state === 'ok' && !w.tries && !w.haraka).length;
    const score = read ? Math.round((clean / read) * 100) : 0;
    const secs = r.t0 ? Math.round(((r.t1 || Date.now()) - r.t0) / 1000) : 0;
    const mins = Math.floor(secs / 60);
    const time = mins ? `${ar(mins)} دقيقة${secs % 60 ? ` و${ar(secs % 60)} ثانية` : ''}` : `${ar(secs)} ثانية`;
    const verdict = !read ? 'لم تُقرأ أي كلمة' : score >= 95 ? 'ممتاز، حفظ متقن' : score >= 85 ? 'جيد جداً' : score >= 70 ? 'جيد، يحتاج مراجعة' : 'يحتاج مراجعة أكثر';
    const stat = (v, label, cls = '') => `<div class="tsr-stat ${cls}"><b>${ar(v)}</b><span>${label}</span></div>`;
    const tag = { fix: ['خطأ ثم صُحّح', 'fix'], forced: ['ظهرت بعد ٣ أخطاء', ''], skip: ['نسيان (تُخطيت)', 'skip'], haraka: ['خطأ في الحركات', 'haraka'] };
    const list = r.mistakes.slice().sort((a, b) => a.p - b.p).map((m) => {
      const w = r.words[m.p];
      const heard = m.type === 'haraka' ? `سُمع: <span class="tsr-heard">${w.haraka}</span>` : w.heard.length ? `سُمع: ${w.heard.join('، ')}` : '';
      return `<li><div><div class="tsr-word">${Q.ayat[w.i][7][w.k]}</div><span class="tsr-tag ${tag[m.type][1]}">${tag[m.type][0]}</span></div>
        <div class="tsr-meta">الآية ${ar(Q.ayat[w.i][1])}${heard ? `<br>${heard}` : ''}</div></li>`;
    }).join('');
    ts$.rBody.innerHTML = `
      <div class="ts-card tsr-score">
        <div class="tsr-ring" style="--p:${score}"><b>${ar(score)}٪</b></div>
        <div><h2>${verdict}</h2><p>قرأت ${ar(read)} من ${ar(total)} كلمة في ${time}</p></div>
      </div>
      <div class="tsr-stats">
        ${stat(clean, 'كلمة صحيحة من أول مرة', 'good')}
        ${stat(fix, 'خطأ ثم صحّحته', 'bad')}
        ${stat(forced, 'كلمة ظهرت بعد ٣ أخطاء', 'bad')}
        ${stat(skip, 'كلمة منسية (تخطيتها)', 'bad')}
        ${stat(haraka, 'خطأ في الحركات أو النطق', 'warn')}
        ${stat(r.rereads, 'مرة أعدت فيها القراءة', 'blue')}
        ${stat(total - read, 'كلمة لم تصل إليها')}
      </div>
      <div class="ts-card"><h3>مواضع الأخطاء</h3>${list ? `<ul class="tsr-list">${list}</ul>` : '<p class="note">لا توجد أخطاء، أحسنت! 🌟</p>'}</div>
      <p class="note">فحص الحركات يعمل مع تعرّف السيرفر، ويتجاهل حركة آخر الكلمة عند الوقف.</p>
      <div class="tsr-actions">
        <button type="button" class="primary-btn" data-r="again">إعادة التسميع</button>
        <button type="button" class="primary-btn ghost" data-r="setup">مقطع آخر</button>
      </div>`;
    $('[data-r="again"]', ts$.rBody).addEventListener('click', () => {
      history.replaceState({ tasmee: true }, '', '#tasmee-run');
      els.tsReport.hidden = true;
      tsStart(r.s, r.from, r.to);
    });
    $('[data-r="setup"]', ts$.rBody).addEventListener('click', () => {
      history.replaceState({ tasmee: true }, '', '#tasmee');
      showTasmeeSetup();
    });
  }

  /* ================= البدء ================= */
  loadData().catch(() => {});
  if (location.hash === '#read') {
    history.replaceState({ reader: false }, '', location.href);
    showReader();
  }
  else if (location.hash.startsWith('#tasmee')) {
    history.replaceState(null, '', '#tasmee');
    showTasmeeSetup();
  }
})();
