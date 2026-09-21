/* Persistent authenticated WebSocket transport for live Quran verification. */
(() => {
  const authToken = async () => Promise.race([
    typeof window.getFirebaseIdToken === "function" ? window.getFirebaseIdToken() : Promise.resolve(null),
    new Promise((_, reject) => setTimeout(() => reject(new DOMException("Firebase authentication timed out", "TimeoutError")), 12000)),
  ]);
  const wsUrlFor = (base) => base.replace(/^http/, "ws").replace(/\/$/, "") + "/api/recitation/live";

  class QuranLiveRecitation {
    constructor(context, handlers = {}) { this.context = context; this.handlers = handlers; this.socket = null; this.audioContext = null; this.source = null; this.worklet = null; this.ready = false; this.started = false; this.closed = false; }
    async prepare() {
      const base = window.APP_CONFIG?.QURAN_ASR_WS_URL || window.APP_CONFIG?.QURAN_ASR_API_URL;
      if (!base) throw new Error("live_endpoint_not_configured");
      const token = await authToken(); if (!token) throw new Error("firebase_auth_unavailable");
      const socket = this.socket = new WebSocket(wsUrlFor(base)); socket.binaryType = "arraybuffer";
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("live_connection_timeout")), 12000);
        socket.onopen = () => {
          socket.send(JSON.stringify({ type: "authenticate", token }));
          socket.send(JSON.stringify({ type: "start", ...this.context }));
        };
        socket.onerror = () => reject(new Error("live_connection_failed"));
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "session_ready") { clearTimeout(timeout); this.ready = true; this.handlers.ready?.(message); resolve(); return; }
          this.handle(message);
        };
        socket.onclose = () => { if (!this.closed && !this.ready) reject(new Error("live_connection_closed")); else if (!this.closed) this.handlers.error?.({ category: "CONNECTION_CLOSED" }); };
      });
    }
    handle(message) {
      if (message.type === "server_error") this.handlers.error?.(message);
      else this.handlers.event?.(message);
    }
    async start(stream) {
      if (!this.ready || this.started) return;
      this.audioContext = new AudioContext();
      await this.audioContext.audioWorklet.addModule("live-audio-processor.js");
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(this.audioContext, "quran-live-pcm");
      this.worklet.port.onmessage = ({ data }) => { if (this.socket?.readyState === WebSocket.OPEN && this.started) this.socket.send(data); };
      this.source.connect(this.worklet); this.worklet.connect(this.audioContext.destination);
      this.started = true;
    }
    async end() {
      if (this.closed) return;
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
