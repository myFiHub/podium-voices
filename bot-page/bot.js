/**
 * Minimal bot join page: connects to Node via WebSocket, joins Jitsi using
 * lib-jitsi-meet (loaded from config.libUrl), mixes remote audio (excluding self),
 * sends 48kHz 20ms PCM to Node, and injects synthetic mic from Node PCM.
 * Protocol: 48kHz mono 16-bit, 20ms = 1920 bytes per frame.
 */

(function () {
  console.log("BOT_JS_LOADED");
  const BRIDGE_FRAME_MS = 20;
  const BRIDGE_SAMPLE_RATE = 48000;
  const BRIDGE_SAMPLES_PER_FRAME = (BRIDGE_SAMPLE_RATE * BRIDGE_FRAME_MS) / 1000;
  const BRIDGE_FRAME_BYTES = BRIDGE_SAMPLES_PER_FRAME * 2;
  /* createScriptProcessor bufferSize must be 0 or a power of 2 in [256, 16384]. 960 is invalid; use 1024 and buffer to 960-sample frames. */
  const MIXER_SCRIPT_PROCESSOR_SIZE = 1024;

  const JITTER_BUFFER_DROP_THRESHOLD_MS = 250;

  let ws = null;
  let onRemotePcmFrame = null;
  let stats = {
    rx_bytes: 0,
    /** Max absolute sample value in the last mixer frame sent to Node (0 = silence at browser). */
    mixer_max_abs: 0,
    tx_bytes: 0,
    jitter_buffer_ms: 0,
    tx_rms: 0,
    tx_frame_rms: 0,
    tx_frame_max_abs: 0,
    tx_frame_nonzero: 0,
    tx_frame_xor: 0,
    tx_out_max_abs: 0,
    tx_out_nonzero: 0,
    jb_len: 0,
    jb_samples: 0,
    jb_read_offset: 0,
    out_written: 0,
    mic_callbacks: 0,
    pc_ice_state: "",
    pc_connection_state: "",
    out_audio_bytes_sent: 0,
    conference_state: "disconnected",
    ice_state: "new"
  };
  let connection = null;
  let room = null;
  let localParticipantId = null;
  let audioContext = null;
  let mixerGain = null;
  let mixerProcessor = null;
  /** Buffers mixer output so we emit exactly BRIDGE_SAMPLES_PER_FRAME (960) per frame; ScriptProcessor gives 1024 per call. */
  let mixerFloatBuffer = null;
  let mixerFloatBufferLength = 0;
  // Jitter buffer for mic injection: holds Int16 PCM frames (960 samples each).
  let jitterBuffer = [];
  let jitterBufferSamples = 0; // total samples buffered across frames (best-effort)
  let jitterReadOffset = 0; // sample offset into jitterBuffer[0]
  let micDestination = null;
  let micProcessor = null;
  let micKeepAliveGain = null;
  let micSilenceSource = null;
  let pcStatsInterval = null;
  let lastOutboundBytesSent = 0;
  let lastInboundBytesReceived = 0;
  let lastInboundPacketsReceived = 0;
  let lastTruthProbeAt = 0;
  let sessionId = "";
  let conferenceId = "";
  let joinedAtMs = 0;
  /** Participant IDs we have already attached to the mixer (avoid duplicate streams). */
  var remoteParticipantsAdded = {};
  /** Per-participant binding info to support stats-based rebinding and pre-mixer analysis. */
  var remoteBindings = {}; // key -> { participantId, trackId, source, analyser, analyserBuf, chromeConsumeAudio? }
  /**
   * Deterministic remote-audio track selection state (prevents binding flapping during renegotiation).
   * Track IDs here refer to native receiver track ids (MediaStreamTrack.id) which we also mirror as
   * `stats.audio_inbound_track_identifier` when possible.
   */
  var rxTrackSelection = {
    selectedTrackId: "",
    candidateTrackId: "",
    candidateWins: 0,
    lastRebindAtMs: 0,
    lastCandidatesSentAtMs: 0,
  };
  // Hysteresis knobs: conservative defaults to avoid churn.
  var RX_SELECT_K = 3; // wins required to select initially
  var RX_REBIND_M = 4; // wins required to replace selection
  var RX_REBIND_COOLDOWN_MS = 4000;

  // Capture uncaught errors/rejections with as much context as the browser provides.
  // Playwright's pageerror sometimes lacks stack traces; these hooks often include them.
  try {
    window.addEventListener("error", function (event) {
      try {
        sendToNode({
          type: "page_error",
          message: event && event.message ? String(event.message) : "unknown",
          filename: event && event.filename ? String(event.filename) : "",
          lineno: event && typeof event.lineno === "number" ? event.lineno : undefined,
          colno: event && typeof event.colno === "number" ? event.colno : undefined,
          name: event && event.error && event.error.name ? String(event.error.name) : "",
          stack: event && event.error && event.error.stack ? String(event.error.stack) : "",
        });
      } catch (e) { /* ignore */ }
    });
    window.addEventListener("unhandledrejection", function (event) {
      try {
        var r = event && event.reason;
        sendToNode({
          type: "unhandled_rejection",
          message: r && r.message ? String(r.message) : String(r),
          name: r && r.name ? String(r.name) : "",
          stack: r && r.stack ? String(r.stack) : "",
        });
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }

  function setStatus(text) {
    const el = document.getElementById("status");
    if (el) el.textContent = text;
  }

  function sendToNode(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function handleBinaryMessage(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) return;
    // Normal mode: payload is exactly 1920 bytes (20ms @ 48kHz mono s16le).
    if (arrayBuffer.byteLength === BRIDGE_FRAME_BYTES) {
      window.bot.pushMicPcmFrame(new Uint8Array(arrayBuffer));
      return;
    }
    // Debug mode: [u32 seq LE][u8 xor][payload 1920 bytes]
    if (arrayBuffer.byteLength === BRIDGE_FRAME_BYTES + 5) {
      try {
        var dv = new DataView(arrayBuffer);
        var seq = dv.getUint32(0, true);
        var xorHeader = dv.getUint8(4);
        var payload = new Uint8Array(arrayBuffer, 5);
        var xorComputed = 0;
        for (var i = 0; i < payload.length; i++) xorComputed ^= payload[i];

        // Compute maxAbs/nonZero using explicit little-endian reads (contract with Node s16le).
        var dvp = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        var maxAbs = 0;
        var nonZero = 0;
        for (var off = 0; off + 2 <= payload.byteLength; off += 2) {
          var v = dvp.getInt16(off, true);
          if (v !== 0) nonZero++;
          var a = v < 0 ? -v : v;
          if (a > maxAbs) maxAbs = a;
        }
        sendToNode({ type: "frame_ack", seq: seq, xorHeader: xorHeader, xorComputed: xorComputed, maxAbs: maxAbs, nonZero: nonZero });

        // Feed to jitter buffer as normal.
        // IMPORTANT: payload.byteOffset is 5 (misaligned for Int16Array views). Copy to aligned buffer first.
        var aligned = new Uint8Array(BRIDGE_FRAME_BYTES);
        aligned.set(payload);
        window.bot.pushMicPcmFrame(aligned);
      } catch (err) {
        // ignore
      }
      return;
    }
  }

  // Debug-only WAV capture (page RX and page OUT). Ship to Node as base64 PCM.
  var saveWav = false;
  try { saveWav = (typeof window !== "undefined" && window.location && /saveWav=1/.test(window.location.search)); } catch (e) {}
  var rxPcmFrames = [];
  var outPcmFrames = [];
  var rxBytes = 0;
  var outBytes = 0;
  var maxCaptureBytes = 288000; // ~3s @ 48k mono s16le

  function int16ToBytesLE(i16) {
    var u8 = new Uint8Array(i16.length * 2);
    for (var i = 0; i < i16.length; i++) {
      var v = i16[i];
      u8[i * 2] = v & 255;
      u8[i * 2 + 1] = (v >> 8) & 255;
    }
    return u8;
  }

  function shipPcmToNode(label, u8) {
    try {
      // Convert to base64 in chunks to avoid call stack limits.
      var s = "";
      var chunk = 0x8000;
      for (var i = 0; i < u8.length; i += chunk) {
        s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
      }
      var b64 = btoa(s);
      sendToNode({ type: "wav_capture", label: label, pcm48_b64: b64 });
    } catch (e) { /* ignore */ }
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      if (window.JitsiMeetJS) return resolve();
      const script = document.createElement("script");
      script.src = url;
      script.onload = resolve;
      script.onerror = function (e) {
        reject(new Error("Failed to load Jitsi lib: " + (url || "unknown") + " (check domain and /libs/lib-jitsi-meet.min.js)"));
      };
      document.head.appendChild(script);
    });
  }

  /** Normalize domain to hostname only (no protocol, no path). */
  function domainHostOnly(d) {
    if (!d || typeof d !== "string") return d;
    return d.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || d;
  }

  /**
   * Minimal event emitter stub so Jitsi's addEventListener/removeEventListener don't throw.
   * Handlers are stored but not invoked (mute/sourceName changes could be wired later if needed).
   */
  function makeEventEmitter() {
    var listeners = {};
    return {
      addEventListener: function (event, handler) {
        if (typeof event !== "string" || typeof handler !== "function") return;
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      },
      removeEventListener: function (event, handler) {
        if (!listeners[event]) return;
        var i = listeners[event].indexOf(handler);
        if (i !== -1) listeners[event].splice(i, 1);
      },
      on: function (event, handler) { this.addEventListener(event, handler); },
      off: function (event, handler) { this.removeEventListener(event, handler); }
    };
  }

  /**
   * Wrap a native MediaStreamTrack so Jitsi APIs (replaceTrack, setSourceName, etc.) work.
   * Implements the minimum "audio local track adapter" surface Jitsi expects to avoid
   * "X is not a function" at runtime. See docs/AGENT_MUTING_AND_SPEAKING_TIME.md and consultant notes.
   */
  function wrapNativeTrackAsJitsiTrack(nativeTrack) {
    if (!nativeTrack) return null;
    if (typeof nativeTrack.getType === "function") return nativeTrack; /* already Jitsi track */

    var emitter = makeEventEmitter();
    var sourceName = "";
    var muted = false;
    var disposed = false;
    var stream = null;

    function getStream() {
      if (disposed) return null;
      if (!stream) {
        stream = new MediaStream();
        stream.addTrack(nativeTrack);
      }
      return stream;
    }

    var adapter = {
      /* --- Identity --- */
      getType: function () { return (nativeTrack.kind || "audio").toLowerCase(); },
      getVideoType: function () { return undefined; },
      isLocal: function () { return true; },
      getParticipantId: function () {
        // lib-jitsi-meet expects a non-empty participant id string; returning undefined/null/"" breaks RTP stats collection.
        var pid = localParticipantId != null ? String(localParticipantId).trim() : "";
        if (pid) return pid;
        var fallback = (adapter.getId && adapter.getId()) != null ? String(adapter.getId()).trim() : "";
        return fallback || "bot-participant";
      },
      getId: function () { return nativeTrack.id || "synthetic-" + Math.random().toString(36).slice(2); },
      getTrackId: function () { return adapter.getId(); },
      getTrack: function () { return disposed ? null : nativeTrack; },
      getOriginalTrack: function () { return adapter.getTrack(); },
      getStream: getStream,
      getOriginalStream: getStream,

      /* --- Mute lifecycle --- */
      mute: function () { muted = true; try { nativeTrack.enabled = false; } catch (e) {} },
      unmute: function () { muted = false; try { nativeTrack.enabled = true; } catch (e) {} },
      isMuted: function () { return muted; },
      setMute: function (m) { muted = !!m; try { nativeTrack.enabled = !muted; } catch (e) {} },

      /* --- Event emitter --- */
      addEventListener: function (e, h) { emitter.addEventListener(e, h); },
      removeEventListener: function (e, h) { emitter.removeEventListener(e, h); },
      on: function (e, h) { emitter.on(e, h); },
      off: function (e, h) { emitter.off(e, h); },

      /* --- Device / source metadata --- */
      getDeviceId: function () { return nativeTrack.getSettings ? (nativeTrack.getSettings().deviceId || "synthetic") : "synthetic"; },
      getLabel: function () { return nativeTrack.label || "Synthetic microphone"; },
      setSourceName: function (name) { sourceName = name == null ? "" : String(name); },
      getSourceName: function () { return sourceName; },
      setDeviceId: function () { /* no-op */ },
      isAudioTrack: function () { return (nativeTrack.kind || "audio").toLowerCase() === "audio"; },
      isVideoTrack: function () { return (nativeTrack.kind || "video").toLowerCase() === "video"; },

      /* --- Lifecycle --- */
      dispose: function () {
        if (disposed) return;
        disposed = true;
        try { console.warn("Bot: synthetic mic adapter disposed"); } catch (e) { /* ignore */ }
        try { sendToNode({ type: "track_disposed", kind: (nativeTrack && nativeTrack.kind) ? String(nativeTrack.kind) : "", id: adapter.getId && adapter.getId() }); } catch (e) { /* ignore */ }
        try { if (nativeTrack.stop) nativeTrack.stop(); } catch (e) { /* ignore */ }
        stream = null;
      },
      stop: function () { adapter.dispose(); },
      isDisposed: function () { return disposed; },
      isEnded: function () { return disposed || (nativeTrack && nativeTrack.readyState === "ended"); },

      /* --- Attach / detach --- */
      attach: function (el) {
        var s = getStream();
        if (s && el) el.srcObject = s;
        return el;
      },
      detach: function (el) {
        if (el) el.srcObject = null;
      },

      /* --- Optional: constraints / effects / audio level (stubs) --- */
      getConstraints: function () { return nativeTrack.getConstraints ? nativeTrack.getConstraints() : {}; },
      getSettings: function () { return nativeTrack.getSettings ? nativeTrack.getSettings() : {}; },
      applyConstraints: function (c) { return nativeTrack.applyConstraints ? nativeTrack.applyConstraints(c) : Promise.resolve(); },
      setEffect: function () { /* no-op */ },
      getEffect: function () { return undefined; },
      getAudioLevel: function () { return 0; },

      // Called by some lib-jitsi-meet code paths on local tracks.
      setConference: function () { /* no-op */ },
      onByteSentStatsReceived: function() { /* no-op */ },

      _nativeTrack: nativeTrack
    };

    /* Optional: in dev, wrap in Proxy to log missing method/property access (enable via ?botStrictTrack=1) */
    var params = typeof window !== "undefined" && window.location && window.location.search
      ? new URLSearchParams(window.location.search) : null;
    if (params && params.get("botStrictTrack") === "1") {
      return new Proxy(adapter, {
        get: function (target, prop) {
          if (prop in target) return target[prop];
          console.warn("[Bot Jitsi track adapter] missing access: " + String(prop));
          return undefined;
        }
      });
    }

    // IMPORTANT: Do not Proxy unknown properties in production. lib-jitsi-meet sometimes checks boolean-ish fields
    // (e.g. `track.disposed`) and a generic "no-op function" fallback is truthy, which can break internal logic.
    // Instead, keep the adapter minimal and add explicit stubs only as needed.
    return adapter;
  }

  function createMicTrackFromPcm() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: BRIDGE_SAMPLE_RATE });
    // Headless Chromium can leave AudioContext suspended without a "user gesture" in some environments.
    try {
      if (audioContext && audioContext.state === "suspended" && typeof audioContext.resume === "function") {
        audioContext.resume().catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
    micDestination = audioContext.createMediaStreamDestination();
    // Use a small power-of-2 buffer to reduce latency. (960 is invalid for ScriptProcessor.)
    const bufferSize = 1024;
    // IMPORTANT: In Chromium, ScriptProcessorNode with 0 inputs can fail to invoke onaudioprocess.
    // Provide 1 input and feed it a silent looping buffer so the callback is reliably driven.
    micProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
    try {
      const silent = audioContext.createBuffer(1, bufferSize, BRIDGE_SAMPLE_RATE);
      const src = audioContext.createBufferSource();
      src.buffer = silent;
      src.loop = true;
      micSilenceSource = src;
      src.connect(micProcessor);
      src.start(0);
    } catch (e) { /* ignore */ }
    micProcessor.onaudioprocess = function (e) {
      const out = e.outputBuffer.getChannelData(0);
      const needed = out.length;
      let written = 0;
      let sumSq = 0;
      let maxAbs = 0;
      let nonZero = 0;
      stats.mic_callbacks = (stats.mic_callbacks || 0) + 1;
      stats.jb_len = jitterBuffer.length;
      stats.jb_samples = jitterBufferSamples;
      stats.jb_read_offset = jitterReadOffset;

      // Fill output from jitter buffer, consuming frames gradually.
      while (written < needed && jitterBuffer.length > 0) {
        const frame = jitterBuffer[0]; // Int16Array
        const available = frame.length - jitterReadOffset;
        const take = Math.min(available, needed - written);
        for (let i = 0; i < take; i++) {
          const s = frame[jitterReadOffset + i] / 32768;
          out[written++] = s;
          sumSq += s * s;
          const a = Math.abs(frame[jitterReadOffset + i]);
          if (a > maxAbs) maxAbs = a;
          if (frame[jitterReadOffset + i] !== 0) nonZero++;
        }
        jitterReadOffset += take;
        jitterBufferSamples -= take;
        if (jitterReadOffset >= frame.length) {
          jitterBuffer.shift();
          jitterReadOffset = 0;
        }
      }
      // Pad remainder with zeros (silence).
      for (let i = written; i < needed; i++) out[i] = 0;

      // tx_rms is a cheap proxy: if it stays ~0 during greeting, the mic isn't receiving frames or isn't being pulled.
      const rms = written > 0 ? Math.sqrt(sumSq / written) : 0;
      stats.tx_rms = Math.round(rms * 10000) / 10000;
      stats.tx_out_max_abs = maxAbs;
      stats.tx_out_nonzero = nonZero;
      stats.out_written = written;

      if (saveWav && outBytes < maxCaptureBytes) {
        // Capture the actual float output converted to Int16.
        var i16 = new Int16Array(out.length);
        for (var k = 0; k < out.length; k++) {
          var s = Math.max(-1, Math.min(1, out[k]));
          i16[k] = (s * 32767) | 0;
        }
        var bytes = int16ToBytesLE(i16);
        outPcmFrames.push(bytes);
        outBytes += bytes.length;
        if (outBytes >= maxCaptureBytes) {
          var total = new Uint8Array(outBytes);
          var off = 0;
          for (var n = 0; n < outPcmFrames.length; n++) { total.set(outPcmFrames[n], off); off += outPcmFrames[n].length; }
          shipPcmToNode("page_out", total);
        }
      }
    };
    micProcessor.connect(micDestination);

    // Keep the audio graph alive in headless: connect through a 0-gain node to the destination.
    // Some headless/driver combos won't "pull" ScriptProcessor unless something reaches audioContext.destination.
    try {
      micKeepAliveGain = audioContext.createGain();
      micKeepAliveGain.gain.value = 0;
      micProcessor.connect(micKeepAliveGain);
      micKeepAliveGain.connect(audioContext.destination);
    } catch (e) { /* ignore */ }
    return micDestination.stream.getAudioTracks()[0];
  }

  /** Normalize participant ID for comparison (avoid type/whitespace mismatches). */
  function isSameParticipant(id1, id2) {
    return String(id1 || "").trim() === String(id2 || "").trim();
  }

  /**
   * Get a MediaStream from a Jitsi remote track for use with createMediaStreamSource.
   * Tries getStream(), getOriginalStream(), then new MediaStream([underlying track]).
   */
  function getStreamFromJitsiTrack(track) {
    if (!track) return null;
    var stream = null;
    if (typeof track.getStream === "function") {
      try { stream = track.getStream(); } catch (e) { /* ignore */ }
    }
    if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) {
      if (typeof track.getOriginalStream === "function") {
        try { stream = track.getOriginalStream(); } catch (e) { /* ignore */ }
      }
    }
    if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) {
      var underlying = (typeof track.getTrack === "function" && track.getTrack()) || track.track;
      if (underlying && underlying.kind === "audio") {
        stream = new MediaStream([underlying]);
      }
    }
    return stream && stream.getAudioTracks && stream.getAudioTracks().length ? stream : null;
  }

  /**
   * Chromium workaround (bug 933677): a remote WebRTC audio MediaStream may not feed decoded PCM
   * into Web Audio (MediaStreamAudioSourceNode / analyser / recorder) unless the same stream is
   * also "consumed" by a media element. We attach a muted <audio> element and call play() to
   * force Chrome to decode the remote track.
   */
  function createChromeRemoteAudioConsumer(stream, debugLabel) {
    try {
      if (!stream || typeof stream.getAudioTracks !== "function" || stream.getAudioTracks().length === 0) return null;
      var audio = new Audio();
      // IMPORTANT:
      // - Some Chromium builds still won't reliably decode remote WebRTC audio into Web Audio unless the
      //   MediaStream is actively rendered by a media element.
      // - In some environments, `muted=true` is treated as "not really playing" for decode purposes.
      //
      // So: keep it inaudible via volume=0, but do NOT rely solely on `muted=true`.
      audio.muted = false;
      audio.volume = 0;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.srcObject = stream;
      // Hint for debugging / leak detection.
      try { audio.setAttribute("data-bot-remote-consumer", String(debugLabel || "")); } catch (e) { /* ignore */ }
      // Some Chromium variants behave better when the element is in the DOM.
      // (No visible impact: keep it hidden.)
      try {
        audio.style.display = "none";
        var parent = document.body || document.documentElement;
        if (parent && typeof parent.appendChild === "function") {
          parent.appendChild(audio);
          audio.__botAppended = true;
        }
      } catch (e) { /* ignore */ }
      var p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(function (err) {
          // Keep this as a warning (not error): failure here is often autoplay/device related,
          // and the rest of the bot can still operate (e.g., TTS out).
          console.warn("Bot: remote audio consumer play() failed", debugLabel || "", err);
        });
      }
      return audio;
    } catch (e) {
      console.warn("Bot: could not create remote audio consumer", debugLabel || "", e);
      return null;
    }
  }

  function disposeChromeRemoteAudioConsumer(audioElem) {
    try {
      if (!audioElem) return;
      try { if (typeof audioElem.pause === "function") audioElem.pause(); } catch (e) { /* ignore */ }
      try { audioElem.srcObject = null; } catch (e) { /* ignore */ }
      // Remove from DOM if we appended it (best-effort; safe even if it wasn't appended).
      try { if (audioElem.parentNode) audioElem.parentNode.removeChild(audioElem); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }

  function addRemoteTrackToMixer(streamOrTrack, participantIdForLog) {
    var stream = null;
    var underlyingTrack = null;
    if (streamOrTrack && typeof streamOrTrack.getAudioTracks === "function" && streamOrTrack.getAudioTracks().length) {
      stream = streamOrTrack;
      underlyingTrack = stream.getAudioTracks()[0] || null;
    } else {
      stream = getStreamFromJitsiTrack(streamOrTrack);
      if (stream) underlyingTrack = stream.getAudioTracks()[0] || null;
    }
    if (!stream || !underlyingTrack) {
      console.warn("Bot: no stream or audio track for remote participant", participantIdForLog);
      return;
    }
    if (underlyingTrack.readyState === "ended") {
      console.warn("Bot: remote audio track already ended, skipping", participantIdForLog);
      return;
    }
    // Use participant id when available; otherwise fall back to track id.
    // This key is used for pre-mixer probing and for stats-based rebinding (phased negotiation).
    var bindingKey = participantIdForLog != null ? String(participantIdForLog) : ("track:" + String(underlyingTrack.id || ""));
    if (!bindingKey) bindingKey = "unknown:" + Math.random().toString(36).slice(2);

    // If we already attached something for this participant, only keep it if it is the same underlying receiver track id.
    // If the track id changed, disconnect the old nodes and attach the new one.
    try {
      var existing = remoteBindings[bindingKey];
      var newTrackId = String(underlyingTrack.id || "");
      if (existing && existing.trackId && existing.trackId === newTrackId) return;
      if (existing) {
        try { if (existing.source && typeof existing.source.disconnect === "function") existing.source.disconnect(); } catch (e) { /* ignore */ }
        try { if (existing.analyser && typeof existing.analyser.disconnect === "function") existing.analyser.disconnect(); } catch (e) { /* ignore */ }
        try { disposeChromeRemoteAudioConsumer(existing.chromeConsumeAudio); } catch (e) { /* ignore */ }
        delete remoteBindings[bindingKey];
      }
    } catch (e) { /* ignore */ }
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: BRIDGE_SAMPLE_RATE });
    try {
      if (audioContext && audioContext.state === "suspended" && typeof audioContext.resume === "function") {
        audioContext.resume().catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
    var rxAudioStartedSent = false;
    if (!mixerGain) {
      mixerGain = audioContext.createGain();
      mixerGain.gain.value = 1;
      mixerFloatBuffer = new Float32Array(MIXER_SCRIPT_PROCESSOR_SIZE + BRIDGE_SAMPLES_PER_FRAME);
      mixerFloatBufferLength = 0;
      mixerProcessor = audioContext.createScriptProcessor(MIXER_SCRIPT_PROCESSOR_SIZE, 1, 1);
      mixerProcessor.onaudioprocess = function (e) {
        const input = e.inputBuffer.getChannelData(0);
        mixerFloatBuffer.set(input, mixerFloatBufferLength);
        mixerFloatBufferLength += input.length;
        while (mixerFloatBufferLength >= BRIDGE_SAMPLES_PER_FRAME) {
          const frameBuffer = new ArrayBuffer(BRIDGE_FRAME_BYTES);
          const frameView = new Int16Array(frameBuffer);
          var frameMaxAbs = 0;
          for (let i = 0; i < BRIDGE_SAMPLES_PER_FRAME; i++) {
            const s = Math.max(-1, Math.min(1, mixerFloatBuffer[i]));
            const sample = Math.round(s * 32767);
            frameView[i] = sample;
            var a = Math.abs(sample);
            if (a > frameMaxAbs) frameMaxAbs = a;
          }
          stats.mixer_max_abs = frameMaxAbs;
          stats.rx_bytes += frameBuffer.byteLength;
          if (!rxAudioStartedSent) {
            rxAudioStartedSent = true;
            sendToNode({ type: "rx_audio_started", rx_bytes: stats.rx_bytes });
          }
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(frameBuffer);
          if (onRemotePcmFrame) onRemotePcmFrame(new Uint8Array(frameBuffer));
          mixerFloatBuffer.copyWithin(0, BRIDGE_SAMPLES_PER_FRAME, mixerFloatBufferLength);
          mixerFloatBufferLength -= BRIDGE_SAMPLES_PER_FRAME;
        }
      };
      mixerGain.connect(mixerProcessor);
      mixerProcessor.connect(audioContext.destination);
    }
    try {
      if (underlyingTrack.enabled === false) {
        underlyingTrack.enabled = true;
      }
      // Prefer the peer connection receiver's track so we wire the exact track that receives RTP.
      // Jitsi may pass a wrapper/clone with the same id; only receiver.track gets decoded audio.
      var receiverTrack = getReceiverTrackById(underlyingTrack.id);
      var trackForSource = receiverTrack || underlyingTrack;
      var boundVia = receiverTrack ? "receiver" : "wrapper";
      var streamForSource = trackForSource === underlyingTrack ? stream : new MediaStream([trackForSource]);
      // Chromium workaround: ensure remote audio is "consumed" by a media element so Web Audio gets decoded PCM.
      var chromeConsumeAudio = createChromeRemoteAudioConsumer(streamForSource, "add:" + bindingKey);
      const source = audioContext.createMediaStreamSource(streamForSource);
      // Pre-mixer analyser: lets Node distinguish \"no inbound RTP\" from \"RTP is arriving but we're mixing the wrong track\".
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0;
      const analyserBuf = new Float32Array(analyser.fftSize);
      source.connect(analyser);
      analyser.connect(mixerGain);

      remoteBindings[bindingKey] = {
        participantId: participantIdForLog != null ? String(participantIdForLog) : "",
        trackId: String(underlyingTrack.id || ""),
        boundTrackId: String(trackForSource.id || ""),
        boundVia: boundVia,
        chromeConsumeAudio: chromeConsumeAudio,
        source: source,
        analyser: analyser,
        analyserBuf: analyserBuf
      };

      if (participantIdForLog != null) {
        remoteParticipantsAdded[String(participantIdForLog)] = true;
      }
      if (receiverTrack) {
        sendToNode({ type: "receiver_track_used", track_id: String(receiverTrack.id), participantId: participantIdForLog != null ? String(participantIdForLog) : "" });
      }
      if (participantIdForLog != null) {
        sendToNode({
          type: "remote_track_added",
          participantId: String(participantIdForLog),
          track_id: String(underlyingTrack.id || ""),
          track_readyState: underlyingTrack.readyState,
          track_enabled: underlyingTrack.enabled,
          track_muted: underlyingTrack.muted === true,
          boundVia: boundVia,
          boundTrackId: String(trackForSource.id || "")
        });
      }
    } catch (err) {
      console.warn("Bot: could not connect remote track to mixer", err);
    }
  }

  /** After join, attach any remote participants' audio tracks that are already present (e.g. human joined first). */
  function attachExistingRemoteTracks() {
    if (!room || typeof room.getParticipants !== "function") return;
    var myId = localParticipantId != null ? localParticipantId : (room.myUserId && room.myUserId());
    var participants;
    try {
      participants = room.getParticipants();
    } catch (e) {
      console.warn("Bot: getParticipants", e);
      return;
    }
    if (!Array.isArray(participants)) return;
    for (var i = 0; i < participants.length; i++) {
      var p = participants[i];
      if (!p || isSameParticipant(p.getId && p.getId(), myId)) continue;
      var tracks = [];
      try {
        if (p.getTracksByMediaType) {
          var mediaType = (window.JitsiMeetJS && window.JitsiMeetJS.events && window.JitsiMeetJS.events.media && window.JitsiMeetJS.events.media.AUDIO) || "audio";
          tracks = p.getTracksByMediaType(mediaType) || [];
        }
        if (!Array.isArray(tracks) || tracks.length === 0) tracks = (p.getTracks && p.getTracks()) || [];
      } catch (e) {
        tracks = (p.getTracks && p.getTracks()) || [];
      }
      if (!Array.isArray(tracks)) continue;
      for (var j = 0; j < tracks.length; j++) {
        var track = tracks[j];
        var type = (track.getType && track.getType()) || (track.kind || "");
        if (type !== "audio") continue;
        try {
          addRemoteTrackToMixer(track, p.getId && p.getId());
        } catch (err) {
          console.warn("Bot: attachExistingRemoteTracks addRemoteTrackToMixer", err);
        }
      }
    }
  }

  /**
   * Rebind the mixer to the actual receiver track (by id or by mid) when we have inbound RTP
   * but the current binding is silent. Replaces the source/analyser for the binding that matches
   * the inbound track id, using the track from pc.getReceivers() or getTransceivers().
   */
  function rebindMixerToReceiverTrack(inboundTrackId, inboundMid) {
    if (!inboundTrackId || !mixerGain || !audioContext) return false;
    var wanted = String(inboundTrackId);
    var bindingKey = null;
    var existing = null;
    for (var k in remoteBindings) {
      if (!Object.prototype.hasOwnProperty.call(remoteBindings, k)) continue;
      var b = remoteBindings[k];
      if (b && String(b.trackId || "") === wanted) { bindingKey = k; existing = b; break; }
    }
    if (!bindingKey || !existing) return false;
    var receiverTrack = getReceiverTrackById(wanted);
    if (!receiverTrack && inboundMid) {
      var pcs = findPeerConnections();
      if (pcs && pcs.length > 0) receiverTrack = getReceiverTrackByMid(pcs[0], inboundMid);
    }
    if (!receiverTrack) return false;
    try {
      if (existing.source && typeof existing.source.disconnect === "function") existing.source.disconnect();
      if (existing.analyser && typeof existing.analyser.disconnect === "function") existing.analyser.disconnect();
      disposeChromeRemoteAudioConsumer(existing.chromeConsumeAudio);
    } catch (e) { /* ignore */ }
    var streamForSource = new MediaStream([receiverTrack]);
    var chromeConsumeAudio = createChromeRemoteAudioConsumer(streamForSource, "rebind:" + wanted);
    var source = audioContext.createMediaStreamSource(streamForSource);
    var analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0;
    var analyserBuf = new Float32Array(analyser.fftSize);
    source.connect(analyser);
    analyser.connect(mixerGain);
    remoteBindings[bindingKey] = {
      participantId: existing.participantId,
      trackId: wanted,
      boundTrackId: String(receiverTrack.id || ""),
      boundVia: "receiver",
      chromeConsumeAudio: chromeConsumeAudio,
      source: source,
      analyser: analyser,
      analyserBuf: analyserBuf
    };
    sendToNode({ type: "track_rebind_receiver", inbound_track_identifier: wanted, boundTrackId: String(receiverTrack.id) });
    return true;
  }

  /**
   * Track Binding Contract (stats-mapped): given a MediaStreamTrack.id that we believe is the active
   * inbound receiver, scan current remote participants for an audio track whose underlying native
   * track id matches and (re)attach it to the mixer.
   */
  function rebindToInboundTrackIdentifier(inboundTrackIdentifier) {
    if (!inboundTrackIdentifier || !room || typeof room.getParticipants !== "function") return false;
    var wanted = String(inboundTrackIdentifier);
    var myId = localParticipantId != null ? localParticipantId : (room.myUserId && room.myUserId());
    var participants;
    try { participants = room.getParticipants(); } catch (e) { return false; }
    if (!Array.isArray(participants)) return false;
    for (var i = 0; i < participants.length; i++) {
      var p = participants[i];
      if (!p || isSameParticipant(p.getId && p.getId(), myId)) continue;
      var tracks = [];
      try {
        if (p.getTracksByMediaType) {
          var mediaType = (window.JitsiMeetJS && window.JitsiMeetJS.events && window.JitsiMeetJS.events.media && window.JitsiMeetJS.events.media.AUDIO) || "audio";
          tracks = p.getTracksByMediaType(mediaType) || [];
        }
        if (!Array.isArray(tracks) || tracks.length === 0) tracks = (p.getTracks && p.getTracks()) || [];
      } catch (e) {
        tracks = (p.getTracks && p.getTracks()) || [];
      }
      if (!Array.isArray(tracks)) continue;
      for (var j = 0; j < tracks.length; j++) {
        var t = tracks[j];
        var type = (t.getType && t.getType()) || (t.kind || "");
        if (type !== "audio") continue;
        var underlying = (typeof t.getTrack === "function" && t.getTrack()) || t.track;
        if (underlying && underlying.kind === "audio" && String(underlying.id || "") === wanted) {
          try {
            addRemoteTrackToMixer(t, p.getId && p.getId());
            sendToNode({ type: "track_rebind", inbound_track_identifier: wanted, participantId: p.getId && p.getId(), track_id: underlying.id });
          } catch (e) { /* ignore */ }
          return true;
        }
      }
    }
    return false;
  }

  function findPeerConnections() {
    // Heuristic: search from `room` and `connection` for RTCPeerConnection-like objects.
    var pcs = [];
    var seen = typeof WeakSet !== "undefined" ? new WeakSet() : null;

    function isPcLike(o) {
      return o && typeof o === "object" &&
        typeof o.getStats === "function" &&
        typeof o.getSenders === "function" &&
        typeof o.createOffer === "function";
    }

    function walk(o, depth) {
      if (!o || typeof o !== "object" || depth > 4) return;
      try {
        if (seen) {
          if (seen.has(o)) return;
          seen.add(o);
        }
      } catch (e) { /* ignore */ }

      if (isPcLike(o)) {
        pcs.push(o);
        return;
      }

      // Walk enumerable keys only (safe + fast enough for small depth).
      for (var k in o) {
        if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
        try { walk(o[k], depth + 1); } catch (e) { /* ignore */ }
      }
    }

    try { walk(room, 0); } catch (e) { /* ignore */ }
    try { walk(connection, 0); } catch (e) { /* ignore */ }
    return pcs;
  }

  /**
   * Return the actual MediaStreamTrack from a peer connection's receiver that has the given track id.
   * Wiring this track (not a Jitsi wrapper or clone) to createMediaStreamSource ensures we get
   * decoded RTP; using a different object with the same id can leave the mixer silent.
   */
  function getReceiverTrackById(trackId) {
    if (!trackId) return null;
    var want = String(trackId);
    try {
      var pcs = findPeerConnections();
      if (!pcs || pcs.length === 0) return null;
      for (var i = 0; i < pcs.length; i++) {
        var pc = pcs[i];
        if (!pc || typeof pc.getReceivers !== "function") continue;
        var receivers = pc.getReceivers() || [];
        for (var j = 0; j < receivers.length; j++) {
          var r = receivers[j];
          if (r && r.track && r.track.kind === "audio" && String(r.track.id) === want) return r.track;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * Return the receiver's audio track for the transceiver with the given mid on the given PC.
   * Use when inbound RTP stats are tied to a mid; binding by mid avoids id mismatches.
   */
  function getReceiverTrackByMid(pc, mid) {
    if (!pc || !mid) return null;
    try {
      if (typeof pc.getTransceivers !== "function") return null;
      var transceivers = pc.getTransceivers() || [];
      var want = String(mid);
      for (var i = 0; i < transceivers.length; i++) {
        var t = transceivers[i];
        if (!t || !t.receiver || !t.receiver.track) continue;
        if (t.receiver.track.kind !== "audio") continue;
        if (String(t.mid || "") === want) return t.receiver.track;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /** Collect all audio receiver tracks from all PCs for diagnosis: { id, kind, muted, readyState }. */
  function getAllReceiverTracks() {
    var out = [];
    try {
      var pcs = findPeerConnections();
      if (!pcs || pcs.length === 0) return out;
      for (var i = 0; i < pcs.length; i++) {
        var pc = pcs[i];
        if (!pc || typeof pc.getReceivers !== "function") continue;
        var receivers = pc.getReceivers() || [];
        for (var j = 0; j < receivers.length; j++) {
          var r = receivers[j];
          if (!r || !r.track || r.track.kind !== "audio") continue;
          out.push({
            id: r.track.id,
            kind: r.track.kind,
            muted: r.track.muted === true,
            readyState: r.track.readyState || ""
          });
        }
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  function startPcStatsPoll() {
    if (pcStatsInterval) return;
    pcStatsInterval = setInterval(function () {
      try {
        var pcs = findPeerConnections();
        if (!pcs || pcs.length === 0) return;
        var pc = pcs[0];
        stats.pc_ice_state = pc.iceConnectionState || "";
        stats.pc_connection_state = pc.connectionState || "";
        pc.getStats(null).then(function (report) {
          var bytesSent = 0;
          var bytesReceived = 0;
          var packetsReceived = 0;
          var inboundTrackIdentifier = "";
          var inboundMid = "";
          var outboundTrackIdentifier = "";
          var selectedCandidatePairState = "";
          var audioTransceivers = [];
          try {
            report.forEach(function (s) {
              // outbound-rtp audio is the decisive publish check
              if (s && s.type === "outbound-rtp" && (s.kind === "audio" || s.mediaType === "audio")) {
                if (typeof s.bytesSent === "number") bytesSent = Math.max(bytesSent, s.bytesSent);
                if (!outboundTrackIdentifier && s.trackId && typeof report.get === "function") {
                  try {
                    var ots = report.get(s.trackId);
                    if (ots && typeof ots.trackIdentifier === "string") outboundTrackIdentifier = ots.trackIdentifier;
                  } catch (e) { /* ignore */ }
                }
              }
              // inbound-rtp audio is the decisive receive check
              if (s && s.type === "inbound-rtp" && (s.kind === "audio" || s.mediaType === "audio")) {
                if (typeof s.bytesReceived === "number") bytesReceived += s.bytesReceived;
                if (typeof s.packetsReceived === "number") packetsReceived += s.packetsReceived;
                if (!inboundMid && typeof s.mid === "string") inboundMid = s.mid;
                if (!inboundTrackIdentifier && s.trackId && typeof report.get === "function") {
                  try {
                    var its = report.get(s.trackId);
                    if (its && typeof its.trackIdentifier === "string") inboundTrackIdentifier = its.trackIdentifier;
                  } catch (e) { /* ignore */ }
                }
              }
              // Candidate pair state (best-effort).
              if (s && s.type === "candidate-pair") {
                var selected = (s.selected === true) || (s.nominated === true && s.state === "succeeded" && s.writable === true);
                if (selected && typeof s.state === "string") selectedCandidatePairState = s.state;
              }
            });
          } catch (e) { /* ignore */ }

          // Outbound delta (publish contract).
          var outDelta = 0;
          try { outDelta = bytesSent - lastOutboundBytesSent; } catch (e) { outDelta = 0; }
          if (outDelta < 0) outDelta = 0;
          lastOutboundBytesSent = bytesSent || lastOutboundBytesSent;
          stats.out_audio_bytes_sent = bytesSent || 0;
          stats.out_audio_bytes_sent_delta = outDelta || 0;
          stats.out_audio_track_identifier = outboundTrackIdentifier;

          // Inbound totals + deltas (receive contract).
          var inDeltaBytes = 0;
          var inDeltaPackets = 0;
          try {
            inDeltaBytes = bytesReceived - lastInboundBytesReceived;
            inDeltaPackets = packetsReceived - lastInboundPacketsReceived;
          } catch (e) { /* ignore */ }
          if (inDeltaBytes < 0) inDeltaBytes = 0;
          if (inDeltaPackets < 0) inDeltaPackets = 0;
          lastInboundBytesReceived = bytesReceived;
          lastInboundPacketsReceived = packetsReceived;
          stats.audio_inbound_bytes_received = bytesReceived;
          stats.audio_inbound_bytes_delta = inDeltaBytes;
          stats.audio_inbound_packets_received = packetsReceived;
          stats.audio_inbound_packets_delta = inDeltaPackets;
          stats.audio_inbound_track_identifier = inboundTrackIdentifier;
          stats.inbound_mid = inboundMid || "";
          stats.selected_candidate_pair_state = selectedCandidatePairState;

          // Transceivers summary (audio only).
          try {
            if (typeof pc.getTransceivers === "function") {
              var trans = pc.getTransceivers() || [];
              for (var i = 0; i < trans.length; i++) {
                var t = trans[i];
                var kind = (t && t.receiver && t.receiver.track && t.receiver.track.kind) ? t.receiver.track.kind : "";
                if (kind !== "audio") continue;
                audioTransceivers.push({
                  mid: t.mid,
                  direction: t.direction,
                  currentDirection: t.currentDirection,
                  receiverTrackId: t.receiver && t.receiver.track ? t.receiver.track.id : ""
                });
              }
            }
          } catch (e) { /* ignore */ }
          stats.audio_transceivers = audioTransceivers;

          // Fallback: derive inbound track identifier from audio transceivers when RTCStats doesn't expose trackId→trackIdentifier.
          // Prefer: match inbound-rtp.mid → transceiver.mid. Else: pick a recvonly audio transceiver (remote audio), else first.
          try {
            if (!stats.audio_inbound_track_identifier && Array.isArray(audioTransceivers) && audioTransceivers.length > 0) {
              var chosen = null;
              if (inboundMid) {
                for (var ii = 0; ii < audioTransceivers.length; ii++) {
                  var at = audioTransceivers[ii];
                  if (at && String(at.mid) === String(inboundMid) && at.receiverTrackId) { chosen = at; break; }
                }
              }
              if (!chosen) {
                for (var jj = 0; jj < audioTransceivers.length; jj++) {
                  var at2 = audioTransceivers[jj];
                  if (!at2) continue;
                  if (String(at2.currentDirection || "") === "recvonly" || String(at2.direction || "") === "recvonly") { chosen = at2; break; }
                }
              }
              if (!chosen) chosen = audioTransceivers[0];
              if (chosen && chosen.receiverTrackId) stats.audio_inbound_track_identifier = String(chosen.receiverTrackId);
            }
          } catch (e) { /* ignore */ }

          // Ensure AudioContext is running so analysers see data (e.g. after page load without user gesture).
          try {
            if (audioContext && audioContext.state === "suspended" && typeof audioContext.resume === "function") {
              audioContext.resume().catch(function () { /* ignore */ });
            }
          } catch (e) { /* ignore */ }

          // Pre-mixer maxAbs (0..32767), aggregated across attached remote sources; per-track for diagnosis.
          var preMaxAbs = 0;
          var preMixerByTrackId = {};
          try {
            for (var k in remoteBindings) {
              if (!Object.prototype.hasOwnProperty.call(remoteBindings, k)) continue;
              var b = remoteBindings[k];
              if (!b || !b.analyser || !b.analyserBuf) continue;
              try {
                b.analyser.getFloatTimeDomainData(b.analyserBuf);
                var m = 0;
                for (var n = 0; n < b.analyserBuf.length; n++) {
                  var v = b.analyserBuf[n];
                  var a = v < 0 ? -v : v;
                  if (a > m) m = a;
                }
                var abs16 = Math.round(m * 32767);
                if (b.trackId) preMixerByTrackId[String(b.trackId)] = abs16;
                if (abs16 > preMaxAbs) preMaxAbs = abs16;
              } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }
          stats.pre_mixer_max_abs = preMaxAbs;
          stats.pre_mixer_by_track_id = preMixerByTrackId;

          var now = Date.now();
          /**
           * Deterministic track selection + rebind state machine.
           * Symptoms addressed: inbound RTP present but pre-mixer silent (WRONG_TRACK), phased negotiation track churn,
           * wrapper-vs-receiver wiring mismatch, and long-running sessions beyond the old 15s window.
           */
          try {
            var inboundId = stats.audio_inbound_track_identifier ? String(stats.audio_inbound_track_identifier) : "";
            var inboundMid = stats.inbound_mid ? String(stats.inbound_mid) : "";
            var inboundDelta = stats.audio_inbound_bytes_delta || 0;

            // Build candidate list (deduped), preferring recvonly transceivers and inbound RTP identifier.
            var candMap = {};
            var candidates = [];

            function addCandidate(id, source, isRecvOnly) {
              if (!id) return;
              var sid = String(id);
              if (candMap[sid]) return;
              candMap[sid] = true;
              var energy = (stats.pre_mixer_by_track_id && stats.pre_mixer_by_track_id[sid]) ? (stats.pre_mixer_by_track_id[sid] || 0) : 0;
              candidates.push({ id: sid, energy: energy, source: source || "", recvonly: isRecvOnly === true });
            }

            // Candidate source 1: audio transceivers (recvonly are likely remote audio).
            if (Array.isArray(audioTransceivers)) {
              for (var ct = 0; ct < audioTransceivers.length; ct++) {
                var at = audioTransceivers[ct];
                if (!at || !at.receiverTrackId) continue;
                var dir = String(at.currentDirection || at.direction || "");
                var isRecvOnly = (dir === "recvonly");
                addCandidate(at.receiverTrackId, "transceiver:" + String(at.mid || ""), isRecvOnly);
              }
            }

            // Candidate source 2: known receiver tracks list (best-effort).
            var rts = getAllReceiverTracks();
            if (Array.isArray(rts)) {
              for (var rt = 0; rt < rts.length; rt++) {
                var r = rts[rt];
                if (!r || !r.id) continue;
                addCandidate(r.id, "receiver_tracks", false);
              }
            }

            // Candidate source 3: inbound RTP identifier (decisive when RTP is flowing).
            if (inboundId) addCandidate(inboundId, "inbound_rtp", true);

            // Rank candidates deterministically.
            candidates.sort(function (a, b) {
              // Hard bias: if RTP is flowing, prefer the inbound RTP track id.
              if (inboundDelta > 0) {
                var aIsInbound = (a.id === inboundId);
                var bIsInbound = (b.id === inboundId);
                if (aIsInbound !== bIsInbound) return aIsInbound ? -1 : 1;
              }
              // Prefer recvonly (remote audio) over sendrecv (often local).
              if (a.recvonly !== b.recvonly) return a.recvonly ? -1 : 1;
              // Prefer higher pre-mixer energy.
              if (a.energy !== b.energy) return (b.energy - a.energy);
              // Tie-break: keep current selection stable.
              if (rxTrackSelection.selectedTrackId) {
                if (a.id === rxTrackSelection.selectedTrackId && b.id !== rxTrackSelection.selectedTrackId) return -1;
                if (b.id === rxTrackSelection.selectedTrackId && a.id !== rxTrackSelection.selectedTrackId) return 1;
              }
              // Final tie-break: lexical.
              return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
            });

            var top = candidates.length ? candidates[0] : null;
            var topId = top ? String(top.id) : "";

            // Emit candidates telemetry at most every ~2s unless selection changes.
            if (now - (rxTrackSelection.lastCandidatesSentAtMs || 0) >= 1900) {
              rxTrackSelection.lastCandidatesSentAtMs = now;
              var top3 = candidates.slice(0, 3).map(function (c) { return { id: c.id, energy: c.energy, recvonly: c.recvonly, source: c.source }; });
              sendToNode({
                type: "track_candidates",
                ts: now,
                inbound_track_identifier: inboundId,
                inbound_mid: inboundMid,
                inbound_bytes_delta: inboundDelta,
                selected_track_id: rxTrackSelection.selectedTrackId || "",
                top: topId,
                candidates: top3
              });
            }

            // Confidence / hysteresis.
            if (topId && topId === rxTrackSelection.candidateTrackId) {
              rxTrackSelection.candidateWins = (rxTrackSelection.candidateWins || 0) + 1;
            } else {
              rxTrackSelection.candidateTrackId = topId;
              rxTrackSelection.candidateWins = topId ? 1 : 0;
            }

            var wantCommit = false;
            var isInitial = !rxTrackSelection.selectedTrackId;
            if (topId) {
              if (isInitial && rxTrackSelection.candidateWins >= RX_SELECT_K) wantCommit = true;
              if (!isInitial && topId !== rxTrackSelection.selectedTrackId && rxTrackSelection.candidateWins >= RX_REBIND_M) wantCommit = true;
            }

            if (wantCommit) {
              var prev = rxTrackSelection.selectedTrackId || "";
              rxTrackSelection.selectedTrackId = topId;
              sendToNode({
                type: "track_selected",
                ts: now,
                prev_track_id: prev,
                selected_track_id: topId,
                candidate_wins: rxTrackSelection.candidateWins,
                required_initial: RX_SELECT_K,
                required_rebind: RX_REBIND_M,
                reason: isInitial ? "initial_commit" : "rebind_commit",
                inbound_track_identifier: inboundId,
                inbound_mid: inboundMid,
                inbound_bytes_delta: inboundDelta,
                top_candidates: candidates.slice(0, 3).map(function (c) { return { id: c.id, energy: c.energy, recvonly: c.recvonly, source: c.source }; })
              });
            }

            // Apply (best-effort): ensure the selected track is attached and (if needed) rebound to receiver.
            // Avoid aggressive churn with a short cooldown.
            var sel = rxTrackSelection.selectedTrackId || "";
            if (sel) {
              var now2 = now;
              var canRebind = (now2 - (rxTrackSelection.lastRebindAtMs || 0)) > RX_REBIND_COOLDOWN_MS;

              // Find the binding for this trackId (wrapper id) if present.
              var bindingForSel = null;
              for (var bk2 in remoteBindings) {
                if (!Object.prototype.hasOwnProperty.call(remoteBindings, bk2)) continue;
                var bb2 = remoteBindings[bk2];
                if (bb2 && String(bb2.trackId || "") === sel) { bindingForSel = bb2; break; }
              }

              // If not bound yet, try to (re)attach by scanning participants for a matching underlying native track id.
              if (!bindingForSel && canRebind) {
                if (rebindToInboundTrackIdentifier(sel)) {
                  rxTrackSelection.lastRebindAtMs = now2;
                }
              }

              // If bound via wrapper (or premix is silent during active RTP), rebind to receiver track.
              bindingForSel = bindingForSel || null;
              if (bindingForSel) {
                var premixForSel = (stats.pre_mixer_by_track_id && stats.pre_mixer_by_track_id[sel]) ? (stats.pre_mixer_by_track_id[sel] || 0) : 0;
                var boundVia = String(bindingForSel.boundVia || "wrapper");
                var shouldRebindReceiver = false;
                if (boundVia === "wrapper") shouldRebindReceiver = true;
                // If RTP is flowing but premix is near-silent, attempt receiver rebind even if we *think* we're already receiver.
                if (inboundDelta > 0 && sel === inboundId && premixForSel < 200) shouldRebindReceiver = true;
                if (shouldRebindReceiver && canRebind) {
                  if (rebindMixerToReceiverTrack(sel, inboundMid)) {
                    rxTrackSelection.lastRebindAtMs = now2;
                  }
                }
              }
            }
          } catch (e) { /* ignore */ }

          // Build Phase 1 diagnostics: premixer_bindings and receiver_tracks for truth probe.
          var premixerBindings = [];
          try {
            for (var pk in remoteBindings) {
              if (!Object.prototype.hasOwnProperty.call(remoteBindings, pk)) continue;
              var pb = remoteBindings[pk];
              if (!pb) continue;
              var preAbs = (stats.pre_mixer_by_track_id && pb.trackId) ? (stats.pre_mixer_by_track_id[pb.trackId] || 0) : 0;
              premixerBindings.push({
                participantId: pb.participantId || "",
                requestedTrackId: pb.trackId || "",
                boundTrackId: pb.boundTrackId || "",
                boundVia: pb.boundVia || "wrapper",
                pre_mixer_max_abs: preAbs
              });
            }
          } catch (e) { /* ignore */ }
          var receiverTracks = getAllReceiverTracks();

          // Push truth probe to Node every ~2s (contracts rely on deltas).
          if (now - lastTruthProbeAt >= 1900) {
            lastTruthProbeAt = now;
            sendToNode({
              type: "truth_probe",
              sessionId: sessionId,
              conferenceId: conferenceId,
              ts: now,
              audio_inbound_bytes_delta: stats.audio_inbound_bytes_delta || 0,
              audio_inbound_packets_delta: stats.audio_inbound_packets_delta || 0,
              audio_inbound_track_identifier: stats.audio_inbound_track_identifier || "",
              inbound_mid: stats.inbound_mid || "",
              pre_mixer_max_abs: stats.pre_mixer_max_abs || 0,
              pre_mixer_by_track_id: stats.pre_mixer_by_track_id || {},
              premixer_bindings: premixerBindings,
              receiver_tracks: receiverTracks,
              post_mixer_max_abs: stats.mixer_max_abs || 0,
              outbound_audio_bytes_delta: stats.out_audio_bytes_sent_delta || 0,
              outbound_audio_bytes_sent: stats.out_audio_bytes_sent || 0,
              outbound_audio_track_identifier: stats.out_audio_track_identifier || "",
              selected_candidate_pair_state: stats.selected_candidate_pair_state || "",
              audio_transceivers: stats.audio_transceivers || [],
              audio_context_state: (audioContext && audioContext.state) ? String(audioContext.state) : ""
            });
          }
        }).catch(function () { /* ignore */ });
      } catch (e) { /* ignore */ }
    }, 2000);
  }

  window.bot = {
    join: function (config) {
      if (!config || typeof config !== "object") return Promise.reject(new Error("Bot join: config required"));
      const host = domainHostOnly(config.domain);
      if (!host || typeof host !== "string") return Promise.reject(new Error("Bot join: config.domain required (hostname only)"));
      const roomName = config.roomName != null ? String(config.roomName).trim() : "";
      if (!roomName) return Promise.reject(new Error("Bot join: config.roomName required"));
      try {
        sessionId = config.sessionId != null ? String(config.sessionId) : sessionId;
        conferenceId = config.conferenceId != null ? String(config.conferenceId) : roomName;
      } catch (e) { /* ignore */ }
      const xmppDomain = (config.xmppDomain != null && String(config.xmppDomain).trim()) ? String(config.xmppDomain).trim() : host;
      /* lib-jitsi-meet getRoomJid() uses hosts.muc for the MUC part of the room JID (roomName@muc).
       * If hosts.muc is missing it is undefined and .toLowerCase() throws. Default: conference.<xmppDomain>. */
      const mucDomain = (config.mucDomain != null && String(config.mucDomain).trim())
        ? String(config.mucDomain).trim()
        : "conference." + xmppDomain;
      console.log("Bot join: domain=" + host + " roomName=" + roomName + " xmppDomain=" + xmppDomain + " muc=" + mucDomain);
      const libUrl = config.libUrl || ("https://" + host + "/libs/lib-jitsi-meet.min.js");
      setStatus("Loading Jitsi lib...");
      stats.conference_state = "connecting";
      return loadScript(libUrl)
        .then(function () {
          setStatus("Joining room...");
          if (!window.JitsiMeetJS) return Promise.reject(new Error("JitsiMeetJS not found"));
          window.JitsiMeetJS.init({ disableAudioLevels: false });
          const options = {
            hosts: { domain: xmppDomain, muc: mucDomain },
            serviceUrl: "https://" + host + "/http-bind",
            clientNode: "http://jitsi.org/jitsimeet",
          };
          if (config.jwt) options.jwt = config.jwt;
          connection = new window.JitsiMeetJS.JitsiConnection(null, config.jwt || null, options);
          return new Promise(function (resolve, reject) {
            connection.addEventListener(window.JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, function () {
              // Disable P2P while debugging: P2P session-initiate timeouts can prevent stable media flow.
              room = connection.initJitsiConference(roomName, { startAudioOnly: true, p2p: { enabled: false } });
              room.on(window.JitsiMeetJS.events.conference.TRACK_ADDED, function (track) {
                var trackType = (track.getType && track.getType()) || (track.kind || "");
                var isLocal = (track.isLocal && track.isLocal());
                if (isLocal && trackType === "audio") {
                  if (track.getParticipantId) localParticipantId = track.getParticipantId();
                  return;
                }
                if (trackType !== "audio") return;
                if (isSameParticipant(track.getParticipantId && track.getParticipantId(), localParticipantId)) return;
                try {
                  var pid = track.getParticipantId && track.getParticipantId();
                  setTimeout(function () { addRemoteTrackToMixer(track, pid); }, 300);
                } catch (e) {
                  console.warn("Bot: TRACK_ADDED addRemoteTrackToMixer", e);
                }
              });
              room.on(window.JitsiMeetJS.events.conference.CONFERENCE_JOINED, function () {
                stats.conference_state = "joined";
                joinedAtMs = Date.now();
                localParticipantId = room.myUserId(); // Set local participant ID on conference join
                if (config.user && config.user.name) room.setDisplayName(config.user.name);
                resolve();
              });
              room.on(window.JitsiMeetJS.events.conference.CONFERENCE_FAILED, function (err) {
                stats.conference_state = "failed";
                reject(err || new Error("Conference failed"));
              });
              room.on(window.JitsiMeetJS.events.conference.USER_JOINED, function () {});
              room.join();
            });
            connection.addEventListener(window.JitsiMeetJS.events.connection.CONNECTION_FAILED, function (err) {
              stats.conference_state = "failed";
              reject(err || new Error("Connection failed"));
            });
            connection.connect();
          }).then(function () {
            var micTrack = createMicTrackFromPcm();
            var wrappedMic = wrapNativeTrackAsJitsiTrack(micTrack);
            // Use conference API: getLocalAudioTrack() or getLocalTracks(); support both Jitsi tracks (.getType) and native (.kind).
            var tracks = (room.getLocalTracks && room.getLocalTracks()) || [];
            var audioTrack = (room.getLocalAudioTrack && room.getLocalAudioTrack()) ||
              tracks.filter(function (t) {
                var type = (t.getType && t.getType()) || (t.kind || "");
                return type === "audio";
              })[0];
            try {
              if (audioTrack && room.replaceTrack && wrappedMic) room.replaceTrack(audioTrack, wrappedMic);
              else if (room.addTrack && wrappedMic) room.addTrack(wrappedMic);
              else throw new Error("No conference API to attach local audio track (replaceTrack/addTrack missing)");
            } catch (attachErr) {
              console.error("Bot: failed to attach synthetic mic", attachErr);
              sendToNode({ type: "join_error", error: "attach mic failed: " + (attachErr && attachErr.message ? attachErr.message : String(attachErr)) });
              throw attachErr;
            }
            setStatus("Joined");
            sendToNode({ type: "join_result", success: true });
            // Start polling WebRTC stats so Node can confirm bytesSent is increasing.
            startPcStatsPoll();
            // Attach any remote participants already in the room (e.g. human joined first). Delay so Jitsi has time to populate.
            setTimeout(function () { attachExistingRemoteTracks(); }, 1200);
          }).catch(function (err) {
            var msg = (err && err.message) ? err.message : String(err);
            sendToNode({ type: "join_result", success: false, error: msg });
            throw err;
          });
        })
        .catch(function (err) {
          stats.conference_state = "failed";
          var msg = (err && err.message) ? err.message : String(err);
          sendToNode({ type: "join_result", success: false, error: msg });
          throw err;
        });
    },

    onRemotePcmFrame: function (cb) {
      onRemotePcmFrame = cb;
    },

    pushMicPcmFrame: function (frame) {
      if (!frame || frame.byteLength !== BRIDGE_FRAME_BYTES) return;
      // IMPORTANT: Copy the frame bytes into our own buffer before storing in the jitter buffer.
      // Some browser implementations may reuse or detach the underlying WebSocket message buffer
      // after the onmessage handler returns; keeping a view can turn audio into silence later.
      var u8in = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
      var u8 = new Uint8Array(BRIDGE_FRAME_BYTES);
      u8.set(u8in);

      // Compute RMS/maxAbs/nonZero on aligned Int16Array.
      var s16 = new Int16Array(u8.buffer);
      var sumSq = 0;
      var maxAbs = 0;
      var nonZero = 0;
      var xor = 0;
      for (var b = 0; b < u8.length; b++) xor ^= u8[b];
      for (var i = 0; i < s16.length; i++) {
        var v = s16[i];
        if (v !== 0) nonZero++;
        var a = v < 0 ? -v : v;
        if (a > maxAbs) maxAbs = a;
        var x = v / 32768;
        sumSq += x * x;
      }
      var rms = Math.sqrt(sumSq / (s16.length || 1));
      stats.tx_frame_rms = Math.round(rms * 10000) / 10000;
      stats.tx_frame_max_abs = maxAbs;
      stats.tx_frame_nonzero = nonZero;
      stats.tx_frame_xor = xor;

      // Store as Int16Array view over the *copied* bytes for stable consumption in onaudioprocess.
      jitterBuffer.push(s16);
      jitterBufferSamples += s16.length;
      stats.tx_bytes += frame.byteLength;
      stats.jb_len = jitterBuffer.length;
      stats.jb_samples = jitterBufferSamples;
      stats.jb_read_offset = jitterReadOffset;
      var ms = (jitterBufferSamples / BRIDGE_SAMPLE_RATE) * 1000;
      stats.jitter_buffer_ms = Math.round(ms);
      // Drop oldest frames if we get too far behind (prefer glitch over multi-second delay).
      if (ms > JITTER_BUFFER_DROP_THRESHOLD_MS && jitterBuffer.length > 1) {
        // If we're partway through the first frame, discard it entirely to recover.
        const first = jitterBuffer.shift();
        if (first) {
          const remaining = Math.max(0, first.length - jitterReadOffset);
          jitterBufferSamples -= remaining;
        }
        jitterReadOffset = 0;
      }

      if (saveWav && rxBytes < maxCaptureBytes) {
        // Capture post-receive PCM bytes (already s16le).
        rxPcmFrames.push(u8);
        rxBytes += u8.length;
        if (rxBytes >= maxCaptureBytes) {
          var total = new Uint8Array(rxBytes);
          var off2 = 0;
          for (var m = 0; m < rxPcmFrames.length; m++) { total.set(rxPcmFrames[m], off2); off2 += rxPcmFrames[m].length; }
          shipPcmToNode("page_rx", total);
        }
      }
    },

    getStats: function () {
      return Object.assign({}, stats);
    },
  };

  function connect() {
    var params = new URLSearchParams(window.location.search);
    var wsUrl = params.get("ws") || "ws://127.0.0.1:8766/bridge";
    console.log("BOT_WS_CONNECTING", wsUrl, "from", window.location.href);
    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = function () {
      console.log("BOT_WS_OPEN");
      setStatus("Bridge connected; waiting for join...");
    };
    ws.onerror = function (e) {
      console.log("BOT_WS_ERROR", e);
      setStatus("Bridge error");
    };
    ws.onclose = function (e) {
      console.log("BOT_WS_CLOSE", e.code, e.reason);
      setStatus("Bridge closed");
    };
    ws.onmessage = function (e) {
      if (e.data instanceof ArrayBuffer) return handleBinaryMessage(e.data);
      // Some environments deliver binary frames as Blob even when binaryType="arraybuffer". Handle it explicitly.
      if (typeof Blob !== "undefined" && e.data instanceof Blob) {
        try {
          e.data.arrayBuffer().then(function (ab) { handleBinaryMessage(ab); });
        } catch (err) { /* ignore */ }
        return;
      }
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === "join" && msg.config) {
          window.bot.join(msg.config).catch(function (err) {
            console.error("Bot join failed:", err && err.message ? err.message : err);
            setStatus("Join failed: " + (err && err.message ? err.message : String(err)));
            sendToNode({ type: "join_error", error: (err && err.message) ? err.message : String(err) });
          });
        } else if (msg.type === "get_stats") {
          try {
            var s = window.bot.getStats ? window.bot.getStats() : {};
            // Include audio context state for headless debugging.
            if (audioContext && audioContext.state) s.audio_context_state = audioContext.state;
            sendToNode({ type: "stats", stats: s });
          } catch (statsErr) {
            sendToNode({ type: "stats", stats: { error: (statsErr && statsErr.message) ? statsErr.message : String(statsErr) } });
          }
        }
      } catch (err) {
        console.warn("Bot: invalid message", err);
      }
    };
  }

  connect();
})();
