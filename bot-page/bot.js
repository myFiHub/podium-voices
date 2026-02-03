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

  function addRemoteTrackToMixer(stream) {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: BRIDGE_SAMPLE_RATE });
    try {
      if (audioContext && audioContext.state === "suspended" && typeof audioContext.resume === "function") {
        audioContext.resume().catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
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
          for (let i = 0; i < BRIDGE_SAMPLES_PER_FRAME; i++) {
            const s = Math.max(-1, Math.min(1, mixerFloatBuffer[i]));
            frameView[i] = s * 32767;
          }
          stats.rx_bytes += frameBuffer.byteLength;
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
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(mixerGain);
    } catch (err) {
      console.warn("Bot: could not connect remote track to mixer", err);
    }
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
          try {
            report.forEach(function (s) {
              // outbound-rtp audio is the decisive publish check
              if (s && s.type === "outbound-rtp" && (s.kind === "audio" || s.mediaType === "audio")) {
                if (typeof s.bytesSent === "number") bytesSent = Math.max(bytesSent, s.bytesSent);
              }
            });
          } catch (e) { /* ignore */ }
          stats.out_audio_bytes_sent = bytesSent || 0;
          lastOutboundBytesSent = bytesSent || lastOutboundBytesSent;
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
                if ((track.getParticipantId && track.getParticipantId()) === localParticipantId) return;
                try {
                  const stream = track.getOriginalStream();
                  if (stream && stream.getAudioTracks().length) addRemoteTrackToMixer(stream);
                } catch (e) {
                  console.warn("Bot: TRACK_ADDED getOriginalStream", e);
                }
              });
              room.on(window.JitsiMeetJS.events.conference.CONFERENCE_JOINED, function () {
                stats.conference_state = "joined";
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
