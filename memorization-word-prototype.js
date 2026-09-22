(() => {
  const $ = (selector) => document.querySelector(selector);
  const debug = new URLSearchParams(location.search).get("debugMemorizationWords") === "true";
  const cache = new Map();
  const baseUrl = "https://raw.githubusercontent.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG/main/SVG%20V1.01";
  const pad = (number) => String(number).padStart(3, "0");
  const normalize = (text) => String(text || "").normalize("NFKD").replace(/\p{M}/gu, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/[^ء-ي]/g, "");
  const verseParts = (host, surah, ayah) => {
    const root = `g[id^="md-word-"][data-surah="${pad(surah)}"][data-aya="${pad(ayah)}"][data-type="text"]`;
    const svgParts = [...host.querySelectorAll(root)];
    const canonical = (window.QuranAppData?.getVerseText(`${surah}:${ayah}`) || "").split(/\s+/).filter(Boolean);
    const grouped = []; let cursor = 0;
    for (const word of canonical) {
      const target = normalize(word), parts = []; let combined = "";
      while (cursor < svgParts.length && combined.length < target.length) {
        const part = svgParts[cursor++]; parts.push(part); combined += normalize(part.dataset.imlaey || part.dataset.hafs);
      }
      if (combined !== target) { console.warn("[Quran Memorization Words] SVG/text mismatch", { surah, ayah, word, combined }); return svgParts.map((part) => [part]); }
      grouped.push(parts);
    }
    return cursor === svgParts.length ? grouped : svgParts.map((part) => [part]);
  };

  async function getSvgMarkup(page) {
    if (!cache.has(page)) cache.set(page, fetch(`${baseUrl}/${pad(page)}.svg`).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    }));
    return cache.get(page);
  }
  async function loadPage(host, page) {
    if (host.dataset.svgPage === String(page) && host.querySelector("svg")) return host.querySelector("svg");
    const parsed = new DOMParser().parseFromString(await getSvgMarkup(page), "image/svg+xml");
    const svg = parsed.documentElement;
    if (svg.nodeName.toLowerCase() !== "svg" || !svg.querySelector('g[id^="md-word-"][data-type="text"]')) throw new Error("SVG word metadata unavailable");
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `صفحة ${page} من مصحف SVG`);
    host.replaceChildren(document.importNode(svg, true)); host.dataset.svgPage = String(page);
    return host.querySelector("svg");
  }
  // The source SVG retains canonical word geometry, while this function makes
  // a readable active-region presentation inside the application's Mushaf shell.
  function filterPageContent(host, { surah, from, to }) {
    const svg = host.querySelector("svg"); if (!svg) return;
    const wanted = (node) => Number(node.dataset.surah) === Number(surah) && Number(node.dataset.aya) >= Number(from) && Number(node.dataset.aya) <= Number(to);
    const lines = [...svg.querySelectorAll('g[id^="md-line-"]')];
    const contextual = new Set();
    lines.forEach((line, index) => {
      const hasTarget = [...line.querySelectorAll('[data-surah][data-aya]')].some(wanted);
      if (hasTarget) return;
      const nextVerseLine = lines.slice(index + 1).find((next) => next.querySelector('[data-surah][data-aya]'));
      if (nextVerseLine && [...nextVerseLine.querySelectorAll('[data-surah][data-aya]')].some(wanted) && (line.dataset.type === "surah-name" || line.dataset.type === "bismillah")) contextual.add(line);
    });
    lines.forEach((line) => {
      const hasTarget = [...line.querySelectorAll('[data-surah][data-aya]')].some(wanted);
      line.style.visibility = hasTarget || contextual.has(line) ? "visible" : "hidden";
      line.classList.remove("mem-page-context", "mem-page-target");
    });
    svg.querySelectorAll('[data-surah][data-aya]').forEach((node) => { node.style.visibility = wanted(node) ? "visible" : "hidden"; });
    const original = svg.dataset.originalViewBox || svg.getAttribute("viewBox");
    svg.dataset.originalViewBox = original;
    const visible = [
      ...svg.querySelectorAll('[data-surah][data-aya]'),
      ...contextual,
    ].filter((node) => node.style.visibility !== "hidden");
    const boxes = visible.map((node) => { try { return node.getBBox(); } catch { return null; } }).filter((box) => box && box.width && box.height);
    if (!boxes.length) { svg.setAttribute("viewBox", original); return; }
    const left = Math.min(...boxes.map((box) => box.x)), top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width)), bottom = Math.max(...boxes.map((box) => box.y + box.height));
    const padX = Math.max(18, (right - left) * .17), padY = Math.max(22, (bottom - top) * .35);
    svg.setAttribute("viewBox", `${left - padX} ${top - padY} ${right - left + padX * 2} ${bottom - top + padY * 2}`);
  }
  function allWords(host) { return [...host.querySelectorAll('g[id^="md-word-"][data-type="text"]')]; }
  function targetWords(host, targets) { return targets.flatMap((target) => { const groups = verseParts(host, target.surah, target.ayah); return target.wordIndexes?.length ? target.wordIndexes.map((index) => groups[index]).filter((parts) => parts?.length) : groups; }); }
  function wordPartsFor(host, { verseKey, wordIndex }) { const [surah, ayah] = String(verseKey).split(":").map(Number); return verseParts(host, surah, ayah)[Number(wordIndex)] || []; }
  function wordFor(host, { verseKey, wordIndex }) {
    return wordPartsFor(host, { verseKey, wordIndex })[0] || null;
  }
  function renderWords(host, targets, { revealCount = 0, wrongIndex = null, activeIndex = null, confirmed = [], hidden = false, currentAyah, masteredAyahs = [], selectedFrom, selectedTo, surah } = {}) {
    const svg = host.querySelector("svg"); svg?.querySelector("#memorizationWrongWordLayer")?.remove();
    const words = allWords(host); words.forEach((word) => {
      word.classList.remove("mem-word-visible", "mem-word-hidden", "mem-word-wrong", "mem-word-active", "mem-word-future", "mem-word-mastered", "mem-word-confirmed");
      if (Number(word.dataset.surah) !== Number(surah)) return;
      const ayah = Number(word.dataset.aya);
      if (ayah < selectedFrom || ayah > selectedTo) return;
      if (ayah > currentAyah) word.classList.add("mem-word-future");
      else if (ayah < currentAyah || masteredAyahs.includes(ayah)) word.classList.add("mem-word-mastered");
    });
    const selected = targetWords(host, targets);
    if (hidden) selected.flat().forEach((word) => word.classList.add("mem-word-hidden"));
    selected.slice(0, revealCount).flat().forEach((word) => { word.classList.remove("mem-word-hidden"); word.classList.add("mem-word-visible"); });
    confirmed.forEach((identity) => wordPartsFor(host, identity).forEach((word) => { word.classList.remove("mem-word-hidden"); word.classList.add("mem-word-visible", "mem-word-confirmed"); }));
    if (activeIndex !== null && selected[activeIndex]) selected[activeIndex].forEach((word) => { word.classList.remove("mem-word-hidden"); word.classList.add("mem-word-visible", "mem-word-active"); });
    if (wrongIndex !== null && selected[wrongIndex] && svg) {
      // A wrong answer in hidden mode marks the real word geometry without
      // rendering the answer itself.
      const boxes = selected[wrongIndex].map((word) => word.getBBox()), left = Math.min(...boxes.map((box) => box.x)), top = Math.min(...boxes.map((box) => box.y));
      const box = { x: left, y: top, width: Math.max(...boxes.map((item) => item.x + item.width)) - left, height: Math.max(...boxes.map((item) => item.y + item.height)) - top };
      const layer = document.createElementNS("http://www.w3.org/2000/svg", "g"), rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      selected[wrongIndex].forEach((word) => word.classList.add("mem-word-wrong")); layer.id = "memorizationWrongWordLayer";
      rect.setAttribute("x", box.x); rect.setAttribute("y", box.y); rect.setAttribute("width", box.width); rect.setAttribute("height", box.height); rect.setAttribute("rx", "1.5"); rect.setAttribute("class", "mem-word-wrong-box"); layer.append(rect); svg.append(layer);
    }
    debugWords(host, selected); return selected;
  }
  function debugWords(host, selected) {
    const svg = host.querySelector("svg"); if (!svg) return; svg.querySelector("#memorizationWordDebug")?.remove(); if (!debug) return;
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g"); layer.id = "memorizationWordDebug";
    selected.flat().forEach((word) => { const box = word.getBBox(), label = document.createElementNS("http://www.w3.org/2000/svg", "text"), outline = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      label.setAttribute("x", box.x); label.setAttribute("y", Math.max(8, box.y - 1)); label.setAttribute("class", "mem-word-debug-label"); label.textContent = `${Number(word.dataset.surah)}:${Number(word.dataset.aya)}:${word.dataset.wordIndexInAyah}`;
      outline.setAttribute("x", box.x); outline.setAttribute("y", box.y); outline.setAttribute("width", box.width); outline.setAttribute("height", box.height); outline.setAttribute("class", "mem-word-debug-bound"); layer.append(outline, label);
      console.info("[Quran Memorization Words]", { page: Number(host.dataset.svgPage), verseKey: `${Number(word.dataset.surah)}:${Number(word.dataset.aya)}`, wordIndex: Number(word.dataset.wordIndexInAyah), state: word.classList.contains("mem-word-wrong") ? "wrong" : word.classList.contains("mem-word-hidden") ? "hidden" : "visible", geometry: box });
    }); svg.append(layer);
  }
  window.MemorizationSvgWords = { loadPage, filterPageContent, renderWords, targetWords, wordFor };
})();
