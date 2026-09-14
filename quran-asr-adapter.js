/*
 * Production transport for a Quran-specific ASR service.
 * GitHub Pages only records and sends audio; inference belongs on the opted-in
 * self-hosted endpoint. Set window.QuranASREndpoint before this script to use
 * another HTTPS origin, otherwise the same-origin /api/recitation/check route
 * is attempted (and cleanly reported as unavailable on GitHub Pages).
 */
(() => {
  class QuranRecitationRecognizer {
    async check({ audioBlob, expectedText, context }) {
      const endpoint = window.QuranASREndpoint || "/api/recitation/check";
      const form = new FormData();
      form.append("audio", audioBlob, "recitation.webm");
      form.append("expectedText", expectedText);
      form.append("verseKey", context.currentVerseKey);
      form.append("segmentIndex", String(context.currentSegment));
      form.append("expectedWords", JSON.stringify(context.expectedWords));
      try {
        const response = await fetch(endpoint, { method: "POST", body: form, headers: { Accept: "application/json" } });
        if (!response.ok) return { available: false, reason: `HTTP ${response.status}`, matchedWordIndexes: [] };
        const result = await response.json();
        // Required server response: { complete, matchedWordIndexes, mismatch }.
        return { available: true, complete: !!result.complete, matchedWordIndexes: Array.isArray(result.matchedWordIndexes) ? result.matchedWordIndexes : [], mismatch: result.mismatch || null, recognizedText: result.recognizedText || "" };
      } catch (error) { return { available: false, reason: error.message, matchedWordIndexes: [] }; }
    }
  }
  window.QuranRecitationRecognizer = QuranRecitationRecognizer;
})();
