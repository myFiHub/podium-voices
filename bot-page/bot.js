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
  let stats = { rx_bytes: 0, tx_bytes: 0, jitter_buffer_ms: 0, conference_state: "disconnected", ice_state: "new" };
  let connection = null;
  let room = null;
  let localParticipantId = null;
  let audioContext = null;
  let mixerGain = null;
  let mixerProcessor = null;
  /** Buffers mixer output so we emit exactly BRIDGE_SAMPLES_PER_FRAME (960) per frame; ScriptProcessor gives 1024 per call. */
  let mixerFloatBuffer = null;
  let mixerFloatBufferLength = 0;
  let jitterBuffer = [];
  let jitterBufferSamples = 0;
  let micDestination = null;
  let micProcessor = null;

  function setStatus(text) {
    const el = document.getElementById("status");
    if (el) el.textContent = text;
  }

  function sendToNode(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
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

  function createMicTrackFromPcm() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: BRIDGE_SAMPLE_RATE });
    micDestination = audioContext.createMediaStreamDestination();
    const bufferSize = 4096;
    micProcessor = audioContext.createScriptProcessor(bufferSize, 0, 1);
    micProcessor.onaudioprocess = function (e) {
      const out = e.outputBuffer.getChannelData(0);
      const needed = out.length;
      let written = 0;
      while (jitterBufferSamples >= needed && jitterBuffer.length > 0) {
        const chunk = jitterBuffer.shift();
        jitterBufferSamples -= chunk.length / 2;
        const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
        for (let i = 0; i < samples.length && written < needed; i++) out[written++] = samples[i] / 32768;
      }
      for (let i = written; i < needed; i++) out[i] = 0;
    };
    micProcessor.connect(micDestination);
    return micDestination.stream.getAudioTracks()[0];
  }

  function addRemoteTrackToMixer(stream) {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: BRIDGE_SAMPLE_RATE });
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
              room = connection.initJitsiConference(roomName, { startAudioOnly: true });
              room.on(window.JitsiMeetJS.events.conference.TRACK_ADDED, function (track) {
                if (track.isLocal() && track.getType() === "audio") {
                  localParticipantId = track.getParticipantId();
                  return;
                }
                if (track.getType() !== "audio") return;
                if (track.getParticipantId() === localParticipantId) return;
                try {
                  const stream = track.getOriginalStream();
                  if (stream && stream.getAudioTracks().length) addRemoteTrackToMixer(stream);
                } catch (e) {
                  console.warn("Bot: TRACK_ADDED getOriginalStream", e);
                }
              });
              room.on(window.JitsiMeetJS.events.conference.CONFERENCE_JOINED, function () {
                stats.conference_state = "joined";
                if (config.user && config.user.name) room.setDisplayName(config.user.name);
              });
              room.on(window.JitsiMeetJS.events.conference.USER_JOINED, function () {});
              room.join().then(resolve).catch(reject);
            });
            connection.addEventListener(window.JitsiMeetJS.events.connection.CONNECTION_FAILED, function (err) {
              reject(err || new Error("Connection failed"));
            });
            connection.connect();
          }).then(function () {
            var micTrack = createMicTrackFromPcm();
            var localTracks = room.getLocalParticipant().getTracks();
            var audioTrack = localTracks.filter(function (t) { return t.getType() === "audio"; })[0];
            if (audioTrack && room.replaceTrack) room.replaceTrack(audioTrack, micTrack);
            else if (room.addTrack && micTrack) room.addTrack(micTrack);
            setStatus("Joined");
            sendToNode({ type: "join_result", success: true });
          }).catch(function (err) {
            var msg = (err && err.message) ? err.message : String(err);
            sendToNode({ type: "join_result", success: false, error: msg });
            throw err;
          });
        })
        .catch(function (err) {
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
      jitterBuffer.push(new Uint8Array(frame));
      jitterBufferSamples += BRIDGE_SAMPLES_PER_FRAME;
      stats.tx_bytes += frame.byteLength;
      var ms = (jitterBufferSamples / BRIDGE_SAMPLE_RATE) * 1000;
      stats.jitter_buffer_ms = Math.round(ms);
      if (ms > JITTER_BUFFER_DROP_THRESHOLD_MS && jitterBuffer.length > 1) {
        jitterBuffer.shift();
        jitterBufferSamples -= BRIDGE_SAMPLES_PER_FRAME;
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
      if (e.data instanceof ArrayBuffer) {
        if (e.data.byteLength === BRIDGE_FRAME_BYTES) window.bot.pushMicPcmFrame(new Uint8Array(e.data));
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
        }
      } catch (err) {
        console.warn("Bot: invalid message", err);
      }
    };
  }

  connect();
})();
