const $ = (s) => document.querySelector(s),
  image = $("#quranImage"),
  preview = $("#previewImage"),
  page = $("#quranPage"),
  surface = $("#swipeArea"),
  layer = $("#ayahLayer"),
  nf = new Intl.NumberFormat("ar-EG"),
  STORE =
    "https://firebasestorage.googleapis.com/v0/b/ihfad-2fecd.firebasestorage.app/o/";
const N = [
  "",
  "الفاتحة",
  "البقرة",
  "آل عمران",
  "النساء",
  "المائدة",
  "الأنعام",
  "الأعراف",
  "الأنفال",
  "التوبة",
  "يونس",
  "هود",
  "يوسف",
  "الرعد",
  "إبراهيم",
  "الحجر",
  "النحل",
  "الإسراء",
  "الكهف",
  "مريم",
  "طه",
  "الأنبياء",
  "الحج",
  "المؤمنون",
  "النور",
  "الفرقان",
  "الشعراء",
  "النمل",
  "القصص",
  "العنكبوت",
  "الروم",
  "لقمان",
  "السجدة",
  "الأحزاب",
  "سبأ",
  "فاطر",
  "يس",
  "الصافات",
  "ص",
  "الزمر",
  "غافر",
  "فصلت",
  "الشورى",
  "الزخرف",
  "الدخان",
  "الجاثية",
  "الأحقاف",
  "محمد",
  "الفتح",
  "الحجرات",
  "ق",
  "الذاريات",
  "الطور",
  "النجم",
  "القمر",
  "الرحمن",
  "الواقعة",
  "الحديد",
  "المجادلة",
  "الحشر",
  "الممتحنة",
  "الصف",
  "الجمعة",
  "المنافقون",
  "التغابن",
  "الطلاق",
  "التحريم",
  "الملك",
  "القلم",
  "الحاقة",
  "المعارج",
  "نوح",
  "الجن",
  "المزمل",
  "المدثر",
  "القيامة",
  "الإنسان",
  "المرسلات",
  "النبأ",
  "النازعات",
  "عبس",
  "التكوير",
  "الانفطار",
  "المطففين",
  "الانشقاق",
  "البروج",
  "الطارق",
  "الأعلى",
  "الغاشية",
  "الفجر",
  "البلد",
  "الشمس",
  "الليل",
  "الضحى",
  "الشرح",
  "التين",
  "العلق",
  "القدر",
  "البينة",
  "الزلزلة",
  "العاديات",
  "القارعة",
  "التكاثر",
  "العصر",
  "الهمزة",
  "الفيل",
  "قريش",
  "الماعون",
  "الكوثر",
  "المسد",
  "الإخلاص",
  "الفلق",
  "الناس",
];
let p = 1,
  cal,
  active = "",
  selected = "",
  queue = [],
  qi = 0,
  gesture,
  quranText = "";
const debug =
  new URLSearchParams(location.search).get("debugCoordinates") === "true";
const quranTextReady = fetch("quran.txt")
  .then((r) => (r.ok ? r.text() : ""))
  .then((t) => (quranText = t))
  .catch(() => {});
const key = (v) => `${v.surahNumber}:${v.ayahNumber}`,
  imgUrl = (x) =>
    `${STORE}${encodeURIComponent(`quran-pages/page-${String(PAGE_MAP[x - 1].pdfPage).padStart(3, "0")}.jpg`)}?alt=media`,
  coordUrl = (x) =>
    `${STORE}${encodeURIComponent(`ayah-coordinates/${String(Number(x)).padStart(3, "0")}.json`)}?alt=media`,
  audioUrl = (k) => {
    let [s, a] = k.split(":");
    return `https://everyayah.com/data/${reciter}/${s.padStart(3, "0")}${a.padStart(3, "0")}.mp3`;
  };
