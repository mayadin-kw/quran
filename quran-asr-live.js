/* Persistent authenticated WebSocket transport for live Quran verification. */
(() => {
  const phoneDebug = new URLSearchParams(location.search).get("debugMemorization") === "true";
  window.QuranLiveStatus = { mic: false, rms: 0, inputSampleRate: null, pcmFrames: 0, pcmBytes: 0, websocket: "closed", partial: "", expectedWord: "", lastCommitted: "", verseKey: "", wordIndex: null, lastError: "" };
  const debug = (event, detail = {}) => {
    window.QuranLiveDebug = { event, ...detail, at: new Date().toISOString() };
    (window.QuranLiveTrace ||= []).push(window.QuranLiveDebug);
    if (window.QuranLiveTrace.length > 300) window.QuranLiveTrace.shift();
    console.info("[Quran Live ASR]", window.QuranLiveDebug);
    const status = window.QuranLiveStatus;
    if (event === "microphone_stream") status.mic = !!detail.active;
    if (event === "input_audio_stats") { status.rms = detail.rms; status.inputSampleRate = detail.inputSampleRate; status.channels = detail.channels; }
    if (event === "pcm_frames_sent") { status.pcmFrames = detail.frames; status.pcmBytes = detail.bytes; }
    if (event === "websocket_connecting") status.websocket = "connecting";
    if (event === "websocket_open") status.websocket = "open";
    if (event === "websocket_closed") status.websocket = "closed";
    if (event === "partial_hypothesis") status.partial = detail.transcript || "";
    if (event === "word_committed") { status.lastCommitted = `${detail.verseKey}:${detail.wordIndexInAyah}`; status.wordIndex = detail.wordIndexInAyah; }
    if (["websocket_error", "server_error", "audio_worklet_error", "fallback_blocked"].includes(event)) status.lastError = detail.category || detail.reason || event;
    if (phoneDebug) {
      const session = document.querySelector("#memorizationSession");
      if (session) {
        let panel = document.querySelector("#memorizationLiveDebug");
        if (!panel) { panel = document.createElement("pre"); panel.id = "memorizationLiveDebug"; panel.className = "memorization-debug"; session.append(panel); }
        panel.textContent = ["MIC: " + status.mic, "RMS: " + Number(status.rms || 0).toFixed(4), "INPUT SAMPLE RATE: " + (status.inputSampleRate || "—"), "CHANNELS: " + (status.channels || "—"), "PCM SENT: " + status.pcmFrames + " frames / " + status.pcmBytes + " bytes", "WEBSOCKET: " + status.websocket, "FASTCONFORMER PARTIAL: " + status.partial, "CURRENT EXPECTED WORD: " + status.expectedWord, "LAST COMMITTED WORD: " + status.lastCommitted, "VERSE KEY: " + status.verseKey, "WORD INDEX: " + (status.wordIndex ?? "—"), "LAST ERROR: " + status.lastError].join("\n");
      }
    }
  };
  const authToken = async () => Promise.race([
    typeof window.getFirebaseIdToken === "function" ? window.getFirebaseIdToken() : Promise.resolve(null),
    new Promise((_, reject) => setTimeout(() => reject(new DOMException("Firebase authentication timed out", "TimeoutError")), 12000)),
  ]);
  const wsUrlFor = (base) => base.replace(/^http/, "ws").replace(/\/$/, "") + "/api/recitation/live";

  class QuranLiveRecitation {
    constructor(context, handlers = {}) { this.context = context; this.handlers = handlers; this.socket = null; this.audioContext = null; this.source = null; this.worklet = null; this.ready = false; this.started = false; this.closed = false; this.framesSent = 0; this.bytesSent = 0; window.QuranLiveStatus.verseKey = context.verseKey; window.QuranLiveStatus.expectedWord = context.expectedWords?.[0] || ""; debug("target_prepared", { verseKey: context.verseKey }); }
    async prepare() {
      const base = window.APP_CONFIG?.QURAN_ASR_WS_URL || window.APP_CONFIG?.QURAN_ASR_API_URL;
      if (!base) { debug("fallback_blocked", { reason: "live_endpoint_not_configured" }); throw new Error("live_endpoint_not_configured"); }
      let token;
      try { token = await authToken(); } catch (error) { debug("fallback_blocked", { reason: error.message }); throw error; }
      if (!token) { debug("fallback_blocked", { reason: "firebase_auth_unavailable" }); throw new Error("firebase_auth_unavailable"); }
      const url = wsUrlFor(base); debug("websocket_connecting", { url, verseKey: this.context.verseKey });
      const socket = this.socket = new WebSocket(url); socket.binaryType = "arraybuffer";
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("live_connection_timeout")), 12000);
        socket.onopen = () => {
          debug("websocket_open", { verseKey: this.context.verseKey });
          socket.send(JSON.stringify({ type: "authenticate", token }));
          debug("authentication_sent", { verseKey: this.context.verseKey });
          socket.send(JSON.stringify({ type: "start", ...this.context }));
        };
        socket.onerror = () => { debug("websocket_error", { verseKey: this.context.verseKey }); reject(new Error("live_connection_failed")); };
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "session_ready") { clearTimeout(timeout); this.ready = true; debug("session_ready", { verseKey: this.context.verseKey }); this.handlers.ready?.(message); resolve(); return; }
          this.handle(message);
        };
        socket.onclose = (event) => { debug("websocket_closed", { code: event.code, reason: event.reason || "", ready: this.ready }); if (!this.closed && !this.ready) reject(new Error("live_connection_closed")); else if (!this.closed) this.handlers.error?.({ category: "CONNECTION_CLOSED", code: event.code }); };
      });
    }
    handle(message) {
      debug(message.type, { verseKey: message.verseKey, wordIndex: message.wordIndex, wordIndexInAyah: message.wordIndexInAyah, transcript: message.transcript, normalizedTranscript: message.normalizedTranscript, alignmentStatus: message.alignmentStatus, decoderUsed: message.decoderUsed, encodedFrameCount: message.encodedFrameCount, committedWordCount: message.committedWordCount, latencyMs: message.latencyMs, category: message.category });
      if (message.type === "word_committed") { window.QuranLiveStatus.expectedWord = this.context.expectedWords?.[Number(message.wordIndex) + 1] || ""; debug("next_expected_word", { verseKey: message.verseKey }); }
      if (message.type === "server_error") this.handlers.error?.(message); else this.handlers.event?.(message);
    }
    async start(stream) {
      if (!this.ready || this.started) return;
      this.audioContext = new AudioContext();
      await this.audioContext.audioWorklet.addModule("live-audio-processor.js?v=20260923-quran-wide-1");
      debug("microphone_stream", { active: stream.active, audioTrackCount: stream.getAudioTracks().length });
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(this.audioContext, "quran-live-pcm");
      this.worklet.port.onmessage = ({ data }) => {
        if (data?.type === "stats") { debug("input_audio_stats", { inputSampleRate: data.inputSampleRate, channels: data.channels, rms: data.rms, peak: data.peak, outputSamples: data.outputSamples }); return; }
        if (data?.type === "flushed") { this.flushResolver?.(); this.flushResolver = null; return; }
        if (data instanceof ArrayBuffer && this.socket?.readyState === WebSocket.OPEN && this.started) { this.socket.send(data); this.framesSent++; this.bytesSent += data.byteLength; if (this.framesSent === 1 || this.framesSent % 20 === 0) debug("pcm_frames_sent", { frames: this.framesSent, bytes: this.bytesSent }); }
      };
      this.source.connect(this.worklet); this.worklet.connect(this.audioContext.destination);
      await this.audioContext.resume(); this.started = true; debug("audio_worklet_started", { sampleRate: this.audioContext.sampleRate, state: this.audioContext.state, websocketState: this.socket?.readyState });
    }
    async end() {
      if (this.closed) return;
      if (this.worklet) await Promise.race([new Promise((resolve) => { this.flushResolver = resolve; this.worklet.port.postMessage({ type: "flush" }); }), new Promise((resolve) => setTimeout(resolve, 500))]);
      this.started = false;
      this.worklet?.disconnect(); this.source?.disconnect();
      try { await this.audioContext?.close(); } catch {}
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "end_turn" }));
    }
    close() {
      this.closed = true; this.started = false;
      this.worklet?.disconnect(); this.source?.disconnect();
      this.audioContext?.close().catch(() => {}); this.socket?.close();
    }
  }
  window.QuranLiveRecitation = QuranLiveRecitation;
})();
