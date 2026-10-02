
"use strict";

const $ = (id) => document.getElementById(id);

const startButton = $("start");
const status = $("status");
const message = $("message");
const inputDevice = $("inputDevice");
const outputDevice = $("outputDevice");
const mode = $("mode");
const channels = $("channels");
const volume = $("volume");
const volumeText = $("volumeText");
const muteButton = $("mute");
const meterFill = $("meterFill");
const clipMark = $("clipMark");
const levelText = $("levelText");
const meter = document.querySelector(".meter");

const audioMode = $("audioMode");
const graphInfo = $("graphInfo");
const latencyHintText = $("latencyHint");
const inputInfo = $("inputInfo");
const channelsInfo = $("channelsInfo");
const processingInfo = $("processingInfo");
const sampleRateInfo = $("sampleRateInfo");
const audioEngineInfo = $("audioEngineInfo");
const outputLatencyInfo = $("outputLatencyInfo");
const estimateText = $("estimate");
const bottleneckText = $("bottleneck");
const statsText = $("stats");
const routingText = $("routing");
const browserText = $("browserText");
const workletText = $("workletText");
const jankText = $("jankText");

const benchmarkButton = $("benchmark");
const loopbackButton = $("loopback");
const refreshStatsButton = $("refreshStats");
const benchmarkStatus = $("benchmarkStatus");
const savedProfile = $("savedProfile");
const capabilityGrid = $("capabilityGrid");

let ctx = null;
let stream = null;
let source = null;
let playbackNode = null;
let gain = null;
let analyser = null;
let workletNode = null;

let raf = 0;
let statsTimer = 0;
let adaptiveTimer = 0;
let jankTimer = 0;
let benchmarkTimer = 0;

let muted = false;
let clipUntil = 0;
let selectedOutput = "";
let workletLoaded = false;
let benchmarkRunning = false;
let loopbackRunning = false;
let adaptiveIndex = 0;
let longTaskCount = 0;
let jankSamples = [];
let lastAudioStats = null;

const ADAPTIVE_TARGETS = [0.001, 0.002, 0.003, 0.005, "interactive"];
const PROFILE_KEY = "hearytalky:profiles:v2";

function setStatus(state, text) {
  status.dataset.state = state;
  status.lastChild.textContent = " " + text;
}

function setMessage(text, error) {
  message.textContent = text || "";
  message.classList.toggle("error", Boolean(error));
}

function formatMs(seconds) {
  return Number.isFinite(seconds) ? (seconds * 1000).toFixed(1) + " ms" : "Not reported";
}

function formatHz(value) {
  return Number.isFinite(value) ? value.toLocaleString() + " Hz" : "Not reported";
}

function dbFromRms(rms) {
  return rms > 0.00001 ? 20 * Math.log10(rms) : -60;
}

function currentTarget() {
  if (mode.value === "raw") return 0.001;
  if (mode.value === "ultra") return 0.003;
  if (mode.value === "extreme") return 0.001;
  if (mode.value === "adaptive") return ADAPTIVE_TARGETS[adaptiveIndex];
  return "interactive";
}

function isLowLatencyMode() {
  return ["raw", "ultra", "extreme", "adaptive"].includes(mode.value);
}

function browserName() {
  const ua = navigator.userAgent;

  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "Chromium/Chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Unknown browser";
}

function platformName() {
  if (navigator.userAgentData && navigator.userAgentData.platform) {
    return navigator.userAgentData.platform;
  }

  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Linux/.test(ua)) return "Linux";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  return "Unknown platform";
}

function getSupportedConstraints() {
  try {
    return navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints
      ? navigator.mediaDevices.getSupportedConstraints()
      : {};
  } catch {
    return {};
  }
}

function updateBrowserProfile() {
  browserText.textContent = browserName() + " · " + platformName();
}

function addCapability(name, ok, experimental) {
  const item = document.createElement("div");
  item.className = "capability";
  item.dataset.state = ok ? "yes" : "no";

  const icon = document.createElement("span");
  icon.className = "capability-icon";
  icon.textContent = ok ? "✓" : "—";

  const label = document.createElement("span");
  label.textContent = name + (experimental ? " · experimental" : "");

  item.append(icon, label);
  capabilityGrid.appendChild(item);
}

