class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.pendingModeConfirmation = true;
    this.port.onmessage = (event) => {
      const message = event?.data ?? {};
      if (message.type === "ping") {
        this.port.postMessage({ type: "ready" });
        return;
      }
      if (message.type === "mode" && ["pure", "adaptive", "power"].includes(message.mode)) {
        this.mode = message.mode;
        this.pendingModeConfirmation = true;
        this.port.postMessage({ type: "mode-selected", mode: this.mode });
        return;
      }
      if (message.type === "reset") {
        this.pendingModeConfirmation = true;
      }
    };
  }

  static copyInput(input, output) {
    const frames = output[0]?.length ?? 0;
    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[channel] ?? input[0];
      const target = output[channel];
      if (!target) continue;
      if (!source) {
        target.fill(0);
        continue;
      }
      for (let frame = 0; frame < frames; frame += 1) {
        target[frame] = source[frame] ?? 0;
      }
    }
  }

  static hasAudibleSignal(input, frames) {
    for (let channel = 0; channel < input.length; channel += 1) {
      const source = input[channel];
      if (!source) continue;
      for (let frame = 0; frame < frames; frame += 1) {
        if (Math.abs(source[frame] ?? 0) > 1e-5) return true;
      }
    }
    return false;
  }

  confirmModeIfAudible(input, frames) {
    if (!this.pendingModeConfirmation) return;
    if (!MvpSoundModesProcessor.hasAudibleSignal(input, frames)) return;
    this.pendingModeConfirmation = false;
    this.port.postMessage({ type: "mode-active", mode: this.mode });
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!output.length) return true;

    const frames = output[0]?.length ?? 0;

    if (this.mode === "pure") {
      MvpSoundModesProcessor.copyInput(input, output);
      this.confirmModeIfAudible(input, frames);
      return true;
    }

    // Foundation R6 deliberately uses broadband-only density shaping so the
    // three modes are unmistakable before any tonal/spatial features return.
    // No EQ, bass shelf, treble lift, crossfeed, widening or device profile.
    const settings = this.mode === "power"
      ? { drive: 6.0, ceiling: 0.975 }
      : { drive: 2.0, ceiling: 0.980 };
    const normalization = settings.ceiling / Math.tanh(settings.drive);

    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[channel] ?? input[0];
      const target = output[channel];
      if (!target) continue;
      if (!source) {
        target.fill(0);
        continue;
      }
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = source[frame] ?? 0;
        target[frame] = Math.tanh(sample * settings.drive) * normalization;
      }
    }

    this.confirmModeIfAudible(input, frames);
    return true;
  }
}

registerProcessor("mvp-sound-modes", MvpSoundModesProcessor);
