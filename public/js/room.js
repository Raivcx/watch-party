// Room client — chat, YouTube sync, Pomfy iframe, WebRTC screen sharing
// Vanilla JS, no build step.

const socket = io();
const roomId = window.location.pathname.split("/room/")[1]?.split("/")[0];

if (!roomId) showError("No room ID in the URL.");

const messagesEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const userCountEl = document.getElementById("user-count");
const mediaContainer = document.getElementById("media-container");
const startShareBtn = document.getElementById("start-share-btn");
const errorOverlay = document.getElementById("error-overlay");
const errorText = document.getElementById("error-text");

let myId = null;
let ytPlayer = null;
let ytReady = false;
let suppressYTEvent = false;

// === Chat ===
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
  el.innerHTML = `<div class="who">${
    socketId === myId ? "You" : socketId.slice(0, 6)
  }</div>${escapeHtml(text)}`;
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

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// === Socket events ===
socket.on("room-info", (info) => {
  myId = info.yourId;
  setupMedia(info.type, info.media);
});

socket.on("room-error", (msg) => showError(msg));

socket.on("chat-message", addMessage);
socket.on("user-joined", () => {
  addSystem("A user joined the room.");
  updateCount(1);
});
socket.on("user-left", () => {
  addSystem("A user left the room.");
  updateCount(-1);
});

let onlineCount = 1;
function updateCount(delta) {
  onlineCount = Math.max(1, onlineCount + delta);
  userCountEl.textContent = `${onlineCount} online`;
}

// === Join the room ===
socket.emit("join-room", roomId);

// === Media setup ===
function setupMedia(type, media) {
  if (type === "movie" || type === "serie") {
    setupPomfy(media.url);
  } else if (type === "youtube") {
    setupYouTube(media.videoId);
  } else if (type === "screenshare") {
    setupScreenshare();
  }
}

// --- Pomfy iframe ---
function setupPomfy(url) {
  // Show a loading indicator while the iframe loads
  const loadMsg = document.createElement("div");
  loadMsg.id = "pomfy-loading";
  loadMsg.style.cssText = "color:#8b8ba0;font-size:14px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)";
  loadMsg.textContent = "Loading player…";
  mediaContainer.appendChild(loadMsg);

  const iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.allowFullscreen = true;
  // Do NOT use sandbox — it blocks the player's own scripts
  iframe.allow = "fullscreen; autoplay; encrypted-media; picture-in-picture";
  iframe.referrerPolicy = "no-referrer-when-downgrade";
  iframe.style.cssText = "width:100%;height:100%;border:none;";

  iframe.addEventListener("load", () => {
    loadMsg.remove();
  });

  // If iframe fails (X-Frame-Options block), show a helpful fallback
  iframe.addEventListener("error", () => {
    loadMsg.remove();
    showPomfyFallback(url);
  });

  // Fallback timer: if iframe stays blank for 8s, suggest opening directly
  const fallbackTimer = setTimeout(() => {
    if (document.getElementById("pomfy-loading")) {
      loadMsg.remove();
      showPomfyFallback(url);
    }
  }, 8000);

  iframe.addEventListener("load", () => clearTimeout(fallbackTimer));
  mediaContainer.appendChild(iframe);
}

function showPomfyFallback(url) {
  mediaContainer.innerHTML = `
    <div style="
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      text-align:center;padding:24px;max-width:420px;
    ">
      <div style="font-size:48px;margin-bottom:16px">🎬</div>
      <p style="color:#e8e8f0;font-size:16px;margin-bottom:8px">
        The player couldn't load inside the page.<br>
        This usually means the streaming site blocks iframes.
      </p>
      <p style="color:#8b8ba0;font-size:13px;margin-bottom:20px">
        Open the player in a new tab and use the chat here to sync with your friends.
      </p>
      <a href="${url}" target="_blank" rel="noopener" style="
        display:inline-block;padding:12px 24px;background:#5865f2;
        color:#fff;border-radius:8px;text-decoration:none;font-size:15px;
      ">Open Player ↗</a>
    </div>
  `;
}