function updateCapabilities() {
  capabilityGrid.replaceChildren();

  const supported = getSupportedConstraints();
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  addCapability(
    "getUserMedia",
    Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  );
  addCapability("AudioContext", Boolean(AudioContextCtor));
  addCapability("input latency constraint", Boolean(supported.latency));
  addCapability("channel count constraint", Boolean(supported.channelCount));
  addCapability("echo cancellation control", Boolean(supported.echoCancellation));
  addCapability("noise suppression control", Boolean(supported.noiseSuppression));
  addCapability("automatic gain control control", Boolean(supported.autoGainControl));
  addCapability(
    "AudioWorklet",
    Boolean(AudioContextCtor && window.AudioWorkletNode)
  );
  addCapability(
    "output latency telemetry",
    Boolean(
      AudioContextCtor &&
      "outputLatency" in AudioContextCtor.prototype
    )
  );
  addCapability(
    "playback statistics",
    Boolean(
      AudioContextCtor &&
      "playbackStats" in AudioContextCtor.prototype
    ),
    true
  );
  addCapability(
    "output routing",
    Boolean(AudioContextCtor && AudioContextCtor.prototype.setSinkId)
  );
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

  const db = Math.max(
    -60,
    Math.min(0, dbFromRms(Math.sqrt(sum / data.length)))
  );
  const percent = ((db + 60) / 60) * 100;

  meterFill.style.width = percent + "%";
  levelText.textContent =
    db <= -59.5 ? "-∞ dB" : db.toFixed(1) + " dB";
  meter.setAttribute("aria-valuenow", db.toFixed(1));

  if (peak >= 0.98) {
    clipUntil = performance.now() + 700;
  }

  clipMark.classList.toggle(
    "visible",
    performance.now() < clipUntil
  );

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

function stopJankMonitor() {
  clearInterval(jankTimer);
  jankTimer = 0;

  if (window.__hearytalkyLongTaskObserver) {
    try {
      window.__hearytalkyLongTaskObserver.disconnect();
    } catch {}
    window.__hearytalkyLongTaskObserver = null;
  }

  jankSamples = [];
  longTaskCount = 0;
  jankText.textContent = "Not running";
}

function startJankMonitor() {
  stopJankMonitor();

  let last = performance.now();

  jankTimer = setInterval(() => {
    const now = performance.now();
    const drift = Math.max(0, now - last - 250);

    jankSamples.push(drift);
    if (jankSamples.length > 40) jankSamples.shift();

    const avg =
      jankSamples.reduce((sum, value) => sum + value, 0) /
      Math.max(1, jankSamples.length);

    jankText.textContent =
      avg < 2 ? "good" : avg < 8 ? "moderate" : "busy";

    last = now;
  }, 250);

  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        longTaskCount += list.getEntries().length;
      });

      observer.observe({
        type: "longtask",
        buffered: true
      });

      window.__hearytalkyLongTaskObserver = observer;
    } catch {}
  }
}

function getTrackSettings() {
  const track =
    stream &&
    stream.getAudioTracks &&
    stream.getAudioTracks()[0];

  return track && track.getSettings
    ? track.getSettings()
    : {};
}

function buildMicConstraints(deviceId) {
  const supported = getSupportedConstraints();
  const audio = {};

  if (deviceId && supported.deviceId) {
    audio.deviceId = { exact: deviceId };
  }

  if (supported.echoCancellation) {
    audio.echoCancellation = false;
  }

  if (supported.noiseSuppression) {
    audio.noiseSuppression = false;
  }

  if (supported.autoGainControl) {
    audio.autoGainControl = false;
  }

  if (supported.latency) {
    const target = currentTarget();
    audio.latency = {
      ideal: typeof target === "number" ? target : 0.005
    };
  }

  if (supported.channelCount && channels.value !== "auto") {
    audio.channelCount = {
      ideal: Number(channels.value)
    };
  } else if (supported.channelCount && isLowLatencyMode()) {
    audio.channelCount = { ideal: 1 };
  }

  return {
    audio: Object.keys(audio).length ? audio : true
  };
}

async function getMicrophone(deviceId) {
  const attempts = [buildMicConstraints(deviceId)];

  if (deviceId) {
    attempts.push({
      audio: {
        deviceId: { ideal: deviceId }
      }
    });
  }

  attempts.push({ audio: true });

  let lastError;

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;

      if (
        error &&
        error.name !== "OverconstrainedError" &&
        error.name !== "NotFoundError"
      ) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Microphone could not be opened.");
}

async function createContext(trackSettings) {
  const AudioContextCtor =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error("Web Audio is not available.");
  }

  if (ctx && ctx.state !== "closed") {
    return;
  }

  const target = currentTarget();
  const rate = trackSettings && trackSettings.sampleRate;

  const preferred = {
    latencyHint: target
  };

  if (
    Number.isFinite(rate) &&
    rate >= 8000 &&
    rate <= 192000
  ) {
    preferred.sampleRate = rate;
  }

  if (selectedOutput) {
    preferred.sinkId = selectedOutput;
  }

  const attempts = [
    preferred,
    Object.assign({}, preferred, { sinkId: undefined }),
    { latencyHint: target },
    {}
  ];

  let lastError;

  for (const candidate of attempts) {
    const options = {};

    Object.keys(candidate).forEach((key) => {
      if (candidate[key] !== undefined) {
        options[key] = candidate[key];
      }
    });

    try {
      ctx = new AudioContextCtor(options);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!ctx) {
    throw lastError || new Error("Could not create the audio context.");
  }

  if (ctx.state !== "running") {
    await ctx.resume();
  }

  if (
    selectedOutput &&
    typeof ctx.setSinkId === "function"
  ) {
    try {
      await ctx.setSinkId(selectedOutput);
    } catch {}
  }
}

