(() => {
  const $ = (selector) => document.querySelector(selector);
  const debug = new URLSearchParams(location.search).get("debugMemorizationWords") === "true";
  const cache = new Map();
  const baseUrl = "https://raw.githubusercontent.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG/main/SVG%20V1.01";
  const pad = (number) => String(number).padStart(3, "0");
  const selectorFor = ({ surah, ayah, wordIndexes }) => {
    const root = `g[id^="md-word-"][data-surah="${pad(surah)}"][data-aya="${pad(ayah)}"][data-type="text"]`;
    return wordIndexes?.length ? wordIndexes.map((index) => `${root}[data-word-index-in-ayah="${index + 1}"]`).join(",") : root;
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
    const renderedSvg = host.querySelector("svg");
    cropToMushafContent(renderedSvg, page);
    return renderedSvg;
  }
  // Source SVGs use a full 382.68 × 547.09 canvas while some opening pages
  // contain a much smaller md-page-inner group. Crop only the presentation
  // viewBox; all source coordinates and data-surah/data-aya/data-word-index
  // identities remain untouched.
  function cropToMushafContent(svg, page) {
    const content = svg.querySelector("#md-page-inner");
    if (!content || typeof content.getBBox !== "function") return;
    const box = content.getBBox();
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width < 1 || box.height < 1) return;
    const paddingX = Math.max(8, box.width * .045), paddingY = Math.max(8, box.height * .035);
    const x = Math.max(0, box.x - paddingX), y = Math.max(0, box.y - paddingY);
    const original = svg.getAttribute("viewBox");
    const width = Math.min(Number(original.split(/\s+/)[2]) - x, box.width + paddingX * 2);
    const height = Math.min(Number(original.split(/\s+/)[3]) - y, box.height + paddingY * 2);
    svg.dataset.originalViewBox = original;
    svg.dataset.contentBounds = `${box.x.toFixed(2)},${box.y.toFixed(2)},${box.width.toFixed(2)},${box.height.toFixed(2)}`;
    svg.setAttribute("viewBox", `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`);
    console.info("[Quran Memorization SVG]", { page, originalViewBox: original, contentBounds: { x: box.x, y: box.y, width: box.width, height: box.height }, renderedViewBox: svg.getAttribute("viewBox") });
  }
  function allWords(host) { return [...host.querySelectorAll('g[id^="md-word-"][data-type="text"]')]; }
  function targetWords(host, targets) { return targets.flatMap((target) => [...host.querySelectorAll(selectorFor(target))]); }
  // The only word renderer used by both the approved prototype and the real session.
  function renderWords(host, targets, { revealCount = 0, wrongIndex = null } = {}) {
    const words = allWords(host); words.forEach((word) => word.classList.remove("mem-word-visible", "mem-word-wrong")); words.forEach((word) => word.classList.add("mem-word-hidden"));
    const selected = targetWords(host, targets);
    selected.slice(0, revealCount).forEach((word, index) => { word.classList.remove("mem-word-hidden"); word.classList.add("mem-word-visible"); if (wrongIndex === index) word.classList.add("mem-word-wrong"); });
    if (wrongIndex !== null && selected[wrongIndex]) { selected[wrongIndex].classList.remove("mem-word-hidden"); selected[wrongIndex].classList.add("mem-word-visible", "mem-word-wrong"); }
    debugWords(host, selected); return selected;
  }
  function debugWords(host, selected) {
    const svg = host.querySelector("svg"); if (!svg) return; svg.querySelector("#memorizationWordDebug")?.remove(); if (!debug) return;
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g"); layer.id = "memorizationWordDebug";
    selected.forEach((word) => { const box = word.getBBox(), label = document.createElementNS("http://www.w3.org/2000/svg", "text"), outline = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      label.setAttribute("x", box.x); label.setAttribute("y", Math.max(8, box.y - 1)); label.setAttribute("class", "mem-word-debug-label"); label.textContent = `${Number(word.dataset.surah)}:${Number(word.dataset.aya)}:${word.dataset.wordIndexInAyah}`;
      outline.setAttribute("x", box.x); outline.setAttribute("y", box.y); outline.setAttribute("width", box.width); outline.setAttribute("height", box.height); outline.setAttribute("class", "mem-word-debug-bound"); layer.append(outline, label);
      console.info("[Quran Memorization Words]", { page: Number(host.dataset.svgPage), verseKey: `${Number(word.dataset.surah)}:${Number(word.dataset.aya)}`, wordIndex: Number(word.dataset.wordIndexInAyah), state: word.classList.contains("mem-word-wrong") ? "wrong" : word.classList.contains("mem-word-hidden") ? "hidden" : "visible", geometry: box });
    }); svg.append(layer);
  }
  window.MemorizationSvgWords = { loadPage, renderWords, targetWords };

  const prototypeTarget = { surah: 3, ayah: 23 }; let prototypeLoaded = false;
  async function openPrototype() { const status = $("#memorizationPrototypeStatus"), host = $("#memorizationPrototypePage"); $("#memorizationSetup").classList.add("hidden"); $("#memorizationWordPrototype").classList.remove("hidden"); try { await loadPage(host, 53); prototypeLoaded = true; renderWords(host, [prototypeTarget]); status.textContent = "تم تحميل صفحة SVG: الكلمات مخفية، وعلامات الآيات بقيت ظاهرة."; } catch (error) { status.textContent = `تعذر تحميل نموذج الكلمات: ${error.message}`; } }
  $("#openMemorizationWordPrototype").onclick = openPrototype;
  $("#memorizationPrototypeBack").onclick = () => { $("#memorizationWordPrototype").classList.add("hidden"); $("#memorizationSetup").classList.remove("hidden"); };
  $("#memorizationWordPrototype").onclick = (event) => { const action = event.target.dataset.memPrototype; if (!action || !prototypeLoaded) return; const host = $("#memorizationPrototypePage"), selected = targetWords(host, [prototypeTarget]); if (action === "reset") renderWords(host, [prototypeTarget]); if (action === "word") renderWords(host, [prototypeTarget], { revealCount: 1 }); if (action === "segment") renderWords(host, [prototypeTarget], { revealCount: 3 }); if (action === "ayah") renderWords(host, [prototypeTarget], { revealCount: selected.length }); if (action === "wrong") renderWords(host, [prototypeTarget], { revealCount: 2, wrongIndex: 1 }); };
})();