function msg(t) {
  let x = $("#toast");
  x.textContent = t;
  x.classList.add("show");
  setTimeout(() => x.classList.remove("show"), 3000);
}
function info() {
  let [s] = PAGE_MAP[p - 1].verses[0][0].split(":");
  $("#surahLabel").textContent = `سورة ${N[s]}، صفحة ${nf.format(p)}`;
  $("#pageSelect").value = p;
}
function banner(t, b) {
  page.querySelector(".coordinate-debug-banner")?.remove();
  let d = document.createElement("div");
  d.className = "coordinate-debug-banner" + (b ? " coordinate-warning" : "");
  d.textContent = t;
  page.append(d);
}
function align() {
  const pageRect = page.getBoundingClientRect(),
    imageRect = image.getBoundingClientRect(),
    w = image.naturalWidth,
    h = image.naturalHeight;
  if (!w || !h) return;
  const z = Math.min(imageRect.width / w, imageRect.height / h),
    iw = w * z,
    ih = h * z,
    left = imageRect.left - pageRect.left + (imageRect.width - iw) / 2,
    top = imageRect.top - pageRect.top + (imageRect.height - ih) / 2;
  Object.assign(layer.style, {
    inset: "auto",
    left: `${left}px`,
    top: `${top}px`,
    right: "auto",
    bottom: "auto",
    width: `${iw}px`,
    height: `${ih}px`,
    transform: image.style.transform || "",
  });
  if (debug)
    console.info("[Quran Coordinates] bitmap / overlay rectangle", {
      imageBitmap: {
        left: imageRect.left + (imageRect.width - iw) / 2,
        top: imageRect.top + (imageRect.height - ih) / 2,
        width: iw,
        height: ih,
      },
      overlay: { left, top, width: iw, height: ih },
    });
}
const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
async function settleImageLayout() {
  await nextFrame();
  await nextFrame();
  align();
  if (selected) showActions();
}
async function data() {
  if (cal) return cal;
  let r = await fetch("ayah-coordinate-calibration.json?v=20260912-semantic-1");
  if (!r.ok) throw Error(`calibration HTTP ${r.status}`);
  cal = await r.json();
  console.info(
    "[Quran Coordinates] calibration file loaded: true; total calibrated pages loaded:",
    Object.keys(cal.pages || {}).length,
  );
  return cal;
}
function clear() {
  layer.replaceChildren();
  page.querySelector(".coordinate-debug-banner")?.remove();
  selected = "";
  $("#ayahSelection").hidden = true;
}
function valid(a, e) {
  let seen = new Set();
  return (
    Array.isArray(a) &&
    a.length &&
    e?.matrix?.flat().length === 6 &&
    a.every((x) => {
      let k = key(x),
        ok =
          /^\d+:\d+$/.test(k) &&
          !seen.has(k) &&
          typeof x.polygon === "string" &&
          x.polygon;
      seen.add(k);
      return ok;
    })
  );
}
function activePaint() {
  layer
    .querySelectorAll(".audio-active,.selected")
    .forEach((x) => x.classList.remove("audio-active", "selected"));
  if (selected)
    layer
      .querySelectorAll(`.ayah-region[data-key="${CSS.escape(selected)}"]`)
      .forEach((x) => x.classList.add("selected"));
  let xs = layer.querySelectorAll(
    `.ayah-region[data-key="${CSS.escape(active)}"]`,
  );
  if (active && !xs.length)
    console.warn(`[Quran coordinates] Missing ayah ${active} on page ${p}`);
  xs.forEach((x) => x.classList.add("audio-active"));
}
async function coords() {
  clear();
  align();
  const pageKey = String(Number(p));
  console.info("[Quran Coordinates] current page:", p, "lookup key:", pageKey);
  let c = await data(),
    e = c.pages?.[pageKey],
    why = c.excludedPages?.[pageKey] || c.failures?.[pageKey];
  console.info(
    "[Quran Coordinates] page entry found:",
    !!e,
    "coordinate source:",
    e ? "calibrated" : why ? "exceptional" : "missing",
  );
  if (!e) {
    console.warn(
      `[Quran Coordinates] Page ${p} unavailable: ${why || "no entry"}`,
    );
    banner(
      `بيانات الإحداثيات غير متاحة للصفحة ${nf.format(p)} — لا يوجد تقدير بديل.`,
      true,
    );
    return;
  }
  try {
    let r = await fetch(coordUrl(p));
    if (!r.ok) throw Error(`coordinate JSON HTTP ${r.status}: ${r.url}`);
    let a = await r.json();
    if (!valid(a, e)) throw Error("invalid coordinate data");
    layer.setAttribute("viewBox", `0 0 ${e.image.width} ${e.image.height}`);
    let g = document.createElementNS(layer.namespaceURI, "g"),
      m = e.matrix;
    g.setAttribute(
      "transform",
      `matrix(${m[0][0]} ${m[1][0]} ${m[0][1]} ${m[1][1]} ${m[0][2]} ${m[1][2]})`,
    );
    a.forEach((v) => {
      let x = document.createElementNS(layer.namespaceURI, "path");
      x.setAttribute("d", v.polygon);
      x.setAttribute("fill-rule", "evenodd");
      x.classList.add("ayah-region");
      x.dataset.key = key(v);
      x.tabIndex = 0;
      g.append(x);
      if (debug) {
        let t = document.createElementNS(layer.namespaceURI, "text");
        t.classList.add("coordinate-debug-label");
        t.setAttribute("x", v.x);
        t.setAttribute("y", v.y);
        t.textContent = key(v);
        g.append(t);
      }
    });
    layer.append(g);
    layer.classList.toggle("coordinate-debug", debug);
    if (debug)
      banner(
        `DEBUG · صفحة ${nf.format(p)} · RMSE ${e.validation.rmsePixels}px`,
      );
    activePaint();
  } catch (x) {
    console.error("[Quran Coordinates] coordinate load failed:", x);
    banner(
      `خطأ في إحداثيات الصفحة ${nf.format(p)} — لا يوجد تقدير بديل.`,
      true,
    );
  }
}
async function render() {
  active = "";
  info();
  clear();
  await new Promise((done) => {
    image.onload = async () => {
      await image.decode().catch(() => {});
      await settleImageLayout();
      done();
    };
    image.onerror = done;
    image.src = imgUrl(p);
  });
  await coords();
}
async function play(k) {
  active = k;
  let to = PAGE_MAP.findIndex((x) => x.verses.some((v) => v[0] === k)) + 1;
  console.info(
    "[Quran Coordinates] activeVerseKey:",
    k,
    "currentPage:",
    p,
    "expected page:",
    to,
  );
  if (to && to !== p) {
    p = to;
    await render();
    active = k;
  }
  activePaint();
  let paths = [
    ...layer.querySelectorAll(`.ayah-region[data-key="${CSS.escape(k)}"]`),
  ];
  console.info(
    "[Quran Coordinates] coordinateVerseKey:",
    k,
    "coordinatePage:",
    p,
    "numberOfRegions:",
    paths.length,
    "calibration transform:",
    cal?.pages?.[String(p)]?.matrix,
  );
  let [s, a] = k.split(":");
  $("#audioAyahLabel").textContent = `سورة ${N[s]} — الآية ${nf.format(a)}`;
  $("#audioPlayer").classList.remove("hidden");
  updateReadingViewport();
  let au = $("#quranAudio");
  au.src = audioUrl(k);
  au.play().catch(() => msg("تعذر تشغيل الصوت حالياً."));
}
function stop() {
  let a = $("#quranAudio");
  a.pause();
  a.removeAttribute("src");
  a.load();
  queue = [];
  active = "";
  activePaint();
  $("#audioPlayer").classList.add("hidden");
  updateReadingViewport();
}
function showActions() {
  const rs = [
    ...layer.querySelectorAll(
      `.ayah-region[data-key="${CSS.escape(selected)}"]`,
    ),
  ].map((x) => x.getBoundingClientRect());
  if (!rs.length) return;
  const pageRect = page.getBoundingClientRect(),
    left = Math.min(...rs.map((r) => r.left)),
    right = Math.max(...rs.map((r) => r.right)),
    top = Math.min(...rs.map((r) => r.top)),
    bottom = Math.max(...rs.map((r) => r.bottom)),
    menu = $("#ayahSelection");
  menu.hidden = false;
  const menuWidth = 132,
    menuHeight = 45,
    gap = 10;
  let x = Math.max(
      menuWidth / 2 + 8,
      Math.min(
        window.innerWidth - menuWidth / 2 - 8,
        (left + right) / 2,
      ),
    ),
    y = top - menuHeight - gap;
  if (y < 8)
    y = Math.min(
      window.innerHeight - menuHeight - 8,
      bottom + gap,
    );
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}
function selectAyah(k) {
  // The click may occur during a mobile browser toolbar/layout transition.
  // Align to the image's current bitmap rectangle before painting this ayah.
  align();
  selected = k;
  activePaint();
  showActions();
}
layer.onclick = (e) => {
  let x = e.target.closest(".ayah-region");
  if (x) selectAyah(x.dataset.key);
};
layer.onkeydown = (e) => {
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches(".ayah-region")
  ) {
    e.preventDefault();
    selectAyah(e.target.dataset.key);
  }
};
surface.addEventListener("click", (e) => {
  if (
    !e.target.closest(".ayah-region") &&
    !e.target.closest("#ayahSelection")
  ) {
    selected = "";
    activePaint();
    $("#ayahSelection").hidden = true;
  }
});
for (let i = 1; i <= 604; i++)
  $("#pageSelect").add(new Option(`الصفحة ${nf.format(i)}`, i));
