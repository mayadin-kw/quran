(() => {
  const $ = (selector) => document.querySelector(selector);
  const app = window.QuranAppData;
  const wordsView = window.MemorizationSvgWords;
  if (!app || !wordsView) return;

  const audio = $("#memorizationAudio");
  const storeKey = "quran.memorization.active.v4", activeKey = "quran.memorization.session-active";
  const debug = new URLSearchParams(location.search).get("debugMemorization") === "true";
  const S = { SETUP:"SETUP", TEACHER_VISIBLE:"TEACHER_PLAYING_VISIBLE", WAIT_VISIBLE:"WAITING_VISIBLE_REPEAT", RECORD_VISIBLE:"RECORDING_VISIBLE", CHECK_VISIBLE:"CHECKING_VISIBLE", TEACHER_HIDDEN:"TEACHER_PLAYING_HIDDEN", WAIT_HIDDEN:"WAITING_HIDDEN_REPEAT", RECORD_HIDDEN:"RECORDING_HIDDEN", CHECK_HIDDEN:"CHECKING_HIDDEN", COMPLETE:"COMPLETE" };
  let settings = { surah: 1, from: 1, to: 7, reciter: "" };
  let state, recorder, stream, chunks = [], restoreOffered = false, audioContext, analyser, silenceTimer, speechStarted = false;
  const nf = new Intl.NumberFormat("ar-EG");
  const normalize = (text) => text.normalize("NFD").replace(/[\u064B-\u065F\u0670\u06D6-\u06EDـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/[^\u0621-\u064Aa-zA-Z\s]/g, " ").replace(/\s+/g, " ").trim();
  const verseKey = (ayah) => `${settings.surah}:${ayah}`;
  const wordRange = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
  // Supports both the current app data interface and the already-published
  // builds that expose PAGE_MAP but not QuranAppData.pageForVerse.
  function pageForVerse(key) {
    if (typeof app.pageForVerse === "function") return app.pageForVerse(key);
    if (typeof PAGE_MAP !== "undefined") return PAGE_MAP.find((entry) => entry.verses?.some(([verse]) => verse === key))?.page || null;
    return null;
  }

  function splitSegments(text, ayah) {
    const words = text.split(/\s+/).filter(Boolean), segments = [];
    if (words.length <= 4) return [{ ayah, verseKey: verseKey(ayah), segmentIndex: 0, startWord: 0, endWord: words.length - 1, text, words }];
    for (let start = 0, segmentIndex = 0; start < words.length; segmentIndex++) {
      let end = Math.min(words.length, start + 3);
      if (words.length - end === 1) end = words.length;
      if (/^(و|ف|ب|ك|ل)$/.test(words[end] || "") && end < words.length - 1) end++;
      segments.push({ ayah, verseKey: verseKey(ayah), segmentIndex, startWord: start, endWord: end - 1, text: words.slice(start, end).join(" "), words: words.slice(start, end) });
      start = end;
    }
    return segments;
  }
  function units() {
    return Array.from({ length: settings.to - settings.from + 1 }, (_, index) => {
      const ayah = settings.from + index, key = verseKey(ayah), text = app.getVerseText(key);
      if (!text) throw new Error(`Missing canonical text for ${key}`);
      const page = pageForVerse(key);
      if (!page) throw new Error(`Missing Mushaf page for ${key}`);
      return { ayah, verseKey: key, page, text, segments: splitSegments(text, ayah) };
    });
  }
  const ayah = () => state.units[state.ayahIndex];
  const unit = () => ayah().segments[state.segmentIndex];
  const hidden = () => !!state.hidden;
  const link = () => state.targetKind !== "unit";
  function targetText() {
    if (state.targetKind === "cross-link") return state.units.slice(0, state.ayahIndex + 1).map((item) => item.text).join(" ");
    if (state.targetKind === "internal-link") return ayah().segments.slice(0, state.segmentIndex + 1).map((item) => item.text).join(" ");
    return unit().text;
  }
  // Word metadata is always referenced by (surah, ayah, zero-based wordIndex).
  // A cross-page link displays its portion on the current page, then transitions
  // when the state advances to the next verse/page; it never shrinks two pages.
  function svgTargets() {
    const currentPage = state.currentPage;
    if (state.targetKind === "unit") return [{ surah: settings.surah, ayah: unit().ayah, wordIndexes: wordRange(unit().startWord, unit().endWord) }];
    if (state.targetKind === "internal-link") return [{ surah: settings.surah, ayah: ayah().ayah, wordIndexes: wordRange(0, unit().endWord) }];
    return state.units.slice(0, state.ayahIndex + 1).filter((item) => item.page === currentPage).map((item) => ({ surah: settings.surah, ayah: item.ayah }));
  }

  function setFeedback(text, error = false) { const feedback = $("#memorizationFeedback"); feedback.textContent = text; feedback.classList.toggle("error", error); }
  function renderRepetition() {
    const total = link() ? 3 : 5, current = link() ? state.link : hidden() ? state.hiddenCount : state.visibleCount;
    const title = link() ? "مرحلة الربط" : hidden() ? "مرحلة التسميع غيباً" : "مرحلة الترديد الظاهر";
    $("#memorizationCounter").textContent = `${title} — ${nf.format(current)} من ${nf.format(total)}`;
    $("#memorizationRemaining").textContent = current < total ? `باقي ${nf.format(total - current)} ${total - current === 1 ? "تكرار" : "تكرارات"}` : "أحسنت";
    const steps = $("#memorizationSteps"); steps.replaceChildren(...Array.from({ length: total }, (_, index) => { const step = document.createElement("i"); step.className = `memorization-step ${index < current ? "done" : index === current ? "current" : ""}`; step.textContent = index < current ? "✓" : "○"; return step; }));
  }
  function log(event) {
    if (!debug || !state) return;
    const detail = { event, currentVerseKey: state.currentVerseKey, currentSegment: state.currentSegment, currentPage: state.currentPage, audioVerseKey: state.currentAudioVerseKey, expectedText: state.expectedText, stage: state.phase, revealedWordCount: state.revealedWordCount, wrongWordIndex: state.wrongWordIndex };
    console.info("[Quran Memorization]", detail);
    let panel = $("#memorizationDebug");
    if (!panel) { panel = document.createElement("pre"); panel.id = "memorizationDebug"; panel.className = "memorization-debug"; $("#memorizationSession").append(panel); }
    panel.textContent = JSON.stringify(detail, null, 2);
  }
  function assertAudio() { if (state && state.targetKind !== "cross-link" && state.currentAudioVerseKey !== state.currentVerseKey) console.error("[Quran Memorization] stale audio", { currentVerseKey: state.currentVerseKey, currentAudioVerseKey: state.currentAudioVerseKey, src: audio.src }); }

  function setCurrentTarget({ ayahIndex = state.ayahIndex, segmentIndex = state.segmentIndex, targetKind = "unit", hidden: isHidden = false }) {
    state.ayahIndex = ayahIndex; state.segmentIndex = segmentIndex; state.targetKind = targetKind; state.hidden = isHidden;
    const current = unit();
    state.currentVerseKey = current.verseKey; state.currentSegment = current.segmentIndex; state.currentPage = ayah().page;
    state.expectedText = targetText(); state.expectedWords = normalize(state.expectedText).split(" ").filter(Boolean);
    state.revealedWordCount = 0; state.wrongWordIndex = null;
    if (targetKind !== "cross-link") { state.currentAudioVerseKey = state.currentVerseKey; audio.src = app.audioUrlFor(settings.reciter, state.currentVerseKey); }
    assertAudio(); log("setCurrentTarget");
  }
  function audioKeys() { return state.targetKind === "cross-link" ? state.units.slice(0, state.ayahIndex + 1).map((item) => item.verseKey) : [state.currentVerseKey]; }

  async function renderMushaf() {
    if (!state || state.phase === S.COMPLETE) return;
    const token = ++state.svgRenderToken, host = $("#memorizationMushaf"), status = $("#memorizationMushafStatus");
    status.textContent = `جارٍ تحميل صفحة المصحف ${nf.format(state.currentPage)}…`;
    try {
      await wordsView.loadPage(host, state.currentPage);
      if (token !== state.svgRenderToken) return;
      const targets = svgTargets();
      const selected = wordsView.targetWords(host, targets);
      if (!selected.length) throw new Error(`Missing SVG words for ${state.currentVerseKey}`);
      const visible = hidden() ? state.revealedWordCount : selected.length;
      wordsView.renderWords(host, targets, { revealCount: visible, wrongIndex: state.wrongWordIndex });
      status.textContent = `صفحة المصحف ${nf.format(state.currentPage)} — ${state.currentVerseKey}`;
    } catch (error) {
      status.textContent = `تعذر تحميل كلمات المصحف: ${error.message}`;
      console.error("[Quran Memorization] SVG rendering failed", { page: state.currentPage, verseKey: state.currentVerseKey, error });
    }
  }
  function render() {
    if (!state) return;
    const progress = Math.round((state.masteredAyahs.length / state.units.length) * 100);
    $("#memorizationProgressBar").style.width = `${progress}%`; $("#memorizationProgressLabel").textContent = `${nf.format(progress)}٪`;
    renderRepetition();
    const mic = $("#memorizationMic"), waiting = state.phase === S.WAIT_VISIBLE || state.phase === S.WAIT_HIDDEN;
    mic.disabled = !waiting; mic.classList.toggle("recording", /^RECORD/.test(state.phase)); $("#memorizationStop").classList.toggle("hidden", !/^RECORD/.test(state.phase));
    $("#memorizationMicHint").textContent = /^TEACHER/.test(state.phase) ? "استمع إلى القارئ" : /^RECORD/.test(state.phase) ? "جاري الاستماع..." : /^CHECK/.test(state.phase) ? "جاري التحقق..." : waiting ? "اضغط هنا وردد" : "";
    renderMushaf(); log("render");
  }
  function save() { try { localStorage.setItem(activeKey, "true"); localStorage.setItem(storeKey, JSON.stringify({ schema: 4, settings, state })); } catch {} }
  function clearSession() { try { localStorage.removeItem(activeKey); localStorage.removeItem(storeKey); } catch {} }
  function stage(label) { $("#memorizationStage").textContent = label; render(); save(); }

  function playTeacher() {
    state.wrongWordIndex = null; state.revealedWordCount = 0;
    stage(hidden() ? "استمع غيباً" : link() ? "ربط المحفوظ" : "استمع إلى القارئ");
    const keys = audioKeys(); let index = 0;
    const next = () => { state.currentAudioVerseKey = keys[index]; audio.src = app.audioUrlFor(settings.reciter, keys[index]); log("teacher-audio"); assertAudio(); audio.onended = () => ++index < keys.length ? next() : teacherDone(); audio.play().catch(() => { setFeedback("تعذر تشغيل التلاوة حالياً.", true); teacherDone(); }); };
    next();
  }
  function teacherDone() { state.phase = hidden() ? S.WAIT_HIDDEN : S.WAIT_VISIBLE; stage(hidden() ? `كررها ${link() ? "ثلاث" : "خمس"} مرات غيباً` : "اضغط هنا وردد مع القارئ"); }
  function startUnit() { state.sequenceState = "LEARNING_CURRENT_AYAH"; state.visibleCount = 0; state.hiddenCount = 0; state.link = 0; state.failures = 0; setCurrentTarget({ targetKind: "unit", hidden: false }); state.phase = S.TEACHER_VISIBLE; playTeacher(); }
  function startLink(kind, isHidden) { state.sequenceState = kind === "cross-link" ? "CROSS_AYAH_LINKING" : "INTERNAL_LINKING"; if (kind === "cross-link" && !state.currentAyahMastered) { console.error("Cross-ayah linking attempted before current ayah mastery"); return advanceToNextAyah(); } state.link = 0; state.failures = 0; setCurrentTarget({ targetKind: kind, hidden: isHidden }); state.phase = isHidden ? S.TEACHER_HIDDEN : S.TEACHER_VISIBLE; playTeacher(); }
  function afterUnit() { if (state.segmentIndex < ayah().segments.length - 1) { state.segmentIndex++; startLink("internal-link", false); } else completeAyah(); }
  function advanceToNextAyah() { state.sequenceState = "ADVANCING_TO_NEXT_AYAH"; if (state.ayahIndex >= state.units.length - 1) return finish(); state.ayahIndex++; state.segmentIndex = 0; state.currentAyahMastered = false; startUnit(); }
  function completeAyah() { state.currentAyahMastered = true; state.sequenceState = "CURRENT_AYAH_MASTERED"; if (!state.masteredAyahs.includes(ayah().ayah)) state.masteredAyahs.push(ayah().ayah); if (state.masteredAyahs.length === 1) return advanceToNextAyah(); startLink("cross-link", false); }
  function afterLink() { if (!hidden()) return startLink(state.targetKind, true); if (state.targetKind === "cross-link") return advanceToNextAyah(); state.segmentIndex++; startUnit(); }
  function correct() {
    if (state.phase !== S.WAIT_VISIBLE && state.phase !== S.WAIT_HIDDEN) return;
    const wasHidden = hidden(); state.wrongWordIndex = null; state.failures = 0; state.successes++;
    if (link()) state.link++; else if (wasHidden) state.hiddenCount++; else state.visibleCount++;
    state.phase = wasHidden ? S.CHECK_HIDDEN : S.CHECK_VISIBLE; setFeedback("✓ أحسنت"); render(); save();
    setTimeout(() => {
      if (link()) { if (state.link < 3) { if (wasHidden) { state.revealedWordCount = 0; state.phase = S.WAIT_HIDDEN; stage("أحسنت — أكمل من الذاكرة"); } else { state.phase = S.TEACHER_VISIBLE; playTeacher(); } } else afterLink(); }
      else if (wasHidden) { if (state.hiddenCount < 5) { state.revealedWordCount = 0; state.phase = S.WAIT_HIDDEN; stage("أحسنت — أكمل من الذاكرة"); } else afterUnit(); }
      else if (state.visibleCount < 5) { state.phase = S.TEACHER_VISIBLE; playTeacher(); }
      else { state.hiddenCount = 0; setCurrentTarget({ targetKind: "unit", hidden: true }); state.phase = S.TEACHER_HIDDEN; playTeacher(); }
    }, 560);
  }
  function wrong(expectedIndex = null) {
    if (state.phase !== S.WAIT_VISIBLE && state.phase !== S.WAIT_HIDDEN) return;
    state.failures++; state.mistakes++;
    const index = expectedIndex ?? Math.min(state.failures - 1, Math.max(0, state.expectedWords.length - 1));
    state.wrongWordIndex = index; state.revealedWordCount = Math.max(state.revealedWordCount, index);
    if (state.failures >= 3) { state.hidden = false; state.phase = S.SETUP; stage("جاري إعادة تحفيظ الجزء"); setTimeout(startUnit, 700); }
    else { setFeedback(`يوجد خطأ — تبقت ${nf.format(3 - state.failures)} محاولة`, true); render(); save(); }
  }
  // Adapter contract for a future real ASR service. It is intentionally word-based.
  function consumeRecognition(result) {
    const matched = result?.matchedWordIndexes || [];
    if (hidden() && matched.length) { state.revealedWordCount = Math.max(...matched.map(Number)) + 1; render(); }
    if (result?.mismatch && Number.isInteger(result.mismatch.expectedWordIndex)) return wrong(result.mismatch.expectedWordIndex);
    if (result?.complete || matched.length >= state.expectedWords.length) return correct();
    return false;
  }
  const Recognizer = window.QuranRecitationRecognizer || class { async check() { return { available: false, matchedWordIndexes: [] }; } };
  function stopVad() { clearTimeout(silenceTimer); silenceTimer = null; try { audioContext?.close(); } catch {} audioContext = null; analyser = null; speechStarted = false; }
  function beginVad() {
    if (!stream || !window.AudioContext) return;
    audioContext = new AudioContext(); analyser = audioContext.createAnalyser(); analyser.fftSize = 512;
    audioContext.createMediaStreamSource(stream).connect(analyser); const samples = new Uint8Array(analyser.fftSize);
    const poll = () => { if (recorder?.state !== "recording") return; analyser.getByteTimeDomainData(samples); const level = samples.reduce((total, value) => total + Math.abs(value - 128), 0) / samples.length; if (level > 5) { speechStarted = true; clearTimeout(silenceTimer); silenceTimer = null; } else if (speechStarted && !silenceTimer) silenceTimer = setTimeout(() => stopRecord(), 1450); requestAnimationFrame(poll); };
    requestAnimationFrame(poll);
  }
  async function record() {
    if (state.phase !== S.WAIT_VISIBLE && state.phase !== S.WAIT_HIDDEN) return;
    if (hidden()) { state.revealedWordCount = 0; state.wrongWordIndex = null; render(); }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true }); chunks = []; recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = async () => { stopVad(); stream?.getTracks().forEach((track) => track.stop()); state.phase = hidden() ? S.CHECK_HIDDEN : S.CHECK_VISIBLE; stage("جاري التحقق..."); const result = await new Recognizer().check({ audioBlob: new Blob(chunks, { type: recorder.mimeType }), expectedText: state.expectedText, context: state }); if (!consumeRecognition(result)) { setFeedback(result?.available === false ? "خدمة التحقق الصوتي غير مفعلة بعد." : "تعذر التحقق من هذه التلاوة. حاول مرة أخرى.", !result?.available); render(); } };
      recorder.start(); beginVad(); state.phase = hidden() ? S.RECORD_HIDDEN : S.RECORD_VISIBLE; render();
    } catch { setFeedback("يلزم السماح باستخدام الميكروفون حتى يتم التحقق من التلاوة", true); }
  }
  function stopRecord() { if (recorder?.state === "recording") recorder.stop(); }
  function demoCorrect() { if (hidden()) { state.revealedWordCount = state.expectedWords.length; render(); } correct(); }
  function finish() { state.phase = S.COMPLETE; clearSession(); $("#memorizationStage").textContent = "ما شاء الله — أتممت الحفظ بنجاح"; $("#memorizationMushafStatus").textContent = "اكتملت جلسة التحفيظ."; render(); }

  function populateAyahs() { const count = app.ayahCounts[settings.surah]; for (const id of ["#memorizationFrom", "#memorizationTo", "#memorizationPreviewAyah"]) { const element = $(id), before = +element.value || 1; element.replaceChildren(...Array.from({ length: count }, (_, index) => new Option(`الآية ${nf.format(index + 1)}`, index + 1))); element.value = Math.min(before, count); } if (+$("#memorizationTo").value < +$("#memorizationFrom").value) $("#memorizationTo").value = $("#memorizationFrom").value; }
  function validSetup() { const ok = settings.reciter && +$("#memorizationFrom").value <= +$("#memorizationTo").value; $("#startMemorization").disabled = !ok; $("#memorizationSetupMessage").textContent = ok ? "" : "تحقق من نطاق الآيات والقارئ."; }
  function renderReciters() { const root = $("#memorizationReciterCards"), list = app.getEnabledReciters(); if (!settings.reciter || !list.some(([id]) => id === settings.reciter)) settings.reciter = list[0]?.[0] || ""; root.replaceChildren(...list.map(([id, name]) => { const card = document.createElement("label"), radio = document.createElement("input"), nameElement = document.createElement("span"), preview = document.createElement("button"); card.className = `memorization-reciter-card ${id === settings.reciter ? "selected" : ""}`; radio.type = "radio"; radio.name = "memorizationReciter"; radio.value = id; radio.checked = id === settings.reciter; nameElement.textContent = name; preview.type = "button"; preview.dataset.preview = id; preview.textContent = "استماع"; card.append(radio, nameElement, preview); return card; })); validSetup(); }
  function resume() { try { const saved = JSON.parse(localStorage.getItem(storeKey) || "null"); if (localStorage.getItem(activeKey) !== "true" || saved?.schema !== 4 || !saved.state || saved.state.phase === S.COMPLETE) return false; settings = saved.settings; state = saved.state; state.svgRenderToken = 0; state.currentAyahMastered = !!state.currentAyahMastered; $("#home").classList.add("hidden"); $("#memorizationSetup").classList.add("hidden"); $("#memorizationSession").classList.remove("hidden"); $("#memorizationSessionTitle").textContent = `سورة ${app.surahNames[settings.surah]}`; $("#memorizationSessionRange").textContent = `الآيات ${nf.format(settings.from)} — ${nf.format(settings.to)}`; stage("تم استئناف الجلسة — تابع من حيث توقفت"); return true; } catch { return false; } }
  async function openSetup() { $("#home").classList.add("hidden"); $("#memorizationSetup").classList.remove("hidden"); await app.textReady; if (!restoreOffered) { restoreOffered = true; if (resume()) return; } const select = $("#memorizationSurah"); if (!select.options.length) select.replaceChildren(...app.surahNames.slice(1).map((name, index) => new Option(`${nf.format(index + 1)} — سورة ${name} (${nf.format(app.ayahCounts[index + 1])})`, index + 1))); select.value = settings.surah; populateAyahs(); renderReciters(); }
  function start() { settings.surah = +$("#memorizationSurah").value; settings.from = +$("#memorizationFrom").value; settings.to = +$("#memorizationTo").value; if (settings.from > settings.to || !settings.reciter) return validSetup(); try { state = { units: units(), ayahIndex: 0, segmentIndex: 0, targetKind: "unit", hidden: false, visibleCount: 0, hiddenCount: 0, link: 0, failures: 0, successes: 0, mistakes: 0, masteredAyahs: [], phase: S.SETUP, sequenceState: "LEARNING_CURRENT_AYAH", currentAyahMastered: false, started: Date.now(), currentVerseKey: "", currentAudioVerseKey: "", currentPage: null, currentSegment: 0, expectedText: "", expectedWords: [], revealedWordCount: 0, wrongWordIndex: null, svgRenderToken: 0 }; } catch (error) { $("#memorizationSetupMessage").textContent = `تعذر تجهيز الآية: ${error.message}`; return; } $("#memorizationSetup").classList.add("hidden"); $("#memorizationSession").classList.remove("hidden"); $("#memorizationSessionTitle").textContent = `سورة ${app.surahNames[settings.surah]}`; $("#memorizationSessionRange").textContent = `الآيات ${nf.format(settings.from)} — ${nf.format(settings.to)}`; startUnit(); }

  $("#memorizeButton").onclick = openSetup;
  $("#memorizationSetupBack").onclick = () => { $("#memorizationSetup").classList.add("hidden"); $("#home").classList.remove("hidden"); };
  $("#memorizationSurah").onchange = (event) => { settings.surah = +event.target.value; populateAyahs(); renderReciters(); };
  ["#memorizationFrom", "#memorizationTo"].forEach((id) => $(id).onchange = validSetup);
  $("#memorizationReciterCards").onchange = (event) => { if (event.target.name === "memorizationReciter") { settings.reciter = event.target.value; renderReciters(); } };
  $("#memorizationReciterCards").onclick = (event) => { const id = event.target.dataset.preview; if (!id) return; event.preventDefault(); audio.src = app.audioUrlFor(id, `${settings.surah}:${$("#memorizationPreviewAyah").value}`); audio.play().catch(() => $("#memorizationSetupMessage").textContent = "تعذر تشغيل المعاينة حالياً."); };
  if (debug) $("#memorizationSession").classList.add("debug");
  $("#startMemorization").onclick = start; $("#memorizationMic").onclick = record; $("#memorizationStop").onclick = stopRecord; $("#memorizationDemoCorrect").onclick = demoCorrect; $("#memorizationDemoError").onclick = () => wrong();
  $("#memorizationPause").onclick = () => { audio.pause(); stopRecord(); save(); $("#memorizationPause").textContent = "تم الحفظ مؤقتاً"; };
  $("#memorizationExit").onclick = () => $("#memorizationExitDialog").classList.remove("hidden");
  $("#memorizationExitCancel").onclick = () => $("#memorizationExitDialog").classList.add("hidden");
  $("#memorizationExitConfirm").onclick = () => { audio.pause(); stopRecord(); clearSession(); $("#memorizationExitDialog").classList.add("hidden"); $("#memorizationSession").classList.add("hidden"); $("#home").classList.remove("hidden"); };
  // Refreshing an active session returns directly to it; the learner must
  // explicitly choose "إنهاء الجلسة" to clear this saved state.
  Promise.resolve(app.textReady).then(() => { if (!restoreOffered) { restoreOffered = true; resume(); } });
})();