async function ensureWorkletModule() {
  if (workletLoaded) return;

  if (
    !ctx ||
    !ctx.audioWorklet ||
    !ctx.audioWorklet.addModule
  ) {
    throw new Error(
      "AudioWorklet is not supported in this browser."
    );
  }

  await ctx.audioWorklet.addModule(
    "latency-lab-worklet.js"
  );

  workletLoaded = true;
}

function rebuildPlaybackPath() {
  if (!source || !ctx) return;

  try {
    source.disconnect();
  } catch {}

  if (workletNode) {
    try {
      workletNode.disconnect();
    } catch {}
  }

  if (gain) {
    try {
      gain.disconnect();
    } catch {}
  }

  playbackNode = source;

  source.connect(analyser);

  if (mode.value === "worklet") {
    if (!workletNode) {
      throw new Error(
        "Worklet playback node is not ready."
      );
    }

    source.connect(workletNode);
    playbackNode = workletNode;
  }

  if (muted) {
    gain = null;
    return;
  }

  const value = Number(volume.value);

  if (Math.abs(value - 100) < 0.01) {
    playbackNode.connect(ctx.destination);
    gain = null;
    return;
  }

  gain = ctx.createGain();
  gain.gain.value = value / 100;

  playbackNode.connect(gain);
  gain.connect(ctx.destination);
}

async function makeAudioGraph() {
  source = ctx.createMediaStreamSource(stream);

  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.05;

  workletNode = null;

  if (mode.value === "worklet") {
    await ensureWorkletModule();

    workletNode = new AudioWorkletNode(
      ctx,
      "hearytalky-pass-through",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: Math.max(
          1,
          getTrackSettings().channelCount || 1
        ),
        channelCountMode: "explicit",
        channelInterpretation: "speakers"
      }
    );
  }

  rebuildPlaybackPath();
}

function applyRawControls() {
  if (mode.value === "raw") {
    volume.value = "100";
    volumeText.textContent = "100% direct";
  } else {
    volumeText.textContent = volume.value + "%";
  }
}

async function loadDevices() {
  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.enumerateDevices
  ) {
    return;
  }

  const list =
    await navigator.mediaDevices.enumerateDevices();

  const currentInput = inputDevice.value;
  const currentOutput = outputDevice.value;

  inputDevice.replaceChildren();
  outputDevice.replaceChildren();

  const inputs = list.filter(
    (device) => device.kind === "audioinput"
  );

  const outputs = list.filter(
    (device) =>
      device.kind === "audiooutput" &&
      device.deviceId !== "default"
  );

  if (!inputs.length) {
    inputDevice.add(
      new Option("No microphone detected", "")
    );
  } else {
    inputs.forEach((device, index) => {
      inputDevice.add(
        new Option(
          device.label ||
            "Microphone " + (index + 1),
          device.deviceId
        )
      );
    });
  }

  outputDevice.add(
    new Option("System default", "")
  );

  outputs.forEach((device, index) => {
    outputDevice.add(
      new Option(
        device.label || "Output " + (index + 1),
        device.deviceId
      )
    );
  });

  if (
    [...inputDevice.options].some(
      (option) => option.value === currentInput
    )
  ) {
    inputDevice.value = currentInput;
  }

  if (
    [...outputDevice.options].some(
      (option) => option.value === currentOutput
    )
  ) {
    outputDevice.value = currentOutput;
  }

  selectedOutput =
    outputDevice.value || selectedOutput || "";
}

function readPlaybackStats() {
  if (!ctx || !ctx.playbackStats) {
    return null;
  }

  const stats = ctx.playbackStats;

  lastAudioStats = stats;

  return {
    averageLatency: Number.isFinite(stats.averageLatency)
      ? stats.averageLatency
      : NaN,
    minimumLatency: Number.isFinite(stats.minimumLatency)
      ? stats.minimumLatency
      : NaN,
    maximumLatency: Number.isFinite(stats.maximumLatency)
      ? stats.maximumLatency
      : NaN,
    underrunEvents: Number.isFinite(stats.underrunEvents)
      ? stats.underrunEvents
      : NaN,
    underrunDuration: Number.isFinite(
      stats.underrunDuration
    )
      ? stats.underrunDuration
      : NaN
  };
}

