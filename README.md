# hearytalky

Near-zero-latency browser microphone monitoring plus a latency lab.

~~~~text
MIC → MediaStreamSource → optional GainNode → AudioContext.destination
                      └→ separate analyser for the meter
~~~~

The analyser never sits in the monitoring path.

## Modes

- Adaptive: starts at a very small latency request and raises it only when playback underruns are detected.
- Raw: direct source-to-output path when volume is at unity.
- Extreme: requests about 1 ms.
- Ultra: requests about 3 ms.
- Interactive: lets the browser choose its interactive configuration.
- Worklet: experimental pass-through path for A/B testing. It is not the default.

Latency hints are preferences, not guarantees. The browser and hardware may choose different buffering.

## Device-aware setup

hearytalky opens the microphone first, reads its actual settings, then creates the AudioContext.

It records:

- actual microphone latency when reported
- actual channel count
- input sample rate
- AudioContext sample rate
- base latency
- output latency
- microphone processing state
- output routing
- playback latency statistics
- underrun events
- main-thread responsiveness

When possible, the context is created at the microphone's reported sample rate and with the selected output sink. If the browser rejects either option, the app falls back safely.

Microphone constraints are feature-detected first. Latency and channel count are preferences, not exact requirements. Echo cancellation, noise suppression, and automatic gain control are requested off when supported.

## Adaptive latency

Adaptive mode tries:

~~~~text
1 ms → 2 ms → 3 ms → 5 ms → interactive
~~~~

It waits for playback statistics after startup. If underruns appear, it restarts the graph at the next target. The goal is the lowest stable configuration rather than the smallest requested number.

## Latency lab

### 10-second benchmark

The benchmark samples the browser-reported path for ten seconds and stores a local result containing:

- minimum, average, and maximum browser-path estimate
- playback underruns
- UI responsiveness
- browser/platform
- selected input/output
- selected mode

No audio is recorded or uploaded.

### Physical loopback

The loopback test uses an AudioWorklet detector and a short low-level pulse. Route the selected output back into the selected microphone through an audio loopback path. The test measures when the microphone receives the pulse and reports a median estimate over multiple trials.

This is the closest built-in test to an end-to-end input-to-output measurement, but it requires a real loopback route. Normal headphones do not provide one.

## AudioWorklet

hearytalky includes a tiny pass-through AudioWorklet and a peak detector.

The pass-through path exists only as an explicit experimental mode. The peak detector is used by the physical loopback test.

AudioWorklet is not automatically assumed to be faster; it adds another rendering-stage component, so direct routing remains the primary production path.

## Output

Output selection uses AudioContext sink routing when supported. The system default is represented by the browser's default sink rather than the special no-output sink.

Bluetooth transport/codec latency is outside the application's control and can dominate the measured end-to-end delay. Wired output is usually the better choice for live monitoring.

## Performance philosophy

- no framework
- no npm
- no server
- no recording
- no WebRTC
- no speech-to-text
- no DSP in the production playback path
- no UI work between microphone and output
- feature detection before using optional APIs
- measure before keeping an optimization

## Privacy

Audio stays local in the browser. hearytalky does not upload or store microphone audio.

Benchmark/device profiles are stored only in localStorage on the current device.

## GitHub Pages

The repository is static and deploys through the included GitHub Pages Actions workflow.