$("#readButton").onclick = () => {
  $("#home").classList.add("hidden");
  $("#reader").classList.remove("hidden");
  updateReadingViewport();
  settleImageLayout().then(render);
};
$("#backButton").onclick = () => {
  $("#reader").classList.add("hidden");
  $("#home").classList.remove("hidden");
  stop();
};
$("#menuButton").onclick = () => {
  $("#sideMenu").classList.add("open");
  $("#overlay").classList.add("open");
};
$("#closeMenu").onclick = $("#overlay").onclick = () => {
  $("#sideMenu").classList.remove("open");
  $("#overlay").classList.remove("open");
};
$("#goToPage").onclick = () => {
  p = +$("#pageSelect").value;
  render();
};
$("#audioClose").onclick = stop;
$("#audioToggle").onclick = () => {
  let a = $("#quranAudio");
  a.paused ? a.play() : a.pause();
};
let au = $("#quranAudio");
au.onplay = () => ($("#audioToggle").textContent = "❚❚");
au.onpause = () => ($("#audioToggle").textContent = "▶");
au.onended = () => (queue[++qi] ? play(queue[qi]) : stop());
au.ontimeupdate = (e) =>
  ($("#audioProgress").style.width =
    `${(e.target.currentTime / e.target.duration) * 100 || 0}%`);
