/*
 * Production transport for a Quran-specific ASR service.
 * GitHub Pages only records and sends audio; inference belongs on the opted-in
 * Cloud Run endpoint. Set APP_CONFIG.QURAN_ASR_API_URL after deployment.
 */
(() => {
  const diagnostic = (detail) => { window.QuranAsrDiagnostic = { ...detail, recordedAt: new Date().toISOString() }; };
  const categoryFor = (status, error = "") => {
    if (status === 401) return "HTTP_401"; if (status === 403) return "HTTP_403"; if (status === 415) return "HTTP_415";
    if (status === 422) return "HTTP_422"; if (status >= 500) return "HTTP_500";
    if (/abort|timeout/i.test(error)) return "TIMEOUT"; if (/cors/i.test(error)) return "CORS_ERROR";
    if (/network|failed to fetch/i.test(error)) return "NETWORK_ERROR"; return "UNKNOWN_ERROR";
  };
  class QuranRecitationRecognizer {
    async check({ audioBlob, expectedText, context }) {
      const base = window.APP_CONFIG?.QURAN_ASR_API_URL || "";
      if (!base) { diagnostic({ requestUrl: "", category: "NETWORK_ERROR", exception: "QURAN_ASR_API_URL is not configured", verseKey: context.currentVerseKey }); return { available: false, reason: "asr_endpoint_not_configured", matchedWordIndexes: [] }; }
      if (!navigator.onLine) { diagnostic({ requestUrl: base, category: "NETWORK_ERROR", exception: "Browser is offline", verseKey: context.currentVerseKey }); return { available: false, reason: "offline", matchedWordIndexes: [] }; }
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
      const started = performance.now();
      try {
        const headers = { Accept: "application/json" };
        let token = null, authError = null;
        try {
          token = await Promise.race([
            getFirebaseToken(),
            new Promise((_, reject) => setTimeout(() => reject(new DOMException("Firebase authentication timed out", "TimeoutError")), 12000))
          ]);
        } catch (error) { authError = `${error.name || "Error"}: ${error.message || ""}`; }
        if (token) headers.Authorization = `Bearer ${token}`;
        const baseDiagnostic = { requestUrl: endpoint, firebaseAuth: token ? "success" : "failure", firebaseTokenPresent: token ? "yes" : "no", mediaRecorderMime: audioBlob.type || "unknown", blobBytes: audioBlob.size, recordingDurationMs: Math.round(context.recordingDurationMs || 0), verseKey: context.currentVerseKey, surah, ayah };
        if (!token) { diagnostic({ ...baseDiagnostic, category: "AUTH_ERROR", exception: authError || "No Firebase ID token was available", requestDurationMs: Math.round(performance.now() - started) }); return { available: false, reason: "firebase_auth_unavailable", matchedWordIndexes: [] }; }
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 45000);
        let response;
        try {
          response = await fetch(endpoint, { method: "POST", body: form, headers, signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          diagnostic({ ...baseDiagnostic, httpStatus: response.status, backendBody: body.slice(0, 500), category: categoryFor(response.status), requestDurationMs: Math.round(performance.now() - started) });
          console.info("[Quran Memorization ASR] request failed", { endpoint, httpStatus: response.status, recordingMime: audioBlob.type, recordingBytes: audioBlob.size, durationMs: Math.round(performance.now() - started), error: body.slice(0, 300) });
          return { available: false, reason: `HTTP ${response.status}`, matchedWordIndexes: [] };
        }
        const result = await response.json();
        diagnostic({ ...baseDiagnostic, httpStatus: response.status, backendBody: result.error || "", category: result.success ? "OK" : result.error === "invalid_audio" ? "AUDIO_DECODE_ERROR" : "ASR_ERROR", requestDurationMs: Math.round(performance.now() - started) });
        const matchedWordIndexes = (result.words || []).filter((word) => word.status === "correct" && Number.isInteger(word.expectedWordIndex)).map((word) => word.expectedWordIndex);
        const mismatch = result.firstMismatch || null;
        console.info("[Quran Memorization ASR]", { endpoint, latencyMs: Math.round(performance.now() - started), httpStatus: response.status, recordingMime: audioBlob.type, recordingBytes: audioBlob.size, recognizedText: result.recognizedText, expectedWords: context.expectedWords, alignment: result.words, confidence: result.confidence });
        return { available: !!result.success, complete: !!result.correct, matchedWordIndexes, mismatch, recognizedText: result.recognizedText || "", words: result.words || [] };
      } catch (error) {
        diagnostic({ requestUrl: endpoint, firebaseAuth: "unknown", firebaseTokenPresent: "unknown", mediaRecorderMime: audioBlob.type || "unknown", blobBytes: audioBlob.size, recordingDurationMs: Math.round(context.recordingDurationMs || 0), verseKey: context.currentVerseKey, surah, ayah, category: categoryFor(0, error.message), exception: `${error.name || "Error"}: ${error.message || ""}`, requestDurationMs: Math.round(performance.now() - started) });
        return { available: false, reason: error.message, matchedWordIndexes: [] };
      }
    }
  }
  async function getFirebaseToken() {
    if (typeof window.getFirebaseIdToken === "function") return window.getFirebaseIdToken();
    const currentUser = window.firebase?.auth?.().currentUser;
    return currentUser ? currentUser.getIdToken() : null;
  }
  window.QuranRecitationRecognizer = QuranRecitationRecognizer;
})();