// --- YouTube IFrame Player + sync ---
function setupYouTube(videoId) {
  // Load the IFrame API, then create the player
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);

  // YouTube API calls onYouTubeIframeAPIReady when ready
  window.onYouTubeIframeAPIReady = () => {
    ytPlayer = new YT.Player(undefined, {
      videoId,
      playerVars: { autoplay: 0, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          ytReady = true;
          addSystem("YouTube player ready. Sync is live.");
        },
        onStateChange: (e) => {
          if (suppressYTEvent) return;
          // 1 = playing, 2 = paused
          if (e.data === 1) {
            socket.emit("yt-action", {
              action: "play",
              time: ytPlayer.getCurrentTime(),
            });
          } else if (e.data === 2) {
            socket.emit("yt-action", {
              action: "pause",
              time: ytPlayer.getCurrentTime(),
            });
          }
        },
      },
    });
    mediaContainer.appendChild(ytPlayer.getIframe ? ytPlayer.getIframe() : ytPlayer.a);
  };

  // Listen for sync events from others
  socket.on("yt-action", (data) => {
    if (!ytReady || !ytPlayer) return;
    suppressYTEvent = true;
    if (data.action === "play") {
      ytPlayer.seekTo(data.time, true);
      ytPlayer.playVideo();
    } else if (data.action === "pause") {
      ytPlayer.seekTo(data.time, true);
      ytPlayer.pauseVideo();
    }
    // Re-enable events after a short delay
    setTimeout(() => { suppressYTEvent = false; }, 600);
  });
}

// --- WebRTC screen sharing ---
let localStream = null;
let peerConnections = {};
const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function setupScreenshare() {
  startShareBtn.style.display = "block";
  startShareBtn.addEventListener("click", startScreenShare);

  // New viewers ask existing peers for the stream
  socket.on("rtc-request-stream", ({ from }) => {
    // Only the host (who has localStream) responds with an offer
    if (localStream) {
      createPeerConnection(from, true);
    }
  });

  socket.on("rtc-offer", async ({ from, sdp }) => {
    const pc = createPeerConnection(from, false);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("rtc-answer", { to: from, sdp: answer });
  });

  socket.on("rtc-answer", async ({ from, sdp }) => {
    const pc = peerConnections[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on("rtc-ice", async ({ from, candidate }) => {
    const pc = peerConnections[from];
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) { /* ignore late ICE */ }
    }
  });

  // When someone joins, if I'm the host, offer them the stream
  socket.on("user-joined", ({ socketId }) => {
    if (localStream) {
      createPeerConnection(socketId, true);
    }
  });
}

async function startScreenShare() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    // Show it locally
    const video = document.createElement("video");
    video.id = "screen-video";
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = localStream;
    mediaContainer.appendChild(video);
    startShareBtn.style.display = "none";

    addSystem("You are now sharing your screen.");

    // Stop sharing when the user clicks the browser's "Stop sharing" button
    localStream.getVideoTracks()[0].onended = () => {
      addSystem("Screen sharing stopped.");
      startShareBtn.style.display = "block";
      video.remove();
      localStream = null;
    };
  } catch (err) {
    addSystem("Screen share permission denied or failed.");
  }
}

function createPeerConnection(remoteId, isHost) {
  // Avoid duplicate connections
  if (peerConnections[remoteId]) return peerConnections[remoteId];

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerConnections[remoteId] = pc;

  // Add local tracks (host shares screen)
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  // Receive remote stream (viewer side)
  pc.ontrack = (e) => {
    let video = document.getElementById("screen-video");
    if (!video) {
      video = document.createElement("video");
      video.id = "screen-video";
      video.autoplay = true;
      video.playsInline = true;
      mediaContainer.appendChild(video);
    }
    video.srcObject = e.streams[0];
  };

  // ICE candidates
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("rtc-ice", { to: remoteId, candidate: e.candidate });
    }
  };

  // If host, create the offer
  if (isHost) {
    pc.onnegotiationneeded = async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("rtc-offer", { to: remoteId, sdp: offer });
    };
  }

  return pc;
}

// === Error ===
function showError(msg) {
  errorText.textContent = msg;
  errorOverlay.style.display = "flex";
}
