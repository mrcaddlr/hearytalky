"use strict";

const $ = (id) => document.getElementById(id);

const startButton = $("start");
const status = $("status");
const message = $("message");
const inputDevice = $("inputDevice");
const outputDevice = $("outputDevice");
const volume = $("volume");
const volumeText = $("volumeText");
const muteButton = $("mute");
const mode = $("mode");
const meterFill = $("meterFill");
const clipMark = $("clipMark");
const levelText = $("levelText");
const meter = document.querySelector(".meter");
const audioMode = $("audioMode");
const inputInfo = $("inputInfo");
const processingInfo = $("processingInfo");
const sampleRateInfo = $("sampleRateInfo");
const latencyText = $("latency");
const statsText = $("stats");
const routingText = $("routing");
const refreshStatsButton = $("refreshStats");
const estimateText = $("estimate");
const latencyHintText = $("latencyHint");

let ctx = null;
let stream = null;
let source = null;
let gain = null;
let analyser = null;
let raf = 0;
let statsTimer = 0;
let muted = false;
let clipUntil = 0;
let selectedOutput = "";

function setStatus(state, text) {
  status.dataset.state = state;
  status.lastChild.textContent = " " + text;
}

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function dbFromRms(rms) {
  return rms > 0.00001 ? 20 * Math.log10(rms) : -60;
}

function formatMs(seconds) {
  return Number.isFinite(seconds) ? (seconds * 1000).toFixed(1) + " ms" : "Not reported";
}

function drawMeter() {
  if (!analyser) return;

  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);

  let sum = 0;
  let peak = 0;

  for (const sample of data) {
    sum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const db = Math.max(-60, Math.min(0, dbFromRms(Math.sqrt(sum / data.length))));
  const percent = ((db + 60) / 60) * 100;

  meterFill.style.width = percent + "%";
  levelText.textContent = db <= -59.5 ? "-∞ dB" : db.toFixed(1) + " dB";
  meter.setAttribute("aria-valuenow", db.toFixed(1));

  if (peak >= 0.98) clipUntil = performance.now() + 700;
  clipMark.classList.toggle("visible", performance.now() < clipUntil);

  raf = requestAnimationFrame(drawMeter);
}

function clearMeter() {
  cancelAnimationFrame(raf);
  raf = 0;
  meterFill.style.width = "0%";
  levelText.textContent = "-∞ dB";
  clipMark.classList.remove("visible");
  meter.setAttribute("aria-valuenow", "-60");
}

function getSupportedAudioConstraints() {
  try {
    return navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints
      ? navigator.mediaDevices.getSupportedConstraints()
      : {};
  } catch {
    return {};
  }
}

function buildMicConstraints(deviceId) {
  const supported = getSupportedAudioConstraints();
  const ultra = mode.value === "ultra";
  const audio = {};

  if (deviceId && supported.deviceId !== false) {
    audio.deviceId = { exact: deviceId };
  }

  if (supported.echoCancellation) audio.echoCancellation = false;
  if (supported.noiseSuppression) audio.noiseSuppression = false;
  if (supported.autoGainControl) audio.autoGainControl = false;

  if (supported.latency) {
    audio.latency = { ideal: ultra ? 0.003 : 0.005 };
  }

  return { audio: Object.keys(audio).length ? audio : true };
}

async function getMicrophone(deviceId) {
  const attempts = [buildMicConstraints(deviceId)];

  if (deviceId) {
    attempts.push({ audio: { deviceId: { ideal: deviceId } } });
  }

  attempts.push({ audio: true });

  let lastError;

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      if (err && err.name !== "OverconstrainedError" && err.name !== "NotFoundError") {
        throw err;
      }
    }
  }

  throw lastError || new Error("Microphone could not be opened.");
}

function closeContext() {
  if (!ctx) return;
  try { ctx.close(); } catch {}
  ctx = null;
}

async function ensureContext(sinkId = selectedOutput) {
  if (!ctx || ctx.state === "closed") {
    const options = {
      latencyHint: mode.value === "ultra" ? 0.003 : "interactive"
    };

    if (sinkId) options.sinkId = sinkId;

    try {
      ctx = new AudioContext(options);
    } catch {
      delete options.sinkId;
      ctx = new AudioContext(options);
    }
  }

  if (ctx.state !== "running") {
    await ctx.resume();
  }
}

