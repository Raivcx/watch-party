// Watch Party Room — Screenshare client (WebRTC + chat)
// Movie/YouTube rooms are handled externally via Watch2Gether — no player needed here.

const socket = io({ transports: ["websocket", "polling"] });
const roomId = window.location.pathname.split("/room/")[1]?.split("/")[0];

if (!roomId) showError("No room ID in the URL.");

const messagesEl  = document.getElementById("chat-messages");
const chatForm    = document.getElementById("chat-form");
const chatInput   = document.getElementById("chat-input");
const userCountEl = document.getElementById("user-count");
const mediaEl     = document.getElementById("media-container");
const shareBtn    = document.getElementById("start-share-btn");
const errorOverlay = document.getElementById("error-overlay");
const errorText   = document.getElementById("error-text");

let myId        = null;
let isHost      = false;
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
  el.innerHTML = `<div class="who">${socketId === myId ? "You" : socketId.slice(0, 6)}</div>${esc(text)}`;
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

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on("connect", () => {
  addSystem("Connecting to room…");
  socket.emit("join-room", roomId);
});

socket.on("connect_error", (err) => addSystem("Connection error: " + err.message));

socket.on("room-info", (info) => {
  myId   = info.yourId;
  isHost = info.isHost;
  addSystem(`Room ready · ${isHost ? "You are the host" : "You are a viewer"}`);
  if (info.type === "screenshare") {
    isHost ? setupScreenshare() : setupRTCViewer();
  }
});

socket.on("room-error",  (msg) => showError(msg));
socket.on("host-left", () => {
  errorText.textContent = "The host ended the session. This room is now closed.";
  errorOverlay.style.display = "flex";
  setTimeout(() => { window.location.href = "/"; }, 4000);
});
socket.on("chat-message", addMessage);
socket.on("user-joined", () => { updateCount(1);  addSystem("A user joined."); });
socket.on("user-left",   () => { updateCount(-1); addSystem("A user left."); });

function updateCount(delta) {
  onlineCount = Math.max(1, onlineCount + delta);
  userCountEl.textContent = `${onlineCount} online`;
}

// ── WebRTC Screen Share ───────────────────────────────────────────────────────
let localStream = null;
const peers     = {};
let rtcSetup    = false;

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function setupScreenshare() {
  if (rtcSetup) return;
  rtcSetup = true;
  setupRTCSignaling();
  shareBtn.style.display = "block";
  shareBtn.addEventListener("click", startShare);
}

function setupRTCViewer() {
  if (rtcSetup) return;
  rtcSetup = true;
  setupRTCSignaling();
  addSystem("Waiting for host stream…");
  setTimeout(() => socket.emit("rtc-request-stream"), 800);
}

function setupRTCSignaling() {
  socket.on("rtc-request-stream", ({ from }) => { if (localStream) sendOffer(from); });
  socket.on("user-joined", ({ socketId }) => { if (localStream) sendOffer(socketId); });

  socket.on("rtc-offer", async ({ from, sdp }) => {
    addSystem("Receiving stream…");
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
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* late candidate */ }
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
    video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block;";
    video.srcObject = localStream;
    mediaEl.appendChild(video);
    shareBtn.style.display = "none";
    addSystem("Sharing your screen.");

    localStream.getVideoTracks()[0].onended = () => {
      video.remove();
      localStream = null;
      shareBtn.style.display = "block";
      addSystem("Screen share ended.");
    };
  } catch {
    addSystem("Permission denied or screen share failed.");
  }
}

async function sendOffer(peerId) {
  const pc = newPC(peerId, true);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("rtc-offer", { to: peerId, sdp: offer });
}

function newPC(peerId, isHostPeer) {
  if (peers[peerId]) { peers[peerId].close(); delete peers[peerId]; }
  const pc = new RTCPeerConnection(ICE_CONFIG);
  peers[peerId] = pc;

  if (isHostPeer && localStream) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit("rtc-ice", { to: peerId, candidate });
  };

  pc.ontrack = ({ streams }) => {
    let v = document.getElementById("screen-video");
    if (v) { v.srcObject = streams[0]; return; }

    v = document.createElement("video");
    v.id = "screen-video";
    v.autoplay = true;
    v.playsInline = true;
    v.muted = false;
    v.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block;";
    v.srcObject = streams[0];
    mediaEl.appendChild(v);
    shareBtn.style.display = "none";

    const tryPlay = () =>
      v.play().catch(() => {
        const overlay = document.createElement("div");
        overlay.style.cssText =
          "position:absolute;inset:0;background:rgba(0,0,0,0.7);display:flex;flex-direction:column;" +
          "align-items:center;justify-content:center;cursor:pointer;z-index:10;";
        overlay.innerHTML =
          `<div style="font-size:64px">▶</div>` +
          `<div style="color:#fff;margin-top:12px">Click to view screen</div>`;
        overlay.addEventListener("click", () => { v.play(); overlay.remove(); });
        mediaEl.style.position = "relative";
        mediaEl.appendChild(overlay);
      });

    tryPlay();
    v.addEventListener("canplay", tryPlay, { once: true });
    addSystem("Receiving host's screen.");
  };

  return pc;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showError(msg) {
  errorText.textContent = msg;
  errorOverlay.style.display = "flex";
}
