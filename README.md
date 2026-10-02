# hearytalky

Near-zero-latency browser microphone monitoring.

**Mic → Web Audio → headphones**

The playback path is intentionally tiny:

`MediaStreamSource → GainNode → AudioContext.destination`

The level meter is a separate analyser branch and never sits between the microphone and your ears.

## Latency-focused design

- `AudioContext({ latencyHint: "interactive" })` in Interactive mode
- Ultra mode requests a 3 ms AudioContext latency preference
- Microphone latency is requested as an ideal preference only when the browser exposes the constraint
- Echo cancellation, noise suppression, and automatic gain control are requested off when supported
- No forced sample rate, channel count, or sample size
- Exact microphone IDs fall back to ideal/default selection
- Output device selection uses `AudioContext.setSinkId()` where supported
- A selected output is passed to the AudioContext constructor where supported
- Browser-reported input, AudioContext, and output latency
- Browser-path latency estimate
- AudioPlaybackStats average/min/max latency and underrun telemetry where available
- Metering stays off the playback path
- No recording, upload, WebRTC, backend, or external dependency

Latency hints and media constraints are preferences, not guarantees. Microphone hardware, operating-system audio paths, browser implementation, and headphones still contribute to final microphone-to-ear delay.

## Bluetooth

Bluetooth audio can add transport and codec delay that JavaScript cannot remove. Wired headphones are generally preferable for live monitoring.

## Feedback

Use headphones. Monitoring through speakers can create acoustic feedback.

## Privacy

Microphone audio is routed locally from the browser input to the selected output. hearytalky does not upload or store microphone audio.

## GitHub Pages

The repository is static and deploys with the included GitHub Pages Actions workflow.