function updateDiagnostics() {
  if (!ctx) {
    audioMode.textContent = "Not running";
    inputInfo.textContent = "—";
    processingInfo.textContent = "—";
    sampleRateInfo.textContent = "—";
    latencyText.textContent = "—";
    statsText.textContent = "Not running";
    estimateText.textContent = "—";
    latencyHintText.textContent = "—";
    return;
  }

  audioMode.textContent = "Web Audio";
  sampleRateInfo.textContent = ctx.sampleRate.toLocaleString() + " Hz";

  const base = Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : NaN;
  const output = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : NaN;
  const track = stream && stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
  const settings = track && track.getSettings ? track.getSettings() : {};
  const input = settings.latency;
  const hasInput = Number.isFinite(input);

  inputInfo.textContent = hasInput ? formatMs(input) : "Not reported";

  const processing = [
    ["echo cancellation", settings.echoCancellation],
    ["noise suppression", settings.noiseSuppression],
    ["auto gain control", settings.autoGainControl]
  ]
    .filter((item) => typeof item[1] === "boolean")
    .map((item) => item[0] + ": " + (item[1] ? "on" : "off"));

  processingInfo.textContent = processing.length ? processing.join(" · ") : "Not reported";
  latencyHintText.textContent = mode.value === "ultra" ? "3 ms preference" : "interactive";

  if (Number.isFinite(base) || Number.isFinite(output)) {
    const browserPath =
      (hasInput ? input : 0) +
      (Number.isFinite(base) ? base : 0) +
      (Number.isFinite(output) ? output : 0);

    estimateText.textContent =
      "~" + (browserPath * 1000).toFixed(1) + " ms browser-path estimate";

    latencyText.textContent =
      (Number.isFinite(base) ? "audio " + formatMs(base) : "audio —") +
      " · " +
      (Number.isFinite(output) ? "output " + formatMs(output) : "output —");
  } else {
    estimateText.textContent = "Browser does not report enough data";
    latencyText.textContent = "Not reported";
  }

  updatePlaybackStats();
}

function updatePlaybackStats() {
  if (!ctx) return;

  const stats = ctx.playbackStats;
  if (!stats) {
    statsText.textContent = "Unavailable in this browser";
    return;
  }

  const parts = [];

  if (Number.isFinite(stats.averageLatency)) {
    parts.push("avg " + formatMs(stats.averageLatency));
  }
  if (Number.isFinite(stats.minimumLatency)) {
    parts.push("min " + formatMs(stats.minimumLatency));
  }
  if (Number.isFinite(stats.maximumLatency)) {
    parts.push("max " + formatMs(stats.maximumLatency));
  }
  if (Number.isFinite(stats.underrunEvents)) {
    parts.push("underruns " + stats.underrunEvents);
    if (stats.underrunEvents > 0) {
      setMessage(
        "Audio underruns detected (" + stats.underrunEvents + "). Lower latency may be unstable on a busy system.",
        true
      );
    }
  }

  statsText.textContent = parts.length
    ? parts.join(" · ")
    : "No playback statistics reported yet";
}

function makeAudioGraph() {
  source = ctx.createMediaStreamSource(stream);
  gain = ctx.createGain();
  analyser = ctx.createAnalyser();

  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.05;

  gain.gain.value = muted ? 0 : Number(volume.value) / 100;

  // The playback path is only source -> gain -> destination.
  source.connect(gain);
  gain.connect(ctx.destination);

  // Metering is a separate branch and never sits in the playback path.
  source.connect(analyser);
}

async function loadDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

  const list = await navigator.mediaDevices.enumerateDevices();
  const currentInput = inputDevice.value;
  const currentOutput = outputDevice.value;

  inputDevice.replaceChildren();
  outputDevice.replaceChildren();

  const inputs = list.filter((device) => device.kind === "audioinput");
  const outputs = list.filter(
    (device) => device.kind === "audiooutput" && device.deviceId !== "default"
  );

  if (!inputs.length) {
    inputDevice.add(new Option("No microphone detected", ""));
  } else {
    inputs.forEach((device, index) => {
      inputDevice.add(
        new Option(device.label || "Microphone " + (index + 1), device.deviceId)
      );
    });
  }

  outputDevice.add(new Option("System default", ""));
  outputs.forEach((device, index) => {
    outputDevice.add(
      new Option(device.label || "Output " + (index + 1), device.deviceId)
    );
  });

  if ([...inputDevice.options].some((option) => option.value === currentInput)) {
    inputDevice.value = currentInput;
  }

  if ([...outputDevice.options].some((option) => option.value === currentOutput)) {
    outputDevice.value = currentOutput;
  }
}

async function applyOutput(deviceId) {
  selectedOutput = deviceId || "";

  if (!ctx || ctx.state === "closed") return;

  if (typeof ctx.setSinkId !== "function") {
    routingText.textContent = "Browser default";
    setMessage(
      "This browser cannot select Web Audio outputs. The system default output is being used.",
      true
    );
    return;
  }

  try {
    await ctx.setSinkId(deviceId || "");
    routingText.textContent =
      outputDevice.selectedOptions[0]?.textContent || "System default";
    setMessage("");
  } catch (err) {
    console.error(err);
    routingText.textContent = "System default";
    setMessage("That output could not be selected; using the system default.", true);
  }

  updateDiagnostics();
}

