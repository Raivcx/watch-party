// Watch Party Room — Vanilla JS client
// Handles: chat, YouTube IFrame sync, Pomfy iframe, WebRTC screen sharing

const socket = io({ transports: ["websocket", "polling"] });
const roomId = window.location.pathname.split("/room/")[1]?.split("/")[0];

if (!roomId) showError("No room ID in the URL.");

const messagesEl   = document.getElementById("chat-messages");
const chatForm     = document.getElementById("chat-form");
const chatInput    = document.getElementById("chat-input");
const userCountEl  = document.getElementById("user-count");
const mediaEl      = document.getElementById("media-container");
const shareBtn     = document.getElementById("start-share-btn");
const errorOverlay = document.getElementById("error-overlay");
const errorText    = document.getElementById("error-text");

let myId = null;
let onlineCount = 1;

// ── Chat ──────────────────────────────────────────────────────────────────────
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat-message", { text });
  chatInput.value = "";
});

function addMessage({ socketId, text }) {
  const el = document.createElement("div");
  el.className = "msg" + (socketId === myId ? " self" : "");
  el.innerHTML = `<div class="who">${socketId === myId ? "You" : socketId.slice(0,6)}</div>${esc(text)}`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystem(text) {
  const el = document.createElement("div");
  el.className = "msg system";
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on("connect", () => {
  addSystem("Connected. Joining room…");
  socket.emit("join-room", roomId);
});

socket.on("connect_error", (err) => addSystem("Connection error: " + err.message));

socket.on("room-info", (info) => {
  myId = info.yourId;
  addSystem(`Room ready. Type: ${info.type}`);
  setupMedia(info.type, info.media);
});

socket.on("room-error", (msg) => showError(msg));

socket.on("chat-message", addMessage);

socket.on("user-joined", () => { updateCount(1); addSystem("A user joined."); });
socket.on("user-left",   () => { updateCount(-1); addSystem("A user left."); });

function updateCount(delta) {
  onlineCount = Math.max(1, onlineCount + delta);
  userCountEl.textContent = `${onlineCount} online`;
}

// ── Media setup ───────────────────────────────────────────────────────────────
function setupMedia(type, media) {
  if      (type === "movie" || type === "serie") setupPomfy(media.url);
  else if (type === "youtube")                   setupYouTube(media.videoId);
  else if (type === "screenshare")               setupScreenshare();
}

// ── Pomfy ─────────────────────────────────────────────────────────────────────
function setupPomfy(url) {
  const loading = document.createElement("div");
  loading.id = "pomfy-loading";
  loading.style.cssText = "color:#8b8ba0;font-size:14px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;";
  loading.innerHTML = "⏳ Carregando player…<br><small>Aguarde alguns segundos</small>";
  mediaEl.appendChild(loading);

  const iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.allowFullscreen = true;
  iframe.allow = "fullscreen; autoplay; encrypted-media; picture-in-picture";
  iframe.referrerPolicy = "no-referrer-when-downgrade";
  iframe.style.cssText = "width:100%;height:100%;border:none;position:relative;z-index:1;";

  // Remove loading on first load event
  iframe.addEventListener("load", () => loading.remove(), { once: true });

  // Fallback: if still loading after 10s, show open-in-tab option
  const timer = setTimeout(() => {
    if (document.getElementById("pomfy-loading")) {
      loading.remove();
      showPomfyFallback(url);
    }
  }, 10000);

  iframe.addEventListener("load", () => clearTimeout(timer), { once: true });
  mediaEl.appendChild(iframe);
}

function showPomfyFallback(url) {
  mediaEl.innerHTML = `
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;padding:24px;max-width:440px;">
      <div style="font-size:48px;margin-bottom:16px">🎬</div>
      <p style="color:#e8e8f0;font-size:16px;margin-bottom:8px;line-height:1.5;">
        O player não carregou dentro da página.<br>
        O site de streaming bloqueia incorporação.
      </p>
      <p style="color:#8b8ba0;font-size:13px;margin-bottom:20px;">
        Abra o player numa aba nova e use o chat aqui para sincronizar com seus amigos.
      </p>
      <a href="${url}" target="_blank" rel="noopener"
         style="display:inline-block;padding:12px 28px;background:#5865f2;color:#fff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">
        Abrir Player ↗
      </a>
    </div>`;
}

// ── YouTube (IFrame API + sync) ───────────────────────────────────────────────
let ytPlayer   = null;
let ytReady    = false;
let suppressYT = false;

function setupYouTube(videoId) {
  // Create a div placeholder that YT replaces with the iframe
  const placeholder = document.createElement("div");
  placeholder.id = "yt-player";
  placeholder.style.cssText = "width:100%;height:100%;";
  mediaEl.appendChild(placeholder);

  // Load YT IFrame API
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);

  window.onYouTubeIframeAPIReady = () => {
    ytPlayer = new YT.Player("yt-player", {
      videoId,
      width:  "100%",
      height: "100%",
      playerVars: { autoplay: 0, rel: 0, modestbranding: 1 },
      events: {
        onReady() {
          ytReady = true;
          addSystem("YouTube player pronto. Sincronização ativa.");
        },
        onStateChange(e) {
          if (suppressYT || !ytReady) return;
          const t = ytPlayer.getCurrentTime();
          if      (e.data === YT.PlayerState.PLAYING) socket.emit("yt-action", { action: "play",  time: t });
          else if (e.data === YT.PlayerState.PAUSED)  socket.emit("yt-action", { action: "pause", time: t });
        },
      },
    });
  };

  socket.on("yt-action", ({ action, time }) => {
    if (!ytReady || !ytPlayer) return;
    suppressYT = true;
    ytPlayer.seekTo(time, true);
    if (action === "play")  ytPlayer.playVideo();
    if (action === "pause") ytPlayer.pauseVideo();
    setTimeout(() => { suppressYT = false; }, 800);
  });
}

// ── WebRTC Screen Share ───────────────────────────────────────────────────────
let localStream = null;
const peers = {};
let rtcSetup = false; // guard against double-setup
const ICE = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
] };