function calculateLatencyParts() {
  if (!ctx) return null;

  const settings = getTrackSettings();

  const input = Number.isFinite(settings.latency)
    ? settings.latency
    : NaN;

  const audio = Number.isFinite(ctx.baseLatency)
    ? ctx.baseLatency
    : NaN;

  const output = Number.isFinite(ctx.outputLatency)
    ? ctx.outputLatency
    : NaN;

  const values = [input, audio, output].filter(
    Number.isFinite
  );

  const estimate = values.length
    ? values.reduce((a, b) => a + b, 0)
    : NaN;

  return {
    input,
    audio,
    output,
    estimate
  };
}

function updateBottleneck(parts) {
  if (!parts) {
    bottleneckText.textContent = "—";
    return;
  }

  const labels = [
    ["input", parts.input],
    ["audio engine", parts.audio],
    ["output", parts.output]
  ]
    .filter(
      (item) =>
        Number.isFinite(item[1]) &&
        item[1] > 0
    )
    .sort((a, b) => b[1] - a[1]);

  if (!labels.length) {
    bottleneckText.textContent =
      "Not enough reported data";
    return;
  }

  const total = labels.reduce(
    (sum, item) => sum + item[1],
    0
  );

  const top = labels[0];
  const share =
    total > 0
      ? Math.round((top[1] / total) * 100)
      : 0;

  bottleneckText.textContent =
    top[0] +
    " · " +
    formatMs(top[1]) +
    " · ~" +
    share +
    "% of reported path";
}

function updatePlaybackStats() {
  const stats = readPlaybackStats();

  if (!stats) {
    statsText.textContent =
      "Unavailable in this browser";
    return;
  }

  const parts = [];

  if (Number.isFinite(stats.averageLatency)) {
    parts.push(
      "avg " + formatMs(stats.averageLatency)
    );
  }

  if (Number.isFinite(stats.minimumLatency)) {
    parts.push(
      "min " + formatMs(stats.minimumLatency)
    );
  }

  if (Number.isFinite(stats.maximumLatency)) {
    parts.push(
      "max " + formatMs(stats.maximumLatency)
    );
  }

  if (Number.isFinite(stats.underrunEvents)) {
    parts.push(
      "underruns " + stats.underrunEvents
    );
  }

  statsText.textContent = parts.length
    ? parts.join(" · ")
    : "No statistics yet";
}

function updateSavedProfile() {
  const profiles = getProfiles();

  const input =
    inputDevice.selectedOptions[0]?.textContent ||
    "Microphone";

  const output =
    outputDevice.selectedOptions[0]?.textContent ||
    "System default";

  const browser = browserName();

  const found = profiles.find(
    (profile) =>
      profile.type === "benchmark" &&
      profile.input === input &&
      profile.output === output &&
      profile.browser === browser
  );

  if (!found) {
    savedProfile.textContent =
      "No saved benchmark for this device pair.";
    return;
  }

  savedProfile.textContent =
    "Last result: " +
    found.avgMs.toFixed(1) +
    " ms avg · " +
    found.underruns +
    " underruns · " +
    new Date(found.time).toLocaleString();
}

function updateDiagnostics() {
  if (!ctx) {
    audioMode.textContent = "Not running";
    graphInfo.textContent = "—";
    latencyHintText.textContent = "—";
    inputInfo.textContent = "—";
    channelsInfo.textContent = "—";
    processingInfo.textContent = "—";
    sampleRateInfo.textContent = "—";
    audioEngineInfo.textContent = "—";
    outputLatencyInfo.textContent = "—";
    estimateText.textContent = "—";
    bottleneckText.textContent = "—";
    statsText.textContent = "Not running";
    routingText.textContent = "System default";
    workletText.textContent = "Not loaded";
    return;
  }

  const settings = getTrackSettings();
  const parts = calculateLatencyParts();

  audioMode.textContent =
    mode.options[mode.selectedIndex]?.textContent ||
    mode.value;

  graphInfo.textContent =
    mode.value === "worklet"
      ? "source → AudioWorklet → output"
      : gain
      ? "source → gain → output"
      : "source → output";

  const target = currentTarget();

  latencyHintText.textContent =
    typeof target === "number"
      ? (target * 1000).toFixed(1) +
        " ms preference"
      : target;

  inputInfo.textContent = formatMs(
    parts ? parts.input : NaN
  );

  channelsInfo.textContent =
    Number.isFinite(settings.channelCount)
      ? settings.channelCount + " ch"
      : "Not reported";

  const processing = [
    ["EC", settings.echoCancellation],
    ["NS", settings.noiseSuppression],
    ["AGC", settings.autoGainControl]
  ]
    .filter(
      (item) => typeof item[1] === "boolean"
    )
    .map(
      (item) =>
        item[0] +
        ": " +
        (item[1] ? "on" : "off")
    );

  processingInfo.textContent = processing.length
    ? processing.join(" · ")
    : "Not reported";

  const inputRate = settings.sampleRate;
  const contextRate = ctx.sampleRate;

  sampleRateInfo.textContent =
    formatHz(inputRate) +
    (Number.isFinite(inputRate) &&
    inputRate === contextRate
      ? " · matched"
      : " · context " + formatHz(contextRate));

  audioEngineInfo.textContent = formatMs(
    parts ? parts.audio : NaN
  );

  outputLatencyInfo.textContent = formatMs(
    parts ? parts.output : NaN
  );

  estimateText.textContent =
    parts && Number.isFinite(parts.estimate)
      ? "~" + formatMs(parts.estimate) +
        " browser-path estimate"
      : "Not enough browser-reported data";

  updateBottleneck(parts);

  routingText.textContent =
    selectedOutput
      ? outputDevice.selectedOptions[0]?.textContent ||
        "Selected output"
      : "System default";

  workletText.textContent =
    typeof AudioWorkletNode !== "undefined"
      ? workletLoaded
        ? "available + loaded"
        : "available"
      : "unavailable";

  updatePlaybackStats();
  updateSavedProfile();
}

