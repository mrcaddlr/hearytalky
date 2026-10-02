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
const meterFill = $("meterFill");
const clipMark = $("clipMark");
const levelText = $("levelText");
const meter = document.querySelector(".meter");
const audioMode = $("audioMode");
const latencyText = $("latency");
const routingText = $("routing");

let ctx = null;
let stream = null;
let source = null;
let gain = null;
let analyser = null;
let raf = 0;
let muted = false;
let devicesKnown = false;
let clipUntil = 0;

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

async function ensureContext() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
  }
  if (ctx.state !== "running") await ctx.resume();
}

function updateDiagnostics() {
  if (!ctx) {
    audioMode.textContent = "Not running";
    latencyText.textContent = "—";
    return;
  }
  audioMode.textContent = "Web Audio / interactive";
  const base = Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0;
  const output = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0;
  if (base || output) {
    const ms = (base + output) * 1000;
    latencyText.textContent = ms.toFixed(1) + " ms browser-reported";
  } else {
    latencyText.textContent = "Not reported";
  }
}

function makeAudioGraph() {
  source = ctx.createMediaStreamSource(stream);
  gain = ctx.createGain();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.05;

  gain.gain.value = muted ? 0 : Number(volume.value) / 100;
  source.connect(gain);
  gain.connect(analyser);
  analyser.connect(ctx.destination);
}

async function loadDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const list = await navigator.mediaDevices.enumerateDevices();

  const currentInput = inputDevice.value;
  const currentOutput = outputDevice.value;
  inputDevice.replaceChildren();
  outputDevice.replaceChildren();

  const inputs = list.filter(d => d.kind === "audioinput");
  const outputs = list.filter(d => d.kind === "audiooutput");

  if (!inputs.length) {
    inputDevice.add(new Option("No microphone detected", ""));
  } else {
    inputs.forEach((d, i) => {
      inputDevice.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId));
    });
  }

  if (!outputs.length) {
    outputDevice.add(new Option("Default output", "default"));
  } else {
    outputs.forEach((d, i) => {
      outputDevice.add(new Option(d.label || `Output ${i + 1}`, d.deviceId));
    });
  }

  if ([...inputDevice.options].some(o => o.value === currentInput)) inputDevice.value = currentInput;
  if ([...outputDevice.options].some(o => o.value === currentOutput)) outputDevice.value = currentOutput;
  devicesKnown = true;
}

async function startMonitoring(deviceId = inputDevice.value || undefined) {
  setMessage("");
  try {
    await ensureContext();

    if (stream) stopStreamOnly();

    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1
    };
    if (deviceId) audio.deviceId = { exact: deviceId };

    stream = await navigator.mediaDevices.getUserMedia({ audio });
    makeAudioGraph();

    await loadDevices();
    inputDevice.disabled = false;
    outputDevice.disabled = false;
    muteButton.disabled = false;

    startButton.textContent = "Stop monitoring";
    startButton.classList.add("running");
    setStatus("running", " monitoring");
    audioMode.textContent = "Web Audio / interactive";
    updateDiagnostics();
    drawMeter();

    if (!devicesKnown) await loadDevices();
  } catch (err) {
    console.error(err);
    stop();
    setStatus("error", " error");
    const text = err?.name === "NotAllowedError"
      ? "Microphone access was blocked. Allow microphone access and try again."
      : err?.name === "NotFoundError"
      ? "No microphone was detected."
      : "Could not start microphone monitoring: " + (err?.message || err.name || "unknown error");
    setMessage(text, true);
  }
}

function stopStreamOnly() {
  cancelAnimationFrame(raf);
  if (source) source.disconnect();
  if (gain) gain.disconnect();
  if (analyser) analyser.disconnect();
  if (stream) stream.getTracks().forEach(t => t.stop());
  source = gain = analyser = null;
  stream = null;
  clearMeter();
}

function stop() {
  stopStreamOnly();
  inputDevice.disabled = true;
  outputDevice.disabled = true;
  muteButton.disabled = true;
  startButton.textContent = "Start monitoring";
  startButton.classList.remove("running");
  setStatus("idle", " ready");
  audioMode.textContent = "Not running";
  latencyText.textContent = "—";
  routingText.textContent = "Default output";
}

async function chooseOutput(deviceId) {
  if (!ctx || ctx.state === "closed") return;
  if (!deviceId || deviceId === "default") {
    if ("setSinkId" in ctx) {
      try { await ctx.setSinkId({ type: "none" }); } catch {}
    }
    routingText.textContent = "Default output";
    return;
  }

  if (typeof ctx.setSinkId !== "function") {
    routingText.textContent = "Browser does not support output routing";
    setMessage("This browser cannot route Web Audio to a selected output. The system default output is still used.", true);
    return;
  }

  try {
    await ctx.setSinkId(deviceId);
    const label = outputDevice.selectedOptions[0]?.textContent || "Selected output";
    routingText.textContent = label;
    setMessage("");
  } catch (err) {
    console.error(err);
    routingText.textContent = "Default output";
    setMessage("That output could not be selected; using the default output.", true);
  }
}

startButton.addEventListener("click", () => {
  if (stream) stop();
  else startMonitoring();
});

volume.addEventListener("input", () => {
  const value = Number(volume.value);
  volumeText.textContent = value + "%";
  if (gain) gain.gain.setTargetAtTime(muted ? 0 : value / 100, ctx.currentTime, 0.005);
});

muteButton.addEventListener("click", () => {
  muted = !muted;
  if (gain) gain.gain.setTargetAtTime(muted ? 0 : Number(volume.value) / 100, ctx.currentTime, 0.005);
  muteButton.textContent = muted ? "Unmute monitor" : "Mute monitor";
});

inputDevice.addEventListener("change", () => {
  if (stream) startMonitoring(inputDevice.value);
});

outputDevice.addEventListener("change", () => chooseOutput(outputDevice.value));

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  if (stream) loadDevices().catch(console.error);
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.target.matches("input,select,button")) return;
  event.preventDefault();
  if (stream) stop();
  else startMonitoring();
});

if (!window.isSecureContext) {
  setMessage("Microphone access requires a secure context. GitHub Pages provides HTTPS.", true);
}

if (!navigator.mediaDevices?.getUserMedia) {
  startButton.disabled = true;
  setStatus("error", " unsupported");
  setMessage("This browser does not provide microphone access through the Web Audio API.", true);
}

window.addEventListener("beforeunload", stop);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(console.error));
}