async function startMonitoring(deviceId = inputDevice.value || undefined) {
  setMessage("");

  try {
    if (stream) stopStreamOnly();

    selectedOutput = outputDevice.value || selectedOutput || "";
    await ensureContext(selectedOutput);
    stream = await getMicrophone(deviceId);
    makeAudioGraph();

    await loadDevices();

    inputDevice.disabled = false;
    outputDevice.disabled = false;
    muteButton.disabled = false;
    refreshStatsButton.disabled = false;

    startButton.textContent = "Stop monitoring";
    startButton.classList.add("running");
    setStatus("running", " monitoring");

    updateDiagnostics();
    drawMeter();

    if (ctx.playbackStats && ctx.playbackStats.resetLatency) {
      try { ctx.playbackStats.resetLatency(); } catch {}
    }

    updateDiagnostics();

    clearInterval(statsTimer);
    statsTimer = setInterval(updatePlaybackStats, 1000);
  } catch (err) {
    console.error(err);
    stop();

    setStatus("error", " error");

    const text =
      err?.name === "NotAllowedError"
        ? "Microphone access was blocked. Allow microphone access and try again."
        : err?.name === "NotFoundError"
        ? "No microphone was detected."
        : err?.name === "OverconstrainedError"
        ? "The microphone rejected a constraint. The app already tried compatible fallbacks."
        : "Could not start microphone monitoring: " +
          (err?.message || err?.name || "unknown error");

    setMessage(text, true);
  }
}

function stopStreamOnly() {
  clearInterval(statsTimer);
  statsTimer = 0;

  cancelAnimationFrame(raf);
  raf = 0;

  if (source) source.disconnect();
  if (gain) gain.disconnect();
  if (analyser) analyser.disconnect();
  if (stream) stream.getTracks().forEach((track) => track.stop());

  source = null;
  gain = null;
  analyser = null;
  stream = null;

  clearMeter();
}

function stop(options = {}) {
  stopStreamOnly();

  inputDevice.disabled = true;
  outputDevice.disabled = true;
  muteButton.disabled = true;
  refreshStatsButton.disabled = true;

  startButton.textContent = "Start monitoring";
  startButton.classList.remove("running");
  setStatus("idle", " ready");

  if (options.closeAudio) closeContext();
  updateDiagnostics();
}

startButton.addEventListener("click", async () => {
  if (stream) stop();
  else await startMonitoring();
});

volume.addEventListener("input", () => {
  const value = Number(volume.value);
  volumeText.textContent = value + "%";

  if (gain && ctx) {
    gain.gain.setTargetAtTime(
      muted ? 0 : value / 100,
      ctx.currentTime,
      0.002
    );
  }
});

muteButton.addEventListener("click", () => {
  muted = !muted;

  if (gain && ctx) {
    gain.gain.setTargetAtTime(
      muted ? 0 : Number(volume.value) / 100,
      ctx.currentTime,
      0.002
    );
  }

  muteButton.textContent = muted ? "Unmute monitor" : "Mute monitor";
});

inputDevice.addEventListener("change", async () => {
  if (stream) await startMonitoring(inputDevice.value);
});

outputDevice.addEventListener("change", async () => {
  await applyOutput(outputDevice.value);
});

mode.addEventListener("change", async () => {
  if (!stream) {
    latencyHintText.textContent = mode.value === "ultra" ? "3 ms preference" : "interactive";
    return;
  }

  const mic = inputDevice.value || undefined;
  const output = outputDevice.value || "";
  stop({ closeAudio: true });
  selectedOutput = output;
  await startMonitoring(mic);
});

refreshStatsButton.addEventListener("click", updateDiagnostics);

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    loadDevices().catch(console.error);
  });
}

document.addEventListener("keydown", async (event) => {
  if (event.code !== "Space" || event.target.matches("input,select,button")) return;

  event.preventDefault();
  if (stream) stop();
  else await startMonitoring();
});

if (!window.isSecureContext) {
  setMessage(
    "Microphone access requires a secure context. GitHub Pages provides HTTPS.",
    true
  );
}

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  startButton.disabled = true;
  setStatus("error", " unsupported");
  setMessage(
    "This browser does not provide microphone access through the Web Audio API.",
    true
  );
}

window.addEventListener("beforeunload", () => stop({ closeAudio: true }));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(console.error)
  );
}