async function applyOutput(deviceId) {
  selectedOutput = deviceId || "";

  if (!ctx || ctx.state === "closed") {
    updateDiagnostics();
    return;
  }

  if (typeof ctx.setSinkId !== "function") {
    routingText.textContent = "Browser default";
    setMessage(
      "This browser cannot route Web Audio to a selected output. The system default output is being used.",
      true
    );
    return;
  }

  try {
    await ctx.setSinkId(selectedOutput);

    routingText.textContent =
      selectedOutput
        ? outputDevice.selectedOptions[0]?.textContent ||
          "Selected output"
        : "System default";

    setMessage("");
    updateDiagnostics();
  } catch (error) {
    console.error(error);

    selectedOutput = "";
    outputDevice.value = "";
    routingText.textContent = "System default";

    setMessage(
      "That output could not be selected; using the system default.",
      true
    );
  }
}

function clearTimers() {
  clearInterval(statsTimer);
  clearTimeout(adaptiveTimer);
  clearInterval(jankTimer);
  clearInterval(benchmarkTimer);

  statsTimer = 0;
  adaptiveTimer = 0;
  jankTimer = 0;
  benchmarkTimer = 0;
}

function closeContext() {
  if (!ctx) return;

  try {
    ctx.close();
  } catch {}

  ctx = null;
  workletLoaded = false;
}

function stopStreamOnly() {
  clearTimers();

  benchmarkRunning = false;

  if (source) {
    try { source.disconnect(); } catch {}
  }

  if (workletNode) {
    try { workletNode.disconnect(); } catch {}
  }

  if (gain) {
    try { gain.disconnect(); } catch {}
  }

  if (analyser) {
    try { analyser.disconnect(); } catch {}
  }

  if (stream) {
    stream.getTracks().forEach(
      (track) => track.stop()
    );
  }

  source = null;
  playbackNode = null;
  gain = null;
  analyser = null;
  workletNode = null;
  stream = null;

  clearMeter();
  stopJankMonitor();

  benchmarkStatus.textContent = "";
}

function stop(options) {
  const config = options || {};

  stopStreamOnly();

  inputDevice.disabled = true;
  outputDevice.disabled = false;
  mode.disabled = false;
  channels.disabled = true;
  muteButton.disabled = true;
  benchmarkButton.disabled = true;
  loopbackButton.disabled = true;
  refreshStatsButton.disabled = true;

  startButton.textContent = "Start monitoring";
  startButton.classList.remove("running");
  setStatus("idle", " ready");

  if (config.closeAudio) {
    closeContext();
  }

  updateDiagnostics();
}

function scheduleAdaptiveProbe() {
  clearTimeout(adaptiveTimer);

  if (mode.value !== "adaptive" || !stream) {
    return;
  }

  adaptiveTimer = setTimeout(async () => {
    if (!stream || mode.value !== "adaptive") {
      return;
    }

    const stats = readPlaybackStats();

    if (
      !stats ||
      !Number.isFinite(stats.underrunEvents)
    ) {
      benchmarkStatus.textContent =
        "adaptive: playback stats unavailable";
      return;
    }

    if (
      stats.underrunEvents > 0 &&
      adaptiveIndex <
        ADAPTIVE_TARGETS.length - 1
    ) {
      adaptiveIndex += 1;

      const mic =
        inputDevice.value || undefined;

      const output =
        outputDevice.value || "";

      const next = currentTarget();

      setMessage(
        "Adaptive mode detected " +
          stats.underrunEvents +
          " underrun event" +
          (stats.underrunEvents === 1
            ? ""
            : "s") +
          ". Raising the request to " +
          (typeof next === "number"
            ? (next * 1000).toFixed(1) +
              " ms."
            : next + ".")
      );

      stop({ closeAudio: true });
      selectedOutput = output;

      await startMonitoring(mic, true);
      return;
    }

    if (stats.underrunEvents > 0) {
      setMessage(
        "Adaptive mode reached its final target and still reported underruns.",
        true
      );
    } else {
      benchmarkStatus.textContent =
        "adaptive: stable at " +
        (typeof currentTarget() === "number"
          ? (currentTarget() * 1000).toFixed(1) +
            " ms request"
          : currentTarget());
    }
  }, 5000);
}