function setupScreenshare() {
  if (rtcSetup) return;
  rtcSetup = true;

  shareBtn.style.display = "block";
  shareBtn.addEventListener("click", startShare);

  // Viewer requests stream AFTER room-info confirms we're fully joined.
  // Small delay lets the host process our user-joined event first.
  setTimeout(() => socket.emit("rtc-request-stream"), 800);

  // Host receives a stream request from a viewer
  socket.on("rtc-request-stream", ({ from }) => {
    if (localStream) {
      addSystem(`Enviando stream para ${from.slice(0,6)}…`);
      sendOffer(from);
    }
  });

  // Host receives a new user: send them the stream if sharing
  socket.on("user-joined", ({ socketId }) => {
    if (localStream) {
      addSystem(`Novo usuário entrou — enviando stream…`);
      sendOffer(socketId);
    }
  });

  // Viewer receives offer from host
  socket.on("rtc-offer", async ({ from, sdp }) => {
    addSystem("Recebendo stream…");
    const pc = newPC(from, false);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("rtc-answer", { to: from, sdp: answer });
  });

  socket.on("rtc-answer", async ({ from, sdp }) => {
    const pc = peers[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on("rtc-ice", async ({ from, candidate }) => {
    const pc = peers[from];
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch { /* late ICE */ }
  });
}

async function startShare() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const video = document.createElement("video");
    video.id = "screen-video";
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;";
    video.srcObject = localStream;
    mediaEl.appendChild(video);
    shareBtn.style.display = "none";
    addSystem("Compartilhando sua tela.");
    localStream.getVideoTracks()[0].onended = () => {
      video.remove();
      localStream = null;
      shareBtn.style.display = "block";
      addSystem("Compartilhamento encerrado.");
    };
  } catch {
    addSystem("Permissão de tela negada ou falhou.");
  }
}

async function sendOffer(peerId) {
  const pc = newPC(peerId, true);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("rtc-offer", { to: peerId, sdp: offer });
}

function newPC(peerId, isHost) {
  if (peers[peerId]) { peers[peerId].close(); delete peers[peerId]; }
  const pc = new RTCPeerConnection(ICE);
  peers[peerId] = pc;

  if (isHost && localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit("rtc-ice", { to: peerId, candidate });
  };

  pc.ontrack = ({ streams }) => {
    // Remove duplicate handlers — only set up video once
    let v = document.getElementById("screen-video");
    if (v) { v.srcObject = streams[0]; return; }

    v = document.createElement("video");
    v.id = "screen-video";
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true; // must be muted for autoplay policy
    v.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block;";
    v.srcObject = streams[0];
    mediaEl.appendChild(v);
    shareBtn.style.display = "none";

    // Force play — browsers block autoplay on remote streams without user gesture
    const tryPlay = () => {
      v.play().catch(() => {
        // Autoplay blocked: show a click-to-play overlay
        const overlay = document.createElement("div");
        overlay.id = "play-overlay";
        overlay.style.cssText = `
          position:absolute;inset:0;background:rgba(0,0,0,0.7);
          display:flex;flex-direction:column;align-items:center;
          justify-content:center;cursor:pointer;z-index:10;
        `;
        overlay.innerHTML = `
          <div style="font-size:64px">▶</div>
          <div style="color:#fff;font-size:16px;margin-top:12px;">Clique para ver a tela</div>
        `;
        overlay.addEventListener("click", () => {
          v.play();
          overlay.remove();
        });
        mediaEl.style.position = "relative";
        mediaEl.appendChild(overlay);
      });
    };

    // Try immediately, then again on canplay
    tryPlay();
    v.addEventListener("canplay", tryPlay, { once: true });

    addSystem("Recebendo tela do host.");
  };

  return pc;
}

// ── Error ─────────────────────────────────────────────────────────────────────
function showError(msg) {
  errorText.textContent = msg;
  errorOverlay.style.display = "flex";
}
