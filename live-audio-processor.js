/* Continuous mono PCM16, 16 kHz from the browser's actual input rate. */
class QuranLivePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.remaining = this.ratio;
    this.weighted = 0;
    this.samples = [];
    this.outputSamples = 0;
    this.rmsSum = 0;
    this.rmsCount = 0;
    this.peak = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let mono = 0;
      for (const channel of channels) mono += channel[index] || 0;
      mono = Math.max(-1, Math.min(1, mono / channels.length));
      this.rmsSum += mono * mono;
      this.rmsCount++;
      this.peak = Math.max(this.peak, Math.abs(mono));
      // Weighted integration preserves timing across 44.1/48 kHz blocks
      // and averages high-rate samples before decimation.
      let portion = 1;
      while (portion > 1e-9) {
        const weight = Math.min(portion, this.remaining);
        this.weighted += mono * weight;
        portion -= weight;
        this.remaining -= weight;
        if (this.remaining <= 1e-9) {
          this.samples.push(Math.max(-1, Math.min(1, this.weighted / this.ratio)));
          this.weighted = 0;
          this.remaining = this.ratio;
          if (this.samples.length >= 2048) this.flush();
        }
      }
    }
    if (this.rmsCount >= sampleRate) {
      this.port.postMessage({ type: "stats", inputSampleRate: sampleRate,
        channels: channels.length, rms: Math.sqrt(this.rmsSum / this.rmsCount),
        peak: this.peak, outputSamples: this.outputSamples });
      this.rmsSum = 0; this.rmsCount = 0; this.peak = 0;
    }
    return true;
  }
  flush() {
    if (!this.samples.length) return;
    const buffer = new ArrayBuffer(this.samples.length * 2);
    const view = new DataView(buffer);
    this.samples.forEach((sample, index) => view.setInt16(index * 2,
      Math.round(sample < 0 ? sample * 32768 : sample * 32767), true));
    this.outputSamples += this.samples.length;
    this.samples = [];
    this.port.postMessage(buffer, [buffer]);
  }
}
registerProcessor("quran-live-pcm", QuranLivePcmProcessor);