async function startMonitoring(deviceId, adaptiveRestart) {
  setMessage("");

  try {
    if (stream) {
      stopStreamOnly();
    }

    applyRawControls();

    if (
      mode.value === "adaptive" &&
      !adaptiveRestart
    ) {
      adaptiveIndex = 0;
    }

    selectedOutput =
      outputDevice.value ||
      selectedOutput ||
      "";

    stream = await getMicrophone(deviceId);

    const trackSettings =
      getTrackSettings();

    await createContext(trackSettings);
    await makeAudioGraph();
    await loadDevices();

    inputDevice.disabled = false;
    outputDevice.disabled = false;
    mode.disabled = false;
    channels.disabled = false;
    muteButton.disabled =
      mode.value === "raw";
    benchmarkButton.disabled = false;
    loopbackButton.disabled = false;
    refreshStatsButton.disabled = false;

    startButton.textContent =
      "Stop monitoring";

    startButton.classList.add("running");

    setStatus("running", " monitoring");

    updateDiagnostics();
    drawMeter();
    startJankMonitor();

    if (
      ctx.playbackStats &&
      ctx.playbackStats.resetLatency
    ) {
      try {
        ctx.playbackStats.resetLatency();
      } catch {}
    }

    updateDiagnostics();

    statsTimer = setInterval(
      updateDiagnostics,
      1000
    );

    scheduleAdaptiveProbe();
  } catch (error) {
    console.error(error);

    stop({ closeAudio: true });

    setStatus("error", " error");

    const text =
      error && error.name === "NotAllowedError"
        ? "Microphone access was blocked. Allow microphone access and try again."
        : error && error.name === "NotFoundError"
        ? "No microphone was detected."
        : error && error.name === "OverconstrainedError"
        ? "The microphone rejected a constraint. Compatible fallbacks were tried."
        : "Could not start microphone monitoring: " +
          (error &&
          (error.message || error.name)
            ? error.message || error.name
            : "unknown error");

    setMessage(text, true);
  }
}

function changeVolume(value) {
  const next = Number(value);

  if (mode.value === "raw") {
    volume.value = "100";
    volumeText.textContent = "100% direct";
    return;
  }

  volumeText.textContent = next + "%";

  if (!source || !ctx) return;

  if (gain && next < 100 && !muted) {
    gain.gain.setTargetAtTime(
      next / 100,
      ctx.currentTime,
      0.002
    );
    return;
  }

  rebuildPlaybackPath();
}

async function loadWorkletIfNeededForCalibration() {
  await ensureWorkletModule();
}

function sleep(ms) {
  return new Promise(
    (resolve) => setTimeout(resolve, ms)
  );
}

async function runBenchmark() {
  if (
    !ctx ||
    !stream ||
    benchmarkRunning
  ) {
    return;
  }

  benchmarkRunning = true;
  benchmarkButton.disabled = true;
  loopbackButton.disabled = true;

  benchmarkStatus.textContent =
    "running 10-second stability test…";

  if (
    ctx.playbackStats &&
    ctx.playbackStats.resetLatency
  ) {
    try {
      ctx.playbackStats.resetLatency();
    } catch {}
  }

  const samples = [];
  const start = performance.now();

  const initialStats =
    readPlaybackStats();

  const initialUnderruns =
    Number.isFinite(
      initialStats &&
        initialStats.underrunEvents
    )
      ? initialStats.underrunEvents
      : 0;

  while (
    benchmarkRunning &&
    performance.now() - start < 10000
  ) {
    const parts =
      calculateLatencyParts();

    const stats =
      readPlaybackStats();

    if (
      parts &&
      Number.isFinite(parts.estimate)
    ) {
      samples.push({
        estimate: parts.estimate,
        average: stats
          ? stats.averageLatency
          : NaN
      });
    }

    await sleep(250);
  }

  benchmarkRunning = false;

  benchmarkButton.disabled = !stream;
  loopbackButton.disabled = !stream;

  if (!samples.length) {
    benchmarkStatus.textContent =
      "not enough browser latency data";
    return;
  }

  const values =
    samples.map(
      (sample) => sample.estimate
    );

  const min = Math.min(...values);
  const max = Math.max(...values);

  const avg =
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length;

  const endStats =
    readPlaybackStats();

  const finalUnderruns =
    Number.isFinite(
      endStats &&
        endStats.underrunEvents
    )
      ? endStats.underrunEvents
      : initialUnderruns;

  const result = {
    type: "benchmark",
    time: new Date().toISOString(),
    browser: browserName(),
    platform: platformName(),
    input:
      inputDevice.selectedOptions[0]
        ?.textContent || "Microphone",
    output:
      outputDevice.selectedOptions[0]
        ?.textContent || "System default",
    mode: mode.value,
    minMs: min * 1000,
    avgMs: avg * 1000,
    maxMs: max * 1000,
    underruns: Math.max(
      0,
      finalUnderruns - initialUnderruns
    ),
    jank:
      jankSamples.length
        ? jankSamples.reduce(
            (sum, value) => sum + value,
            0
          ) / jankSamples.length
        : NaN,
    longTasks: longTaskCount
  };

  saveProfile(result);
  updateSavedProfile();

  benchmarkStatus.textContent =
    "10s result · " +
    result.avgMs.toFixed(1) +
    " ms avg · " +
    result.minMs.toFixed(1) +
    "–" +
    result.maxMs.toFixed(1) +
    " ms range · " +
    result.underruns +
    " new underruns";

  setMessage(
    result.underruns > 0
      ? "Benchmark found underruns. Try Adaptive mode or reduce system load."
      : "Benchmark complete. No new playback underruns were detected."
  );
}

