(() => {
  const $ = (selector) => document.querySelector(selector);
  const app = window.QuranAppData;
  if (!app) return;
  const audio = $("#memorizationAudio"), storeKey = "quran.memorization.active.v1";
  const S = { SETUP:"SETUP", TEACHER_VISIBLE:"TEACHER_PLAYING_VISIBLE", WAIT_VISIBLE:"WAITING_VISIBLE_REPEAT", RECORD_VISIBLE:"RECORDING_VISIBLE", CHECK_VISIBLE:"CHECKING_VISIBLE", TEACHER_HIDDEN:"TEACHER_PLAYING_HIDDEN", WAIT_HIDDEN:"WAITING_HIDDEN_REPEAT", RECORD_HIDDEN:"RECORDING_HIDDEN", CHECK_HIDDEN:"CHECKING_HIDDEN", LINK_VISIBLE:"INTERNAL_LINK_VISIBLE", LINK_HIDDEN:"INTERNAL_LINK_HIDDEN", CROSS_VISIBLE:"CROSS_AYAH_LINK_VISIBLE", CROSS_HIDDEN:"CROSS_AYAH_LINK_HIDDEN", RELEARNING:"RELEARNING", COMPLETE:"COMPLETE" };
  let settings = { surah:1, from:1, to:7, reciter:"" }, state, recorder, stream, chunks=[], restoreOffered=false;
  const nf = new Intl.NumberFormat("ar-EG");
  const wordNormalize = (text) => text.normalize("NFD").replace(/[\u064B-\u065F\u0670\u06D6-\u06EDـ]/g, "").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/[^\u0621-\u064Aa-zA-Z\s]/g," ").replace(/\s+/g," ").trim();
  class QuranRecitationRecognizer {
    async check({ audioBlob, expectedText, context }) {
      // Static GitHub Pages has no ASR backend. A self-hosted adapter can POST
      // this exact payload to /api/recitation/check without changing the UI.
      return { available:false, correct:false, expectedWords:wordNormalize(expectedText).split(" "), context, audioBlob };
    }
    compareExpected(expectedText, recognizedText) {
      const expected=wordNormalize(expectedText).split(" ").filter(Boolean), actual=wordNormalize(recognizedText).split(" ").filter(Boolean);
      let i=0; while(i<expected.length&&expected[i]===actual[i]) i++;
      return { correct:i===expected.length&&actual.length===expected.length, mismatches:i<expected.length?[{expectedWordIndex:i,expected:expected[i],recognized:actual[i]||""}]:[] };
    }
  }
  const recognizer = new QuranRecitationRecognizer();
  const verseKey = (ayah) => `${settings.surah}:${ayah}`;
  function segment(text, ayah) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 4) return [{surah:settings.surah,ayah,segmentIndex:0,startWord:0,endWord:words.length-1,text,verseKey:verseKey(ayah),words}];
    const output=[]; let start=0, index=0;
    while (start < words.length) {
      let end=Math.min(words.length,start+3);
      if (words.length-end===1) end=words.length;
      const next=words[end] || "";
      if (/^(و|ف|ب|ك|ل)$/.test(next) && end < words.length-1) end++;
      output.push({surah:settings.surah,ayah,segmentIndex:index++,startWord:start,endWord:end-1,text:words.slice(start,end).join(" "),verseKey:verseKey(ayah),words:words.slice(start,end)});
      start=end;
    }
    return output;
  }
  function getUnits() { return Array.from({length:settings.to-settings.from+1},(_,i)=>{const ayah=settings.from+i,text=app.getVerseText(verseKey(ayah)); return {ayah,text,segments:segment(text,ayah)};}); }
  function currentAyah() { return state.units[state.ayahIndex]; }
  function currentUnit() { return currentAyah().segments[state.segmentIndex]; }
  function setFeedback(text, error=false) { const el=$("#memorizationFeedback"); el.textContent=text; el.classList.toggle("error",error); }
  function render() {
    if (!state) return;
    const phase=state.phase, unit=currentUnit(), hidden=/HIDDEN/.test(phase), linking=/LINK/.test(phase)||/CROSS/.test(phase);
    const visible=!hidden || phase===S.WAIT_VISIBLE || phase===S.RECORD_VISIBLE || phase===S.CHECK_VISIBLE;
    const text=linking ? linkText() : unit.text;
    const textEl=$("#memorizationText");
    textEl.classList.toggle("hidden-text",!visible && !state.errorWord);
    textEl.innerHTML=state.errorWord ? `<span class="error-word">${state.errorWord}</span>` : visible ? text : "";
    const total=state.units.length, completed=state.masteredAyahs.length, progress=Math.round((completed/total)*100);
    $("#memorizationProgressBar").style.width=`${progress}%`; $("#memorizationProgressLabel").textContent=`${nf.format(progress)}٪`;
    const isLink=linking, needed=isLink?3:5, count=isLink?state.link:visible?state.visible:state.hidden;
    $("#memorizationCounter").textContent=(phase===S.COMPLETE)?"":`${isLink?"مرحلة الربط":"التكرار"} ${nf.format(count)} من ${nf.format(needed)}`;
    const mic=$("#memorizationMic"), active=/WAIT/.test(phase); mic.disabled=!active; mic.classList.toggle("recording",/RECORD/.test(phase));
    $("#memorizationStop").classList.toggle("hidden",!/RECORD/.test(phase));
    $("#memorizationMicHint").textContent=/TEACHER/.test(phase)?"استمع إلى القارئ":/RECORD/.test(phase)?"جاري الاستماع...":/CHECK/.test(phase)?"جاري التحقق...":active?"اضغط هنا وردد مع القارئ":"";
  }
  function linkText(){ return state.phase.includes("CROSS") ? state.units.slice(0,state.ayahIndex+1).map(x=>x.text).join(" ") : currentAyah().segments.slice(0,state.segmentIndex+1).map(x=>x.text).join(" "); }
  function save(){ try { localStorage.setItem(storeKey,JSON.stringify({settings,state})); } catch {} }
  function resumeSavedSession() {
    try {
      const saved=JSON.parse(localStorage.getItem(storeKey)||"null");
      if (!saved?.state || saved.state.phase===S.COMPLETE || !confirm("لديك جلسة تحفيظ محفوظة. هل تريد استئنافها؟")) return false;
      settings=saved.settings; state=saved.state;
      $("#memorizationSetup").classList.add("hidden"); $("#memorizationSession").classList.remove("hidden");
      $("#memorizationSessionTitle").textContent=`سورة ${app.surahNames[settings.surah]}`;
      $("#memorizationSessionRange").textContent=`الآيات ${nf.format(settings.from)} — ${nf.format(settings.to)}`;
      stage("تم استئناف الجلسة — تابع من حيث توقفت"); return true;
    } catch { return false; }
  }
  function stage(label){ $("#memorizationStage").textContent=label; render(); save(); }
  function playTeacher(){ state.errorWord=""; const phase=state.phase;
    stage(phase===S.TEACHER_VISIBLE?"استمع إلى القارئ":phase===S.TEACHER_HIDDEN?"استمع غيباً":phase.includes("CROSS")?"ربط المحفوظ": "مرحلة الربط");
    const keys=phase.includes("CROSS")?state.units.slice(0,state.ayahIndex+1).map(x=>verseKey(x.ayah)):[verseKey(currentAyah().ayah)];
    let i=0; const next=()=>{ audio.src=app.audioUrlFor(settings.reciter,keys[i]); audio.onended=()=> ++i<keys.length?next():teacherDone(); audio.play().catch(()=>{setFeedback("تعذر تشغيل التلاوة حالياً.",true); teacherDone();}); }; next();
  }
  function teacherDone(){ if(state.phase===S.TEACHER_VISIBLE) state.phase=S.WAIT_VISIBLE; else if(state.phase===S.TEACHER_HIDDEN) state.phase=S.WAIT_HIDDEN; else if(state.phase===S.LINK_VISIBLE||state.phase===S.CROSS_VISIBLE) state.phase=S.WAIT_VISIBLE; else state.phase=S.WAIT_HIDDEN; stage(state.phase===S.WAIT_HIDDEN?"كررها خمس مرات غيباً":"اضغط هنا وردد مع القارئ"); }
  function startUnit(){ state.visible=0; state.hidden=0; state.link=0; state.failures=0; state.errorWord=""; state.phase=S.TEACHER_VISIBLE; playTeacher(); }
  function startLink(cross=false, hidden=false){ state.link=0; state.failures=0; state.errorWord=""; state.phase=cross?(hidden?S.CROSS_HIDDEN:S.CROSS_VISIBLE):(hidden?S.LINK_HIDDEN:S.LINK_VISIBLE); playTeacher(); }
  function afterUnit(){ const ayah=currentAyah(); if(state.segmentIndex===0 && ayah.segments.length>1){ state.segmentIndex=1; startUnit(); return; } if(state.segmentIndex<ayah.segments.length-1){ startLink(false,false); return; } completeAyah(); }
  function completeAyah(){ if(!state.masteredAyahs.includes(currentAyah().ayah)) state.masteredAyahs.push(currentAyah().ayah); state.segmentIndex=0;
    if(state.ayahIndex>=state.units.length-1){ finish(); return; } state.ayahIndex++; if(state.ayahIndex>0) startLink(true,false); else startUnit(); }
  function afterLink(){ const cross=state.phase.includes("CROSS"), hidden=state.phase.includes("HIDDEN"); if(!hidden){ startLink(cross,true); return; } if(cross) startUnit(); else { state.segmentIndex++; startUnit(); } }
  function correct(){ if(!/WAIT/.test(state.phase)) return; const hidden=state.phase===S.WAIT_HIDDEN, link=/LINK/.test(state.phase)||/CROSS/.test(state.phase), cross=state.phase.includes("CROSS"); state.errorWord=""; state.failures=0; if(link){ state.link++; if(state.link<3){ state.phase=cross?(hidden?S.CROSS_HIDDEN:S.CROSS_VISIBLE):(hidden?S.LINK_HIDDEN:S.LINK_VISIBLE); playTeacher(); } else afterLink(); } else if(hidden){ state.hidden++; if(state.hidden<5){ state.phase=S.TEACHER_HIDDEN; playTeacher(); } else afterUnit(); } else { state.visible++; if(state.visible<5){ state.phase=S.TEACHER_VISIBLE; playTeacher(); } else { state.phase=S.TEACHER_HIDDEN; playTeacher(); } } state.successes++; setFeedback("✓ أحسنت"); render(); save(); }
  function wrong(){ if(!/WAIT/.test(state.phase)) return; state.failures++; state.mistakes++; state.errorWord=currentUnit().words[Math.min(state.failures-1,currentUnit().words.length-1)]||""; if(state.failures>=3){ state.phase=S.RELEARNING; stage("جاري إعادة تحفيظ الآية"); setTimeout(startUnit,700); } else { setFeedback(`يوجد خطأ — تبقت ${nf.format(3-state.failures)} محاولة`,true); render(); save(); } }
  async function record(){ if(!/WAIT/.test(state.phase)) return; try { stream=await navigator.mediaDevices.getUserMedia({audio:true}); chunks=[]; recorder=new MediaRecorder(stream); recorder.ondataavailable=e=>chunks.push(e.data); recorder.onstop=async()=>{ stream?.getTracks().forEach(t=>t.stop()); state.phase=state.phase===S.WAIT_HIDDEN?S.CHECK_HIDDEN:S.CHECK_VISIBLE; stage("جاري التحقق..."); await recognizer.check({audioBlob:new Blob(chunks,{type:recorder.mimeType}),expectedText:currentUnit().text,context:currentUnit()}); setFeedback("لا توجد خدمة تحقق صوتي متصلة؛ استخدم أزرار الوضع التجريبي لإكمال الاختبار."); render(); }; recorder.start(); state.phase=state.phase===S.WAIT_HIDDEN?S.RECORD_HIDDEN:S.RECORD_VISIBLE; render(); } catch { setFeedback("تعذر الوصول إلى الميكروفون. يمكنك تفعيل الإذن أو استخدام الوضع التجريبي.",true); } }
  function stopRecord(){ if(recorder?.state==="recording") recorder.stop(); }
  function finish(){ state.phase=S.COMPLETE; localStorage.removeItem(storeKey); $("#memorizationStage").textContent="ما شاء الله — أتممت الحفظ بنجاح"; $("#memorizationCounter").textContent=`${nf.format(state.successes)} ترديد صحيح · ${nf.format(state.mistakes)} أخطاء صُححت`; $("#memorizationText").textContent=`سورة ${app.surahNames[settings.surah]} — الآيات ${nf.format(settings.from)} إلى ${nf.format(settings.to)}`; render(); }
  function populateAyahs(){ const count=app.ayahCounts[settings.surah]; for(const id of ["#memorizationFrom","#memorizationTo","#memorizationPreviewAyah"]){ const el=$(id), before=+el.value||1; el.replaceChildren(...Array.from({length:count},(_,i)=>new Option(`الآية ${nf.format(i+1)}`,i+1))); el.value=Math.min(before,count); } if(+$("#memorizationTo").value<+$("#memorizationFrom").value) $("#memorizationTo").value=$("#memorizationFrom").value; }
  function renderReciters(){ const root=$("#memorizationReciterCards"), list=app.getEnabledReciters(); if(!settings.reciter||!list.some(x=>x[0]===settings.reciter)) settings.reciter=list[0]?.[0]||""; root.replaceChildren(...list.map(([id,name])=>{ const card=document.createElement("label"), radio=document.createElement("input"), nameEl=document.createElement("span"), preview=document.createElement("button"); card.className=`memorization-reciter-card ${id===settings.reciter?"selected":""}`; radio.type="radio";radio.name="memorizationReciter";radio.value=id;radio.checked=id===settings.reciter;nameEl.textContent=name;preview.type="button";preview.dataset.preview=id;preview.textContent="استماع";card.append(radio,nameEl,preview);return card;})); validSetup(); }
  function validSetup(){ const ok=settings.reciter&&+$("#memorizationFrom").value<=+$("#memorizationTo").value; $("#startMemorization").disabled=!ok; $("#memorizationSetupMessage").textContent=ok?"":"تحقق من نطاق الآيات والقارئ."; }
  async function openSetup(){ $("#home").classList.add("hidden"); $("#memorizationSetup").classList.remove("hidden"); await app.textReady; if(!restoreOffered){restoreOffered=true;if(resumeSavedSession())return;} const surah=$("#memorizationSurah"); if(!surah.options.length) surah.replaceChildren(...app.surahNames.slice(1).map((name,i)=>new Option(`${nf.format(i+1)} — سورة ${name} (${nf.format(app.ayahCounts[i+1])})`,i+1))); surah.value=settings.surah; populateAyahs(); renderReciters(); }
  function start(){ settings.surah=+$("#memorizationSurah").value; settings.from=+$("#memorizationFrom").value; settings.to=+$("#memorizationTo").value; if(settings.from>settings.to||!settings.reciter)return validSetup(); state={units:getUnits(),ayahIndex:0,segmentIndex:0,visible:0,hidden:0,link:0,failures:0,successes:0,mistakes:0,masteredAyahs:[],phase:S.SETUP,errorWord:"",started:Date.now()}; $("#memorizationSetup").classList.add("hidden"); $("#memorizationSession").classList.remove("hidden"); $("#memorizationSessionTitle").textContent=`سورة ${app.surahNames[settings.surah]}`; $("#memorizationSessionRange").textContent=`الآيات ${nf.format(settings.from)} — ${nf.format(settings.to)}`; startUnit(); }
  $("#memorizeButton").onclick=openSetup; $("#memorizationSetupBack").onclick=()=>{$("#memorizationSetup").classList.add("hidden");$("#home").classList.remove("hidden")};
  $("#memorizationSurah").onchange=e=>{settings.surah=+e.target.value;populateAyahs();renderReciters()}; ["#memorizationFrom","#memorizationTo"].forEach(id=>$(id).onchange=validSetup);
  $("#memorizationReciterCards").onchange=e=>{if(e.target.name==="memorizationReciter"){settings.reciter=e.target.value;renderReciters()}};
  $("#memorizationReciterCards").onclick=e=>{const id=e.target.dataset.preview;if(!id)return;e.preventDefault();audio.src=app.audioUrlFor(id,`${settings.surah}:${$("#memorizationPreviewAyah").value}`);audio.play().catch(()=>$("#memorizationSetupMessage").textContent="تعذر تشغيل المعاينة حالياً.")};
  $("#startMemorization").onclick=start; $("#memorizationMic").onclick=record; $("#memorizationStop").onclick=stopRecord; $("#memorizationDemoCorrect").onclick=correct; $("#memorizationDemoError").onclick=wrong;
  $("#memorizationPause").onclick=()=>{audio.pause();stopRecord();save();$("#memorizationPause").textContent="تم الحفظ مؤقتاً"};
  $("#memorizationExit").onclick=()=>{if(confirm("هل تريد إنهاء الجلسة؟ سيبقى تقدمك محفوظاً.")){audio.pause();stopRecord();save();$("#memorizationSession").classList.add("hidden");$("#home").classList.remove("hidden")}};
})();
