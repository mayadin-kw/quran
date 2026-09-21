/* AudioWorklet: downsample microphone Float32 frames to mono PCM16 / 16 kHz. */
class QuranLivePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.position = 0;
    this.samples = [];
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    while (this.position < input.length) {
      const sample = Math.max(-1, Math.min(1, input[Math.floor(this.position)]));
      this.samples.push(sample < 0 ? sample * 32768 : sample * 32767);
      this.position += this.ratio;
      if (this.samples.length >= 2048) this.flush();
    }
    this.position -= input.length;
    return true;
  }
  flush() {
    const pcm = Int16Array.from(this.samples.splice(0, this.samples.length));
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
  }
}
registerProcessor("quran-live-pcm", QuranLivePcmProcessor);
