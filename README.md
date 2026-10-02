# hearytalky

A tiny browser microphone monitor designed for the lowest practical latency a normal web browser can provide.

**Mic → Web Audio → headphones**

No server. No recording. No speech-to-text. Audio stays on the device.

## Features

- Near-zero-latency Web Audio monitoring
- Interactive/low-latency AudioContext
- Microphone selection
- Output selection where browser support exists
- Monitor volume
- Mute
- Live RMS input meter and clipping indicator
- Browser-reported audio latency information
- Keyboard shortcut: Space
- Responsive mobile/desktop UI
- PWA/offline shell
- GitHub Pages deployment
- No npm, build step, backend, account, or external dependency

## Important

The app cannot guarantee literal zero latency. Microphone hardware, operating-system audio paths, browser implementation, and headphones all contribute latency.

Bluetooth headphones can add noticeable latency. Wired headphones are generally preferable for live monitoring.

Use headphones. Monitoring through speakers can create feedback.

## Local development

Serve the directory over HTTPS or localhost. Microphone permissions are restricted by browsers to secure contexts.

For example, any simple static server that provides localhost is enough. There is no build process.

## GitHub Pages

The included GitHub Actions workflow deploys the repository as a static GitHub Pages site.

## Privacy

hearytalky does not upload or store microphone audio. The microphone stream is connected locally to the Web Audio output.