function getProfiles() {
  try {
    return JSON.parse(
      localStorage.getItem(PROFILE_KEY) ||
        "[]"
    );
  } catch {
    return [];
  }
}

function saveProfile(profile) {
  try {
    const profiles = getProfiles();

    profiles.unshift(profile);

    while (profiles.length > 20) {
      profiles.pop();
    }

    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify(profiles)
    );
  } catch {}
}

function runLongTaskNote() {
  return longTaskCount === 0
    ? "none"
    : String(longTaskCount) + " long task(s)";
}

function waitForLoopbackHit(
  detector,
  minFrame,
  maxFrame,
  timeoutMs
) {
  return new Promise((resolve) => {
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;

      done = true;
      detector.port.onmessage = null;
      resolve(null);
    }, timeoutMs);

    detector.port.onmessage =
      (event) => {
        const data =
          event.data || {};

        if (
          data.type !== "hit" ||
          done
        ) {
          return;
        }

        done = true;
        clearTimeout(timer);
        detector.port.onmessage =
          null;

        if (
          Number.isFinite(data.frame) &&
          data.frame >= minFrame &&
          data.frame <= maxFrame
        ) {
          resolve(data);
        }
      };
  });
}

async function runLoopbackTrial() {
  await loadWorkletIfNeededForCalibration();

  const detector =
    new AudioWorkletNode(
      ctx,
      "hearytalky-peak-detector",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit"
      }
    );

  const silent =
    ctx.createGain();

  silent.gain.value = 0;

  source.connect(detector);
  detector.connect(silent);
  silent.connect(ctx.destination);

  const startTime =
    ctx.currentTime + 0.35;

  const minFrame = Math.floor(
    startTime * ctx.sampleRate
  );

  const maxFrame = Math.floor(
    (startTime + 0.5) *
      ctx.sampleRate
  );

  detector.port.postMessage({
    type: "arm",
    threshold: 0.08,
    minFrame,
    maxFrame
  });

  const buffer =
    ctx.createBuffer(
      1,
      Math.ceil(
        ctx.sampleRate * 0.01
      ),
      ctx.sampleRate
    );

  const data =
    buffer.getChannelData(0);

  data[0] = 0.12;

  const pulse =
    ctx.createBufferSource();

  pulse.buffer = buffer;
  pulse.connect(
    ctx.destination
  );
  pulse.start(startTime);

  const hit =
    await waitForLoopbackHit(
      detector,
      minFrame,
      maxFrame,
      1200
    );

  try { pulse.disconnect(); } catch {}
  try { detector.disconnect(); } catch {}
  try { silent.disconnect(); } catch {}

  if (!hit) return null;

  return {
    latencyMs:
      ((hit.frame /
        hit.sampleRate) -
        startTime) *
      1000,
    peak: hit.peak
  };
}