surface.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length === 1)
      gesture = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  },
  { passive: true },
);
surface.addEventListener(
  "touchmove",
  (e) => {
    if (!gesture) return;
    let d = e.touches[0].clientX - gesture.x,
      y = e.touches[0].clientY - gesture.y;
    if (Math.abs(d) < 12 || Math.abs(d) < Math.abs(y)) return;
    e.preventDefault();
    gesture.d = d;
    gesture.to = p + (d > 0 ? 1 : -1);
    if (gesture.to < 1 || gesture.to > 604) return;
    image.style.transform = layer.style.transform = `translateX(${d}px)`;
  },
  { passive: false },
);
surface.addEventListener(
  "touchend",
  () => {
    if (gesture?.to && Math.abs(gesture.d) > surface.clientWidth * 0.18) {
      p = gesture.to;
      image.style.transform = layer.style.transform = "";
      render();
    } else {
      image.style.transform = layer.style.transform = "";
    }
    gesture = null;
  },
  { passive: true },
);
function updateReadingViewport() {
  const player = $("#audioPlayer"),
    reader = $("#reader"),
    visible = !player.classList.contains("hidden"),
    r = player.getBoundingClientRect(),
    reserve = visible
      ? Math.max(
          0,
          Math.ceil(r.height + Math.max(0, window.innerHeight - r.bottom)),
        )
      : 0;
  reader.style.setProperty("--audio-reserved", `${reserve}px`);
  requestAnimationFrame(() => {
    align();
    if (selected) showActions();
  });
}
const layoutObserver = new ResizeObserver(() => updateReadingViewport());
layoutObserver.observe(page);
layoutObserver.observe(image);
layoutObserver.observe($("#audioPlayer"));
window.addEventListener("resize", updateReadingViewport);
window.addEventListener("orientationchange", updateReadingViewport);
window.visualViewport?.addEventListener("resize", updateReadingViewport);
window.visualViewport?.addEventListener("scroll", updateReadingViewport);
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("sw.js").catch(() => {});
const C = [
  0, 7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128,
  111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54,
  45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 45, 60, 49, 62, 55,
  78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20,
  56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 30, 19, 15, 21, 11, 8, 8,
  19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 9, 5, 4, 7, 6, 3, 5, 4, 5, 6,
];
function menu(which) {
  $("#mainMenu").classList.toggle("hidden", which !== "main");
  $("#jumpMenu").classList.toggle("hidden", which !== "jump");
  $("#listeningMenu").classList.toggle("hidden", which !== "listen");
  $("#reciterMenu").classList.toggle("hidden", which !== "reciter");
}
function populate(s) {
  let f = $("#fromAyah"),
    t = $("#toAyah");
  f.replaceChildren();
  for (let i = 1; i <= C[s]; i++) f.add(new Option(`الآية ${nf.format(i)}`, i));
  t.replaceChildren();
  for (let i = 1; i <= C[s]; i++) t.add(new Option(`الآية ${nf.format(i)}`, i));
}
for (let s = 1; s <= 114; s++)
  $("#surahSelect").add(new Option(`${nf.format(s)} — سورة ${N[s]}`, s));
