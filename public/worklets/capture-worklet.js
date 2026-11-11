// AudioWorklet that batches mic samples into 2048-sample chunks for the recogniser
// and reports the peak RMS of each chunk for the voice-activity meter.
// Plain JS on purpose: it is loaded with audioWorklet.addModule(), outside the bundle.
const CHUNK = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CHUNK);
    this.n = 0;
    this.peak = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let sum = 0;
    for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
    const rms = Math.sqrt(sum / channel.length);
    if (rms > this.peak) this.peak = rms;
    for (let i = 0; i < channel.length; i++) {
      this.buf[this.n++] = channel[i];
      if (this.n === CHUNK) {
        this.port.postMessage({ samples: this.buf, rms: this.peak }, [
          this.buf.buffer,
        ]);
        this.buf = new Float32Array(CHUNK);
        this.n = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