async function runLoopbackTest() {
  if (
    !ctx ||
    !stream ||
    loopbackRunning
  ) {
    return;
  }

  if (
    !ctx.audioWorklet
  ) {
    setMessage(
      "This browser does not support AudioWorklet calibration.",
      true
    );
    return;
  }

  loopbackRunning = true;
  loopbackButton.disabled = true;
  benchmarkButton.disabled = true;

  benchmarkStatus.textContent =
    "loopback test running…";

  const wasMuted = muted;

  muted = true;
  rebuildPlaybackPath();

  const results = [];

  try {
    for (let i = 0; i < 3; i++) {
      const result =
        await runLoopbackTrial();

      if (result) {
        results.push(
          result.latencyMs
        );
      }

      await sleep(250);
    }
  } catch (error) {
    console.error(error);
  }

  muted = wasMuted;
  rebuildPlaybackPath();

  loopbackRunning = false;
  loopbackButton.disabled = !stream;
  benchmarkButton.disabled = !stream;

  if (!results.length) {
    benchmarkStatus.textContent =
      "no loopback signal detected";

    setMessage(
      "No return signal was detected. Route the selected output back into the selected microphone for this test.",
      true
    );

    return;
  }

  results.sort(
    (a, b) => a - b
  );

  const median =
    results[
      Math.floor(results.length / 2)
    ];

  const result = {
    type: "loopback",
    time: new Date().toISOString(),
    browser: browserName(),
    platform: platformName(),
    input:
      inputDevice.selectedOptions[0]
        ?.textContent || "Microphone",
    output:
      outputDevice.selectedOptions[0]
        ?.textContent || "System default",
    mode: mode.value,
    loopbackMedianMs: median,
    loopbackTrials: results,
    longTaskCount: longTaskCount,
    uiJank: jankSamples.length
      ? jankSamples.reduce(
          (sum, value) => sum + value,
          0
        ) / jankSamples.length
      : NaN
  };

  saveProfile(result);

  benchmarkStatus.textContent =
    "loopback median · " +
    median.toFixed(1) +
    " ms · " +
    results.length +
    " successful trial(s)";

  setMessage(
    "Physical loopback estimate: " +
      median.toFixed(1) +
      " ms. This measures the configured input/output path."
  );

  updateSavedProfile();
}

async function handleModeChange() {
  applyRawControls();

  if (!stream) {
    latencyHintText.textContent =
      typeof currentTarget() === "number"
        ? (currentTarget() * 1000).toFixed(1) +
          " ms preference"
        : currentTarget();

    return;
  }

  const mic =
    inputDevice.value || undefined;

  const output =
    outputDevice.value || "";

  adaptiveIndex = 0;

  stop({ closeAudio: true });

  selectedOutput = output;

  await startMonitoring(mic);
}

async function handleChannelsChange() {
  if (!stream) return;

  const mic =
    inputDevice.value || undefined;

  const output =
    outputDevice.value || "";

  stop({ closeAudio: true });

  selectedOutput = output;

  await startMonitoring(mic);
}

async function init() {
  updateBrowserProfile();
  updateCapabilities();
  applyRawControls();
  await loadDevices();
  updateSavedProfile();

  if (!window.isSecureContext) {
    setMessage(
      "Microphone access requires a secure context. GitHub Pages provides HTTPS.",
      true
    );
  }

  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    startButton.disabled = true;
    setStatus("error", " unsupported");

    setMessage(
      "This browser does not provide microphone access through the Web Audio API.",
      true
    );
  }
}

startButton.addEventListener(
  "click",
  async () => {
    if (stream) stop();
    else await startMonitoring();
  }
);

volume.addEventListener(
  "input",
  () => changeVolume(volume.value)
);

muteButton.addEventListener(
  "click",
  () => {
    if (mode.value === "raw") return;

    muted = !muted;

    if (
      gain &&
      ctx &&
      !muted
    ) {
      gain.gain.setTargetAtTime(
        Number(volume.value) /
          100,
        ctx.currentTime,
        0.002
      );
    } else {
      rebuildPlaybackPath();
    }

    muteButton.textContent =
      muted
        ? "Unmute monitor"
        : "Mute monitor";
  }
);

inputDevice.addEventListener(
  "change",
  async () => {
    if (stream) {
      await startMonitoring(
        inputDevice.value
      );
    }
  }
);

outputDevice.addEventListener(
  "change",
  async () => {
    await applyOutput(
      outputDevice.value
    );
  }
);

mode.addEventListener(
  "change",
  handleModeChange
);

channels.addEventListener(
  "change",
  handleChannelsChange
);

benchmarkButton.addEventListener(
  "click",
  runBenchmark
);

loopbackButton.addEventListener(
  "click",
  runLoopbackTest
);

refreshStatsButton.addEventListener(
  "click",
  updateDiagnostics
);

if (
  navigator.mediaDevices &&
  navigator.mediaDevices.addEventListener
) {
  navigator.mediaDevices.addEventListener(
    "devicechange",
    () => {
      loadDevices().catch(
        console.error
      );
    }
  );
}

document.addEventListener(
  "keydown",
  async (event) => {
    if (
      event.code !== "Space" ||
      event.target.matches(
        "input,select,button"
      )
    ) {
      return;
    }

    event.preventDefault();

    if (stream) stop();
    else await startMonitoring();
  }
);

window.addEventListener(
  "beforeunload",
  () => {
    stop({ closeAudio: true });
  }
);

if ("serviceWorker" in navigator) {
  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker
        .register("sw.js")
        .catch(console.error);
    }
  );
}

init().catch((error) => {
  console.error(error);

  setMessage(
    "hearytalky could not initialize: " +
      (error.message ||
        "unknown error"),
    true
  );
});
