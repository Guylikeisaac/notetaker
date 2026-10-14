// Injected into the Meet page before any Meet script runs. Wraps
// RTCPeerConnection so every remote audio track is mixed into one 16 kHz mono
// stream, converted to 16-bit PCM and handed to the worker via the exposed
// `__notetakerAudio` binding. The bot never publishes audio or video itself.
//
// Kept as a plain JS string rather than a function: tsx/esbuild inject helpers
// like `__name` into compiled functions, which don't exist inside the page.
export const AUDIO_CAPTURE_SCRIPT = String.raw`
(() => {
  if (window.__notetakerInstalled) return;
  window.__notetakerInstalled = true;

  const Native = window.RTCPeerConnection;
  let ctx = null;
  let mixer = null;
  // Chrome only feeds remote WebRTC audio into WebAudio while the stream is
  // also attached to a media element, so keep a muted one per track.
  const sinks = new Set();
  const remoteStreams = [];
  // Used only if tab capture fails: mix the raw WebRTC tracks instead.
  window.__notetakerUseTrackFallback = () => {
    ensureGraph();
    for (const st of remoteStreams) ctx.createMediaStreamSource(st).connect(mixer);
    console.log("[notetaker] using WebRTC track fallback", remoteStreams.length);
  };

  function toBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function ensureGraph() {
    if (ctx) return;
    ctx = new AudioContext({ sampleRate: 16000 });
    mixer = ctx.createGain();
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    mixer.connect(proc);
    proc.connect(ctx.destination);
    proc.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      ev.outputBuffer.getChannelData(0).fill(0);
      const pcm = new Int16Array(input.length);
      let peak = 0;
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        const a = Math.abs(s);
        if (a > peak) peak = a;
      }
      if (window.__notetakerAudio) window.__notetakerAudio(toBase64(new Uint8Array(pcm.buffer)), peak);
    };
  }

  // Second path: Meet plays every remote stream through its own <audio>
  // elements. Tapping those avoids Chrome's quirk where a raw remote track
  // piped straight into WebAudio stays silent.
  const tapped = new WeakSet();
  setInterval(() => {
    const els = document.querySelectorAll("audio, video");
    for (const el of els) {
      const stream = el.srcObject;
      if (!stream || tapped.has(stream) || stream.getAudioTracks().length === 0) continue;
      tapped.add(stream);
      ensureGraph();
      ctx.createMediaStreamSource(stream).connect(mixer);
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      console.log("[notetaker] tapped media element", el.tagName, stream.getAudioTracks().length);
    }
  }, 2000);

  // Most reliable path: capture everything this tab plays (the mixed call
  // audio). Called by the worker with a synthetic user gesture after joining;
  // Chrome auto-accepts via --auto-accept-this-tab-capture.
  window.__notetakerStartTabCapture = async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      // Only used for the recording; 720p at 15 fps keeps the encoder cheap.
      video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 15 } },
      audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    });
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) throw new Error("tab capture returned no audio track");
    window.__notetakerTabStream = stream;
    ensureGraph();
    ctx.createMediaStreamSource(new MediaStream(tracks)).connect(mixer);
    if (ctx.state === "suspended") await ctx.resume();
    console.log("[notetaker] tab capture started, ctx", ctx.state);
    return "ok";
  };

  // Recording: MediaRecorder on the tab capture (video mode) or on the mixed
  // call audio (audio mode, or when tab capture failed). Chunks go to the
  // worker through the exposed __notetakerRecording binding, in order.
  let recorder = null;
  let flushed = Promise.resolve();
  window.__notetakerStartRecording = (mode) => {
    if (recorder) return recorder.mimeType;
    const tab = window.__notetakerTabStream;
    let stream;
    if (mode === "video" && tab && tab.getVideoTracks().some((t) => t.readyState === "live")) {
      stream = tab;
    } else {
      ensureGraph();
      const dest = ctx.createMediaStreamDestination();
      mixer.connect(dest);
      stream = dest.stream;
    }
    const video = stream.getVideoTracks().length > 0;
    recorder = new MediaRecorder(stream, {
      mimeType: video ? "video/webm;codecs=vp8,opus" : "audio/webm;codecs=opus",
      videoBitsPerSecond: 600000,
      audioBitsPerSecond: 64000,
    });
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      flushed = flushed
        .then(async () => window.__notetakerRecording(toBase64(new Uint8Array(await e.data.arrayBuffer()))))
        .catch((err) => console.log("[notetaker] recording chunk lost", String(err)));
    };
    recorder.start(5000);
    console.log("[notetaker] recording started", recorder.mimeType);
    return recorder.mimeType;
  };
  // Resolves once the final chunk has reached the worker.
  window.__notetakerStopRecording = () =>
    new Promise((resolve) => {
      if (!recorder || recorder.state === "inactive") return flushed.then(() => resolve("inactive"));
      recorder.onstop = () => setTimeout(() => flushed.then(() => resolve("stopped")), 0);
      recorder.stop();
    });

  console.log("[notetaker] capture installed");
  function Wrapped(...args) {
    const pc = new Native(...args);
    pc.addEventListener("track", (e) => {
      console.log("[notetaker] track", e.track.kind, e.track.readyState, e.track.muted);
      if (e.track.kind !== "audio") return;
      ensureGraph();
      const stream = new MediaStream([e.track]);
      const sink = new Audio();
      // volume 0 rather than muted: Chrome doesn't pull data for muted elements.
      sink.volume = 0;
      sink.srcObject = stream;
      sink.play().catch(() => {});
      sinks.add(sink);
      remoteStreams.push(stream);
      e.track.addEventListener("unmute", () => console.log("[notetaker] remote audio unmuted (someone is sending audio)"));
      e.track.addEventListener("ended", () => sinks.delete(sink));
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      console.log("[notetaker] remote audio track seen, ctx", ctx.state);
    });
    return pc;
  }
  Wrapped.prototype = Native.prototype;
  Object.setPrototypeOf(Wrapped, Native);
  window.RTCPeerConnection = Wrapped;
})();
`;
