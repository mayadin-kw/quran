/*
 * Production transport for a Quran-specific ASR service.
 * GitHub Pages only records and sends audio; inference belongs on the opted-in
 * Cloud Run endpoint. Set APP_CONFIG.QURAN_ASR_API_URL after deployment.
 */
(() => {
  class QuranRecitationRecognizer {
    async check({ audioBlob, expectedText, context }) {
      const base = window.APP_CONFIG?.QURAN_ASR_API_URL || "";
      if (!base) return { available: false, reason: "asr_endpoint_not_configured", matchedWordIndexes: [] };
      if (!navigator.onLine) return { available: false, reason: "offline", matchedWordIndexes: [] };
      const endpoint = `${base.replace(/\/$/, "")}/api/recitation/check`;
      const form = new FormData();
      form.append("audio", audioBlob, "recitation.webm");
      form.append("expectedText", expectedText);
      form.append("verseKey", context.currentVerseKey);
      const [surah, ayah] = context.currentVerseKey.split(":");
      form.append("surah", surah); form.append("ayah", ayah);
      form.append("segmentIndex", String(context.currentSegment));
      form.append("segmentStartWord", String(context.segmentStartWord ?? 0));
      form.append("segmentEndWord", String(context.segmentEndWord ?? Math.max(0, context.expectedWords.length - 1)));
      form.append("expectedWords", JSON.stringify(context.expectedWords));
      try {
        const headers = { Accept: "application/json" };
        const token = await getFirebaseToken(); if (token) headers.Authorization = `Bearer ${token}`;
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 45000), started = performance.now();
        const response = await fetch(endpoint, { method: "POST", body: form, headers, signal: controller.signal }); clearTimeout(timeout);
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          console.info("[Quran Memorization ASR] request failed", { endpoint, httpStatus: response.status, recordingMime: audioBlob.type, recordingBytes: audioBlob.size, durationMs: Math.round(performance.now() - started), error: body.slice(0, 300) });
          return { available: false, reason: `HTTP ${response.status}`, matchedWordIndexes: [] };
        }
        const result = await response.json();
        const matchedWordIndexes = (result.words || []).filter((word) => word.status === "correct" && Number.isInteger(word.expectedWordIndex)).map((word) => word.expectedWordIndex);
        const mismatch = result.firstMismatch || null;
        console.info("[Quran Memorization ASR]", { endpoint, latencyMs: Math.round(performance.now() - started), httpStatus: response.status, recordingMime: audioBlob.type, recordingBytes: audioBlob.size, recognizedText: result.recognizedText, expectedWords: context.expectedWords, alignment: result.words, confidence: result.confidence });
        return { available: !!result.success, complete: !!result.correct, matchedWordIndexes, mismatch, recognizedText: result.recognizedText || "", words: result.words || [] };
      } catch (error) { return { available: false, reason: error.message, matchedWordIndexes: [] }; }
    }
  }
  async function getFirebaseToken() {
    if (typeof window.getFirebaseIdToken === "function") return window.getFirebaseIdToken();
    const currentUser = window.firebase?.auth?.().currentUser;
    return currentUser ? currentUser.getIdToken() : null;
  }
  window.QuranRecitationRecognizer = QuranRecitationRecognizer;
})();
