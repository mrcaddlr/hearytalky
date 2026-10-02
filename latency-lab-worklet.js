
"use strict";

class PassThroughProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output) return true;

    for (let channel = 0; channel < output.length; channel++) {
      const src = input && input[channel];
      const dst = output[channel];

      if (src) dst.set(src);
      else dst.fill(0);
    }

    return true;
  }
}

class PeakDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 0.08;
    this.minFrame = 0;
    this.maxFrame = Number.MAX_SAFE_INTEGER;
    this.hit = false;

    this.port.onmessage = (event) => {
      const data = event.data || {};

      if (data.type === "arm") {
        this.threshold = Number.isFinite(data.threshold) ? data.threshold : 0.08;
        this.minFrame = Number.isFinite(data.minFrame) ? data.minFrame : currentFrame;
        this.maxFrame = Number.isFinite(data.maxFrame)
          ? data.maxFrame
          : Number.MAX_SAFE_INTEGER;
        this.hit = false;
      }

      if (data.type === "reset") {
        this.hit = false;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];

    if (!input || !input.length) return true;

    let peak = 0;

    for (const channel of input) {
      for (let i = 0; i < channel.length; i++) {
        const value = Math.abs(channel[i]);
        if (value > peak) peak = value;
      }
    }

    if (
      !this.hit &&
      currentFrame >= this.minFrame &&
      currentFrame <= this.maxFrame &&
      peak >= this.threshold
    ) {
      this.hit = true;

      this.port.postMessage({
        type: "hit",
        frame: currentFrame,
        peak,
        sampleRate
      });
    }

    return true;
  }
}

registerProcessor("hearytalky-pass-through", PassThroughProcessor);
registerProcessor("hearytalky-peak-detector", PeakDetectorProcessor);
