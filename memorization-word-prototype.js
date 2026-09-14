(() => {
  const $ = (selector) => document.querySelector(selector);
  const sourceUrl = "https://raw.githubusercontent.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG/main/SVG%20V1.01/053.svg";
  const target = { surah: "003", ayah: "023" };
  const debug = new URLSearchParams(location.search).get("debugMemorizationWords") === "true";
  let loaded = false;

  function words() {
    return [...$("#memorizationPrototypePage").querySelectorAll(`g[id^="md-word-"][data-surah="${target.surah}"][data-aya="${target.ayah}"][data-type="text"]`)];
  }
  function reset() {
    $("#memorizationPrototypePage").querySelectorAll('g[id^="md-word-"]').forEach((word) => word.classList.add("mem-word-hidden"));
    words().forEach((word) => word.classList.remove("mem-word-wrong", "mem-word-visible"));
    debugWords();
  }
  function reveal(count, wrongIndex = null) {
    reset();
    words().slice(0, count).forEach((word, index) => {
      word.classList.remove("mem-word-hidden");
      word.classList.add("mem-word-visible");
      if (index + 1 === wrongIndex) word.classList.add("mem-word-wrong");
    });
    debugWords();
  }
  function debugWords() {
    const svg = $("#memorizationPrototypePage svg");
    if (!svg) return;
    svg.querySelector("#memorizationWordDebug").remove();
    if (!debug) return;
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.id = "memorizationWordDebug";
    words().forEach((word) => {
      const box = word.getBBox();
      const wordIndex = word.dataset.wordIndexInAyah;
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", box.x); label.setAttribute("y", Math.max(8, box.y - 1));
      label.setAttribute("class", "mem-word-debug-label");
      label.textContent = `3:23:${wordIndex}`;
      const outline = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      outline.setAttribute("x", box.x); outline.setAttribute("y", box.y); outline.setAttribute("width", box.width); outline.setAttribute("height", box.height);
      outline.setAttribute("class", "mem-word-debug-bound");
      layer.append(outline, label);
      console.info("[Quran Memorization Words]", { page: 53, verseKey: "3:23", wordIndex: Number(wordIndex), geometry: { x: box.x, y: box.y, width: box.width, height: box.height }, state: word.classList.contains("mem-word-wrong") ? "wrong" : word.classList.contains("mem-word-hidden") ? "hidden" : "visible" });
    });
    svg.append(layer);
  }
  async function load() {
    if (loaded) return;
    const status = $("#memorizationPrototypeStatus"), host = $("#memorizationPrototypePage");
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const documentSvg = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
      const svg = documentSvg.documentElement;
      if (svg.nodeName.toLowerCase() !== "svg" || !svg.querySelector('g[id^="md-word-"][data-surah="003"][data-aya="023"]')) throw new Error("SVG word metadata unavailable");
      svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "صفحة 53 من مصحف SVG، سورة آل عمران");
      host.replaceChildren(document.importNode(svg, true)); loaded = true; reset();
      status.textContent = "تم تحميل صفحة SVG: الكلمات مخفية، وعلامات الآيات بقيت ظاهرة.";
    } catch (error) {
      status.textContent = `تعذر تحميل نموذج الكلمات: ${error.message}`;
    }
  }
  $("#openMemorizationWordPrototype").onclick = async () => {
    $("#memorizationSetup").classList.add("hidden"); $("#memorizationWordPrototype").classList.remove("hidden"); await load();
  };
  $("#memorizationPrototypeBack").onclick = () => { $("#memorizationWordPrototype").classList.add("hidden"); $("#memorizationSetup").classList.remove("hidden"); };
  $("#memorizationWordPrototype").onclick = (event) => {
    const action = event.target.dataset.memPrototype; if (!action || !loaded) return;
    if (action === "reset") reveal(0);
    if (action === "word") reveal(1);
    if (action === "segment") reveal(3);
    if (action === "ayah") reveal(words().length);
    if (action === "wrong") reveal(2, 2);
  };
})();