populate(1);
$("#surahSelect").onchange = (e) => populate(+e.target.value);
$("#openJump").onclick = () => menu("jump");
$("#backFromJump").onclick = () => menu("main");
$("#openListening").onclick = () => menu("listen");
$("#backToMenu").onclick = () => menu("main");
$("#openReciter").onclick = () => { renderReciterSelector(); menu("reciter"); };
$("#backFromReciter").onclick = () => menu("main");
let mode = "full";
document.querySelectorAll("[data-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      mode = b.dataset.mode;
      document
        .querySelectorAll("[data-mode]")
        .forEach((x) => x.classList.toggle("active", x === b));
      $("#rangeFields").classList.toggle("hidden", mode === "full");
    }),
);
$("#playSelection").onclick = () => {
  let s = +$("#surahSelect").value,
    from = mode === "full" ? 1 : +$("#fromAyah").value,
    to = mode === "full" ? C[s] : +$("#toAyah").value;
  if (to < from) return msg("اختر نطاق آيات صحيح.");
  queue = Array.from({ length: to - from + 1 }, (_, i) => `${s}:${from + i}`);
  qi = 0;
  $("#sideMenu").classList.remove("open");
  $("#overlay").classList.remove("open");
  play(queue[0]);
};
const R = [
  ["Husary_Muallim_128kbps", "الحصري المعلّم"],
  ["Alafasy_128kbps", "مشاري العفاسي"],
  ["Abdurrahmaan_As-Sudais_192kbps", "عبد الرحمن السديس"],
  ["MaherAlMuaiqly128kbps", "ماهر المعيقلي"],
  ["Abdullah_Basfar_192kbps", "عبد الله بصفر"],
  ["Abu_Bakr_Ash-Shaatree_128kbps", "أبو بكر الشاطري"],
  ["Ahmed_ibn_Ali_al-Ajamy_128kbps", "أحمد العجمي"],
  ["Akram_AlAlaqimy_128kbps", "أكرم العلاقمي"],
  ["Ali_Hajjaj_AlSuesy_128kbps", "علي الحجاج السويسي"],
  ["Ayman_Sowaid_64kbps", "أيمن سويد"],
  ["Fares_Abbad_64kbps", "فارس عباد"],
  ["Ghamadi_40kbps", "سعد الغامدي"],
  ["Hani_Rifai_192kbps", "هاني الرفاعي"],
  ["Husary_128kbps", "محمود خليل الحصري"],
  ["Hudhaify_128kbps", "علي الحذيفي"],
  ["Ibrahim_Akhdar_32kbps", "إبراهيم الأخضر"],
  ["Khaalid_Abdullaah_al-Qahtaanee_192kbps", "خالد القحطاني"],
  ["Menshawi_16kbps", "محمد صديق المنشاوي"],
  ["Minshawy_Mujawwad_192kbps", "المنشاوي المجود"],
  ["Mohammad_al_Tablaway_128kbps", "محمد الطبلاوي"],
  ["Muhammad_Ayyoub_128kbps", "محمد أيوب"],
  ["Muhammad_Jibreel_128kbps", "محمد جبريل"],
  ["Muhammad_al_Muhaisny_64kbps", "محمد المحيسني"],
  ["Mustafa_Ismail_48kbps", "مصطفى إسماعيل"],
  ["Nabil_Rifai_48kbps", "نبيل الرفاعي"],
  ["Nasser_Alqatami_128kbps", "ناصر القطامي"],
  ["Parhizgar_48kbps", "شهريار پرهيزكار"],
  ["Salaah_AbdulRahman_Bukhatir_128kbps", "صلاح بو خاطر"],
  ["Saood_ash-Shuraym_128kbps", "سعود الشريم"],
  ["Yaser_Salamah_128kbps", "ياسر سلامة"],
  ["Yasser_Ad-Dussary_128kbps", "ياسر الدوسري"],
];
const RECITER_LIST_KEY = "quran.enabledReciters.v1";
const RECITER_CURRENT_KEY = "quran.currentReciter.v1";
const reciterName = (id) => R.find((entry) => entry[0] === id)?.[1] || "القارئ";
const savedList = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(RECITER_LIST_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
})();
let enabledReciters = savedList.filter((id) => R.some((entry) => entry[0] === id));
if (!enabledReciters.length) enabledReciters = R.slice(0, 4).map((entry) => entry[0]);
let reciter = (() => {
  try { return localStorage.getItem(RECITER_CURRENT_KEY); } catch { return null; }
})() || enabledReciters[0];
if (!enabledReciters.includes(reciter)) reciter = enabledReciters[0];
function persistReciters() {
  try {
    localStorage.setItem(RECITER_LIST_KEY, JSON.stringify(enabledReciters));
    localStorage.setItem(RECITER_CURRENT_KEY, reciter);
  } catch {}
}
function setCurrentReciter(id) {
  if (!enabledReciters.includes(id)) return;
  reciter = id;
  $("#audioTitle").textContent = reciterName(id);
  persistReciters();
}
function renderReciterSelector() {
  const select = $("#reciterSelect");
  select.replaceChildren(...enabledReciters.map((id) => new Option(reciterName(id), id)));
  select.value = reciter;
}
$("#reciterSelect").onchange = (event) => {
  setCurrentReciter(event.target.value);
  msg(`تم اختيار ${reciterName(reciter)}.`);
};
$("#audioTitle").textContent = reciterName(reciter);
function getVerseText(verseKey) {
  const verse = PAGE_MAP.flatMap((entry) => entry.verses).find((entry) => entry[0] === verseKey);
  return verse && quranText ? quranText.slice(verse[1], verse[2]).trim().replace(/\s*\(\d+\)\s*$/, "") : "";
}
window.QuranAppData = {
  surahNames: N,
  ayahCounts: C,
  reciters: R,
  getEnabledReciters: () => enabledReciters.map((id) => [id, reciterName(id)]),
  getVerseText,
  textReady: quranTextReady,
  audioUrlFor: (reciterId, verseKey) => {
    const [surah, ayah] = verseKey.split(":");
    return `https://everyayah.com/data/${reciterId}/${surah.padStart(3, "0")}${ayah.padStart(3, "0")}.mp3`;
  },
};
function dragStart(x, y) {
  gesture = { x, y, mouse: true };
}
function dragMove(x, y) {
  if (!gesture) return;
  let d = x - gesture.x,
    dy = y - gesture.y;
  if (Math.abs(d) < 12 || Math.abs(d) < Math.abs(dy)) return;
  gesture.d = d;
  gesture.to = p + (d > 0 ? 1 : -1);
  if (gesture.to < 1 || gesture.to > 604) return;
  image.style.transform = layer.style.transform = `translateX(${d}px)`;
}
function dragEnd() {
  if (gesture?.to && Math.abs(gesture.d) > surface.clientWidth * 0.18) {
    p = gesture.to;
    image.style.transform = layer.style.transform = "";
    render();
  } else {
    image.style.transform = layer.style.transform = "";
  }
  gesture = null;
}
surface.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button === 0)
    dragStart(e.clientX, e.clientY);
});
surface.addEventListener("pointermove", (e) => {
  if (gesture?.mouse) dragMove(e.clientX, e.clientY);
});
surface.addEventListener("pointerup", (e) => {
  if (gesture?.mouse) dragEnd();
});
surface.addEventListener("pointercancel", dragEnd);
$("#listenAyah").onclick = () => {
  if (selected) {
    queue = [selected];
    qi = 0;
    play(selected);
  }
};
$("#copyAyah").onclick = async () => {
  if (!selected) return;
  const verse = PAGE_MAP[p - 1].verses.find((v) => v[0] === selected),
    text = verse && quranText ? quranText.slice(verse[1], verse[2]).trim() : "";
  if (!text) return msg("نص الآية غير متاح حالياً.");
  try {
    await navigator.clipboard.writeText(text);
    const b = $("#copyAyah");
    b.textContent = "تم النسخ";
    setTimeout(() => (b.innerHTML = "⧉ <span>نسخ</span>"), 1200);
  } catch {
    msg("تعذر النسخ من هذا المتصفح.");
  }
};
