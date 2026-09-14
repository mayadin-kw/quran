(() => {
  const $ = (s) => document.querySelector(s), app = window.QuranAppData;
  if (!app) return;
  const audio = $("#memorizationAudio"), storeKey = "quran.memorization.active.v2";
  const debug = new URLSearchParams(location.search).get("debugMemorization") === "true";
  const S = { SETUP:"SETUP", TEACHER_VISIBLE:"TEACHER_PLAYING_VISIBLE", WAIT_VISIBLE:"WAITING_VISIBLE_REPEAT", RECORD_VISIBLE:"RECORDING_VISIBLE", CHECK_VISIBLE:"CHECKING_VISIBLE", TEACHER_HIDDEN:"TEACHER_PLAYING_HIDDEN", WAIT_HIDDEN:"WAITING_HIDDEN_REPEAT", RECORD_HIDDEN:"RECORDING_HIDDEN", CHECK_HIDDEN:"CHECKING_HIDDEN", COMPLETE:"COMPLETE" };
  let settings = { surah:1, from:1, to:7, reciter:"" }, state, recorder, stream, chunks = [], restoreOffered = false;
  const nf = new Intl.NumberFormat("ar-EG");
  const normalize = (t) => t.normalize("NFD").replace(/[\u064B-\u065F\u0670\u06D6-\u06EDـ]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/[^\u0621-\u064Aa-zA-Z\s]/g," ").replace(/\s+/g," ").trim();
  const verseKey = (ayah) => `${settings.surah}:${ayah}`;
  const wordRange = (from, to) => Array.from({length:Math.max(0,to-from+1)},(_,i)=>from+i);
  function splitSegments(text, ayah) {
    const words = text.split(/\s+/).filter(Boolean), output = [];
    if (words.length <= 4) return [{ayah, verseKey:verseKey(ayah), segmentIndex:0, startWord:0, endWord:words.length-1, text, words}];
    for (let start=0,index=0; start<words.length; index++) {
      let end=Math.min(words.length,start+3); if(words.length-end===1)end=words.length;
      if(/^(و|ف|ب|ك|ل)$/.test(words[end]||"")&&end<words.length-1)end++;
      output.push({ayah,verseKey:verseKey(ayah),segmentIndex:index,startWord:start,endWord:end-1,text:words.slice(start,end).join(" "),words:words.slice(start,end)}); start=end;
    }
    return output;
  }
  function units() { return Array.from({length:settings.to-settings.from+1},(_,i)=>{ const ayah=settings.from+i,key=verseKey(ayah),text=app.getVerseText(key); if(!text)throw new Error(`Missing canonical text for ${key}`); return {ayah,verseKey:key,page:app.pageForVerse(key),text,segments:splitSegments(text,ayah)}; }); }
  function ayah() { return state.units[state.ayahIndex]; }
  function unit() { return ayah().segments[state.segmentIndex]; }
  function targetText() { if(state.targetKind==="cross-link")return state.units.slice(0,state.ayahIndex+1).map(x=>x.text).join(" "); if(state.targetKind==="internal-link")return ayah().segments.slice(0,state.segmentIndex+1).map(x=>x.text).join(" "); return unit().text; }
  function targetWordIndexes() { return state.targetKind==="unit" ? wordRange(unit().startWord,unit().endWord) : normalize(targetText()).split(" ").map((_,i)=>i); }
  function setFeedback(text,error=false) { const el=$("#memorizationFeedback");el.textContent=text;el.classList.toggle("error",error); }
  function log(event) {
    if(!debug||!state)return;
    const detail={event,currentVerseKey:state.currentVerseKey,currentSegment:state.currentSegment,currentPage:state.currentPage,audioVerseKey:state.currentAudioVerseKey,expectedText:state.expectedText,stage:state.phase,visibleWordIndexes:state.visibleWordIndexes};
    console.info("[Quran Memorization]",detail);
    let panel=$("#memorizationDebug"); if(!panel){panel=document.createElement("pre");panel.id="memorizationDebug";panel.className="memorization-debug";$("#memorizationSession").append(panel);} panel.textContent=JSON.stringify(detail,null,2);
  }
  function assertAudio() { if(state&&state.targetKind!=="cross-link"&&state.currentAudioVerseKey!==state.currentVerseKey) console.error("[Quran Memorization] stale audio",{currentVerseKey:state.currentVerseKey,currentAudioVerseKey:state.currentAudioVerseKey,src:audio.src}); }
  // All target changes pass through this function. No state may advance text
  // without also setting the canonical verse, page, recognition text and audio.
  function setCurrentTarget({ayahIndex=state.ayahIndex,segmentIndex=state.segmentIndex,targetKind="unit",hidden=false}) {
    state.ayahIndex=ayahIndex;state.segmentIndex=segmentIndex;state.targetKind=targetKind;state.hidden=hidden;
    const current=unit(); state.currentVerseKey=current.verseKey;state.currentSegment=current.segmentIndex;state.currentPage=ayah().page;state.expectedText=targetText();state.expectedWords=normalize(state.expectedText).split(" ").filter(Boolean);state.visibleWordIndexes=hidden?[]:targetWordIndexes();
    if(targetKind!=="cross-link"){state.currentAudioVerseKey=state.currentVerseKey;audio.src=app.audioUrlFor(settings.reciter,state.currentVerseKey);}
    assertAudio();log("setCurrentTarget");
  }
  function hidden() { return !!state.hidden; }
  function link() { return state.targetKind!=="unit"; }
  function audioKeys() { return state.targetKind==="cross-link" ? state.units.slice(0,state.ayahIndex+1).map(x=>x.verseKey) : [state.currentVerseKey]; }
  function render() {
    if(!state)return;
    const show=!hidden()||state.errorWord,text=state.errorWord||(show?state.expectedText:"");
    const textEl=$("#memorizationText");textEl.classList.toggle("hidden-text",!show);textEl.classList.toggle("error-word",!!state.errorWord);textEl.textContent=text;
    const progress=Math.round((state.masteredAyahs.length/state.units.length)*100);$("#memorizationProgressBar").style.width=`${progress}%`;$("#memorizationProgressLabel").textContent=`${nf.format(progress)}٪`;
    const needed=link()?3:5,count=link()?state.link:hidden()?state.hiddenCount:state.visibleCount;$("#memorizationCounter").textContent=state.phase===S.COMPLETE?"":`${link()?"مرحلة الربط":"التكرار"} ${nf.format(count)} من ${nf.format(needed)}`;
    const mic=$("#memorizationMic"),waiting=state.phase===S.WAIT_VISIBLE||state.phase===S.WAIT_HIDDEN;mic.disabled=!waiting;mic.classList.toggle("recording",/^RECORD/.test(state.phase));$("#memorizationStop").classList.toggle("hidden",!/^RECORD/.test(state.phase));$("#memorizationMicHint").textContent=/^TEACHER/.test(state.phase)?"استمع إلى القارئ":/^RECORD/.test(state.phase)?"جاري الاستماع...":/^CHECK/.test(state.phase)?"جاري التحقق...":waiting?"اضغط هنا وردد":"";log("render");
  }
  function save(){try{localStorage.setItem(storeKey,JSON.stringify({schema:2,settings,state}));}catch{}}
  function stage(label){$("#memorizationStage").textContent=label;render();save();}
  function playTeacher(){ state.errorWord="";stage(hidden()?"استمع غيباً":link()?"ربط المحفوظ":"استمع إلى القارئ");const keys=audioKeys();let i=0;const next=()=>{state.currentAudioVerseKey=keys[i];audio.src=app.audioUrlFor(settings.reciter,keys[i]);log("teacher-audio");assertAudio();audio.onended=()=>++i<keys.length?next():teacherDone();audio.play().catch(()=>{setFeedback("تعذر تشغيل التلاوة حالياً.",true);teacherDone();});};next(); }
  function teacherDone(){state.phase=hidden()?S.WAIT_HIDDEN:S.WAIT_VISIBLE;stage(hidden()?`كررها ${link()?"ثلاث":"خمس"} مرات غيباً`:"اضغط هنا وردد مع القارئ");}
  function startUnit(){state.visibleCount=0;state.hiddenCount=0;state.link=0;state.failures=0;state.errorWord="";setCurrentTarget({targetKind:"unit",hidden:false});state.phase=S.TEACHER_VISIBLE;playTeacher();}
  function startLink(kind,isHidden){state.link=0;state.failures=0;state.errorWord="";setCurrentTarget({targetKind:kind,hidden:isHidden});state.phase=isHidden?S.TEACHER_HIDDEN:S.TEACHER_VISIBLE;playTeacher();}
  function afterUnit(){if(state.segmentIndex<ayah().segments.length-1){state.segmentIndex++;startLink("internal-link",false);}else completeAyah();}
  function completeAyah(){if(!state.masteredAyahs.includes(ayah().ayah))state.masteredAyahs.push(ayah().ayah);if(state.ayahIndex>=state.units.length-1)return finish();state.ayahIndex++;state.segmentIndex=0;startLink("cross-link",false);}
  function afterLink(){if(!hidden())return startLink(state.targetKind,true);if(state.targetKind==="cross-link")return startUnit();state.segmentIndex++;startUnit();}
  function correct(){
    if(state.phase!==S.WAIT_VISIBLE&&state.phase!==S.WAIT_HIDDEN)return;
    const wasHidden=hidden();state.errorWord="";state.failures=0;state.successes++;
    if(link()){state.link++;if(state.link<3){if(wasHidden){state.phase=S.WAIT_HIDDEN;stage("أحسنت — أكمل من الذاكرة");}else{state.phase=S.TEACHER_VISIBLE;playTeacher();}}else afterLink();}
    else if(wasHidden){state.hiddenCount++;if(state.hiddenCount<5){state.phase=S.WAIT_HIDDEN;stage("أحسنت — أكمل من الذاكرة");}else afterUnit();}
    else{state.visibleCount++;if(state.visibleCount<5){state.phase=S.TEACHER_VISIBLE;playTeacher();}else{state.hiddenCount=0;setCurrentTarget({targetKind:"unit",hidden:true});state.phase=S.TEACHER_HIDDEN;playTeacher();}}
    setFeedback("✓ أحسنت");render();save();
  }
  function wrong(){if(state.phase!==S.WAIT_VISIBLE&&state.phase!==S.WAIT_HIDDEN)return;state.failures++;state.mistakes++;state.errorWord=state.expectedWords[Math.min(state.failures-1,state.expectedWords.length-1)]||"";if(state.failures>=3){state.hidden=false;state.phase=S.SETUP;stage("جاري إعادة تحفيظ الجزء");setTimeout(startUnit,700);}else{setFeedback(`يوجد خطأ — تبقت ${nf.format(3-state.failures)} محاولة`,true);render();save();}}
  async function record(){if(state.phase!==S.WAIT_VISIBLE&&state.phase!==S.WAIT_HIDDEN)return;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>{stream?.getTracks().forEach(t=>t.stop());state.phase=hidden()?S.CHECK_HIDDEN:S.CHECK_VISIBLE;stage("جاري التحقق...");await new QuranRecitationRecognizer().check({audioBlob:new Blob(chunks,{type:recorder.mimeType}),expectedText:state.expectedText,context:state});setFeedback("لا توجد خدمة تحقق صوتي متصلة؛ استخدم أزرار الوضع التجريبي لإكمال الاختبار.");render();};recorder.start();state.phase=hidden()?S.RECORD_HIDDEN:S.RECORD_VISIBLE;render();}catch{setFeedback("تعذر الوصول إلى الميكروفون. يمكنك تفعيل الإذن أو استخدام الوضع التجريبي.",true);}}
  function stopRecord(){if(recorder?.state==="recording")recorder.stop();}
  function finish(){state.phase=S.COMPLETE;localStorage.removeItem(storeKey);$("#memorizationStage").textContent="ما شاء الله — أتممت الحفظ بنجاح";$("#memorizationCounter").textContent=`${nf.format(state.successes)} ترديد صحيح · ${nf.format(state.mistakes)} أخطاء صُححت`;$("#memorizationText").textContent=`سورة ${app.surahNames[settings.surah]} — الآيات ${nf.format(settings.from)} إلى ${nf.format(settings.to)}`;render();}
  function populateAyahs(){const count=app.ayahCounts[settings.surah];for(const id of ["#memorizationFrom","#memorizationTo","#memorizationPreviewAyah"]){const el=$(id),before=+el.value||1;el.replaceChildren(...Array.from({length:count},(_,i)=>new Option(`الآية ${nf.format(i+1)}`,i+1)));el.value=Math.min(before,count);}if(+$("#memorizationTo").value<+$("#memorizationFrom").value)$("#memorizationTo").value=$("#memorizationFrom").value;}
  function renderReciters(){const root=$("#memorizationReciterCards"),list=app.getEnabledReciters();if(!settings.reciter||!list.some(x=>x[0]===settings.reciter))settings.reciter=list[0]?.[0]||"";root.replaceChildren(...list.map(([id,name])=>{const card=document.createElement("label"),radio=document.createElement("input"),nameEl=document.createElement("span"),preview=document.createElement("button");card.className=`memorization-reciter-card ${id===settings.reciter?"selected":""}`;radio.type="radio";radio.name="memorizationReciter";radio.value=id;radio.checked=id===settings.reciter;nameEl.textContent=name;preview.type="button";preview.dataset.preview=id;preview.textContent="استماع";card.append(radio,nameEl,preview);return card;}));validSetup();}
  function validSetup(){const ok=settings.reciter&&+$("#memorizationFrom").value<=+$("#memorizationTo").value;$("#startMemorization").disabled=!ok;$("#memorizationSetupMessage").textContent=ok?"":"تحقق من نطاق الآيات والقارئ.";}
  function resume(){try{const saved=JSON.parse(localStorage.getItem(storeKey)||"null");if(saved?.schema!==2||!saved.state||saved.state.phase===S.COMPLETE||!confirm("لديك جلسة تحفيظ محفوظة. هل تريد استئنافها؟"))return false;settings=saved.settings;state=saved.state;$("#memorizationSetup").classList.add("hidden");$("#memorizationSession").classList.remove("hidden");$("#memorizationSessionTitle").textContent=`سورة ${app.surahNames[settings.surah]}`;$("#memorizationSessionRange").textContent=`الآيات ${nf.format(settings.from)} — ${nf.format(settings.to)}`;stage("تم استئناف الجلسة — تابع من حيث توقفت");return true;}catch{return false;}}
  async function openSetup(){ $("#home").classList.add("hidden");$("#memorizationSetup").classList.remove("hidden");await app.textReady;if(!restoreOffered){restoreOffered=true;if(resume())return;}const select=$("#memorizationSurah");if(!select.options.length)select.replaceChildren(...app.surahNames.slice(1).map((name,i)=>new Option(`${nf.format(i+1)} — سورة ${name} (${nf.format(app.ayahCounts[i+1])})`,i+1)));select.value=settings.surah;populateAyahs();renderReciters(); }
  function start(){settings.surah=+$("#memorizationSurah").value;settings.from=+$("#memorizationFrom").value;settings.to=+$("#memorizationTo").value;if(settings.from>settings.to||!settings.reciter)return validSetup();try{state={units:units(),ayahIndex:0,segmentIndex:0,targetKind:"unit",hidden:false,visibleCount:0,hiddenCount:0,link:0,failures:0,successes:0,mistakes:0,masteredAyahs:[],phase:S.SETUP,errorWord:"",started:Date.now(),currentVerseKey:"",currentAudioVerseKey:"",currentPage:null,currentSegment:0,expectedText:"",expectedWords:[],visibleWordIndexes:[]};}catch(error){$("#memorizationSetupMessage").textContent=`تعذر تجهيز الآية: ${error.message}`;return;}$("#memorizationSetup").classList.add("hidden");$("#memorizationSession").classList.remove("hidden");$("#memorizationSessionTitle").textContent=`سورة ${app.surahNames[settings.surah]}`;$("#memorizationSessionRange").textContent=`الآيات ${nf.format(settings.from)} — ${nf.format(settings.to)}`;startUnit();}
  $("#memorizeButton").onclick=openSetup;$("#memorizationSetupBack").onclick=()=>{$("#memorizationSetup").classList.add("hidden");$("#home").classList.remove("hidden")};$("#memorizationSurah").onchange=e=>{settings.surah=+e.target.value;populateAyahs();renderReciters()};["#memorizationFrom","#memorizationTo"].forEach(id=>$(id).onchange=validSetup);$("#memorizationReciterCards").onchange=e=>{if(e.target.name==="memorizationReciter"){settings.reciter=e.target.value;renderReciters()}};$("#memorizationReciterCards").onclick=e=>{const id=e.target.dataset.preview;if(!id)return;e.preventDefault();audio.src=app.audioUrlFor(id,`${settings.surah}:${$("#memorizationPreviewAyah").value}`);audio.play().catch(()=>$("#memorizationSetupMessage").textContent="تعذر تشغيل المعاينة حالياً.")};$("#startMemorization").onclick=start;$("#memorizationMic").onclick=record;$("#memorizationStop").onclick=stopRecord;$("#memorizationDemoCorrect").onclick=correct;$("#memorizationDemoError").onclick=wrong;$("#memorizationPause").onclick=()=>{audio.pause();stopRecord();save();$("#memorizationPause").textContent="تم الحفظ مؤقتاً"};$("#memorizationExit").onclick=()=>{if(confirm("هل تريد إنهاء الجلسة؟ سيبقى تقدمك محفوظاً.")){audio.pause();stopRecord();save();$("#memorizationSession").classList.add("hidden");$("#home").classList.remove("hidden")}};
})();
