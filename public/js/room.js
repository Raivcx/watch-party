// Watch Party Room — Vanilla JS client
// Media: HLS.js player (movie/serie via TMDB-Embed-API), YouTube sync, WebRTC screenshare

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

let myId      = null;
let isHost    = false;
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

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on("connect", () => {
  addSystem("Conectando à sala…");
  socket.emit("join-room", roomId);
});

socket.on("connect_error", (err) => addSystem("Erro de conexão: " + err.message));

socket.on("room-info", (info) => {
  myId   = info.yourId;
  isHost = info.isHost;
  addSystem(`Sala pronta · ${isHost ? "Você é o host" : "Você é viewer"}`);
  setupMedia(info.type, info.media);
});

socket.on("room-error",  (msg) => showError(msg));
socket.on("host-left",   () => {
  errorText.textContent = "O host encerrou a sessão. Esta sala foi fechada.";
  errorOverlay.style.display = "flex";
  setTimeout(() => { window.location.href = "/"; }, 4000);
});
socket.on("chat-message", addMessage);
socket.on("user-joined", () => { updateCount(1);  addSystem("Um usuário entrou."); });
socket.on("user-left",   () => { updateCount(-1); addSystem("Um usuário saiu."); });

function updateCount(delta) {
  onlineCount = Math.max(1, onlineCount + delta);
  userCountEl.textContent = `${onlineCount} online`;
}

// ── Media router ──────────────────────────────────────────────────────────────
function setupMedia(type, media) {
  if (type === "movie" || type === "serie") setupHLS(type, media);
  else if (type === "youtube")             setupYouTube(media.videoId);
  else if (type === "screenshare")         isHost ? setupScreenshare() : setupRTCViewer();
}

// ── HLS Player (movie / serie via TMDB-Embed-API) ─────────────────────────────
let hlsVideo = null;
let suppressVideoEvents = false;

async function setupHLS(type, media) {
  // Loading state
  const loading = showLoadingOverlay("🔍 Buscando streams…");

  let streams;
  try {
    const res = await fetch(`/api/streams/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    streams = await res.json();
  } catch (err) {
    loading.remove();
    showNoStreamsOverlay(media);
    addSystem("Erro ao buscar streams: " + err.message);
    return;
  }

  if (!streams || streams.length === 0) {
    loading.remove();
    showNoStreamsOverlay(media);
    addSystem("Nenhum stream encontrado para este título.");
    return;
  }

  loading.remove();

  // Build video element
  const video = document.createElement("video");
  video.id = "hls-video";
  video.controls = true;
  video.style.cssText = "width:100%;height:100%;background:#000;display:block;";
  mediaEl.appendChild(video);
  hlsVideo = video;

  // Informa no chat qual tipo de stream foi selecionado
  const best = streams[0];
  const ptbrLabel = ptbrBadge(best);
  addSystem(`▶ ${best.title || best.quality || "stream"} ${ptbrLabel}`.trim());

  // Quality selector overlay
  buildQualityBar(streams, video, media);

  // Load best stream (já ordenado com PT-BR no topo pelo servidor)
  loadStream(streams[0], video);

  // Sync controls (host broadcasts, viewers follow)
  setupVideoSync(video);

  // Subtitles — PT-BR selecionado por padrão
  if (streams[0]?.subtitles?.length) {
    attachSubtitles(video, streams[0].subtitles);
  }
}

/**
 * Retorna uma badge de texto indicando se o stream é dublado/legendado PT-BR.
 * Usado na barra de qualidade e no chat.
 */
function ptbrBadge(stream) {
  if (!stream) return "";
  const haystack = [
    stream.title || "", stream.name || "", stream.provider || "",
  ].join(" ").toLowerCase();

  if (/\b(dub(lado)?|dubbed|portugu[eê]s|pt[-_]?br|ptbr)\b/.test(haystack)) {
    if (!/\b(leg|legenda|sub)\b/.test(haystack)) return "🇧🇷 DUB";
  }
  const hasPtbrSub = (stream.subtitles || []).some((s) =>
    /portugu|pt[-_]?br|ptbr|brazil/i.test(s.lang || "")
  );
  if (hasPtbrSub) return "🇧🇷 LEG";
  return "";
}

function loadStream(stream, video) {
  addSystem(`Carregando: ${stream.title || stream.quality || "stream"}`);

  // Monta URL do proxy passando o Referer correto do provider
  // Alguns providers (VidLink, 4KHDHub) exigem Referer específico do próprio site
  const providerReferer = getProviderReferer(stream);
  const proxyUrl = (url) => {
    const p = `/api/proxy?url=${encodeURIComponent(url)}`;
    return providerReferer ? `${p}&ref=${encodeURIComponent(providerReferer)}` : p;
  };

  if (video._hls) { video._hls.destroy(); video._hls = null; }

  if (stream.url.includes(".m3u8")) {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari — suporte HLS nativo via proxy
      video.src = proxyUrl(stream.url);
    } else if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
      hls.loadSource(proxyUrl(stream.url));
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        addSystem("Stream pronto.");
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          addSystem(`Erro HLS (${data.type}) — tente outra qualidade.`);
          console.error("[hls]", data);
        }
      });
      video._hls = hls;
    } else {
      addSystem("Seu browser não suporta HLS. Use Chrome ou Firefox.");
    }
  } else {
    // MP4 direto — passa pelo proxy para Range requests e CORS
    video.src = proxyUrl(stream.url);
  }
}

/**
 * Retorna o Referer correto para um dado provider/stream.
 * Necessário para providers que validam a origem da requisição.
 */
function getProviderReferer(stream) {
  const name = (stream.provider || stream.name || stream.title || "").toLowerCase();
  if (/vidlink/.test(name))      return "https://vidlink.pro/";
  if (/4khdhub/.test(name))      return "https://4khdhub.com/";
  if (/videasy/.test(name))      return "https://player.videasy.net/";
  if (/streamflix/.test(name))   return "https://streamflix.space/";
  if (/dahmermovies/.test(name)) return "https://dahmermovies.com/";
  if (/vixsrc/.test(name))       return "https://vixsrc.to/";
  if (/castletv/.test(name))     return "https://castle.club/";
  if (/netmirror/.test(name))    return "https://netmirror.app/";
  if (/zxcstreams/.test(name))   return "https://zxcstreams.com/";
  return null;
}

function buildQualityBar(streams, video, media) {
  const bar = document.createElement("div");
  bar.style.cssText = `
    position:absolute;top:0;right:0;z-index:20;
    background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);
    padding:6px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;
    font-size:12px;color:#fff;max-width:60%;
  `;

  const label = document.createElement("span");
  label.textContent = `${media.title}${media.season ? ` S${media.season}E${media.episode}` : ""} · `;
  label.style.opacity = "0.7";
  bar.appendChild(label);

  streams.forEach((s, i) => {
    const badge = ptbrBadge(s);
    const btn = document.createElement("button");
    // Mostra qualidade + badge PT-BR se houver
    btn.textContent = `${s.quality || `#${i + 1}`}${badge ? " " + badge : ""}`;
    const isFirst = i === 0;
    btn.style.cssText = `
      padding:3px 8px;border:1px solid ${badge ? "#2ecc71" : "#555"};
      background:${isFirst ? "#5865f2" : "transparent"};
      color:#fff;border-radius:4px;cursor:pointer;font-size:11px;
    `;
    btn.title = s.title || s.provider || "";
    btn.addEventListener("click", () => {
      if (video._hls) { video._hls.destroy(); video._hls = null; }
      loadStream(s, video);
      // Atualiza legendas para o stream selecionado
      video.querySelectorAll("track").forEach((t) => t.remove());
      if (s.subtitles?.length) attachSubtitles(video, s.subtitles);
      bar.querySelectorAll("button").forEach((b) => b.style.background = "transparent");
      btn.style.background = "#5865f2";
    });
    bar.appendChild(btn);
  });

  mediaEl.style.position = "relative";
  mediaEl.appendChild(bar);
}

function showLoadingOverlay(msg) {
  const el = document.createElement("div");
  el.style.cssText = `
    position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    color:#8b8ba0;font-size:16px;text-align:center;z-index:5;
  `;
  el.textContent = msg;
  mediaEl.style.position = "relative";
  mediaEl.appendChild(el);
  return el;
}

function showNoStreamsOverlay(media) {
  mediaEl.innerHTML = `
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      text-align:center;padding:24px;max-width:420px;">
      <div style="font-size:48px;margin-bottom:12px">😞</div>
      <p style="color:#e8e8f0;font-size:16px;margin-bottom:6px;">
        Nenhum stream disponível para<br><strong>${media.title || "este título"}</strong>
      </p>
      <p style="color:#8b8ba0;font-size:13px;">
        Verifique se o serviço TMDB-Embed-API está rodando e acessível (EMBED_API_URL no Render).
      </p>
    </div>`;
}

function attachSubtitles(video, subtitles) {
  // Remove tracks anteriores
  video.querySelectorAll("track").forEach((t) => t.remove());

  // Ordena: PT-BR primeiro, depois EN, depois o resto
  const sorted = [...subtitles].sort((a, b) => subLangScore(b.lang) - subLangScore(a.lang));

  sorted.forEach((sub, i) => {
    const track = document.createElement("track");
    track.kind    = "subtitles";
    track.label   = sub.lang || "Subtitle";
    track.srclang = sub.lang?.slice(0, 2).toLowerCase() || "pt";
    track.src     = `/api/sub-proxy?url=${encodeURIComponent(sub.url)}`;
    // Ativa PT-BR por padrão; se não houver PT-BR, ativa a primeira disponível
    track.default = i === 0;
    video.appendChild(track);
  });
}

function subLangScore(lang = "") {
  if (/portugu|pt[-_]?br|ptbr|brazil/i.test(lang)) return 3;
  if (/\bpt\b/i.test(lang))                         return 2; // pt-PT
  if (/\ben\b|english/i.test(lang))                 return 1;
  return 0;
}

// ── Video Sync (host → viewers) ───────────────────────────────────────────────
function setupVideoSync(video) {
  if (!video) return;

  if (isHost) {
    // Host broadcasts play/pause/seek
    video.addEventListener("play",   () => {
      if (suppressVideoEvents) return;
      socket.emit("video-sync", { action: "play", time: video.currentTime });
    });
    video.addEventListener("pause",  () => {
      if (suppressVideoEvents) return;
      socket.emit("video-sync", { action: "pause", time: video.currentTime });
    });
    video.addEventListener("seeked", () => {
      if (suppressVideoEvents) return;
      socket.emit("video-sync", { action: "seek", time: video.currentTime });
    });
    addSystem("Host: seus controles de play/pause/seek são sincronizados.");
  }

  // All clients receive sync events
  socket.on("video-sync", ({ action, time }) => {
    if (!video) return;
    suppressVideoEvents = true;
    video.currentTime = time;
    if (action === "play")  video.play().catch(() => {});
    if (action === "pause") video.pause();
    setTimeout(() => { suppressVideoEvents = false; }, 500);
    if (!isHost) addSystem(`Sync: ${action} em ${formatTime(Math.floor(time))}`);
  });
}

// ── YouTube (IFrame API + sync) ───────────────────────────────────────────────
let ytPlayer   = null;
let ytReady    = false;
let suppressYT = false;

function setupYouTube(videoId) {
  const placeholder = document.createElement("div");
  placeholder.id = "yt-player";
  placeholder.style.cssText = "width:100%;height:100%;";
  mediaEl.appendChild(placeholder);

  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);

  window.onYouTubeIframeAPIReady = () => {
    ytPlayer = new YT.Player("yt-player", {
      videoId,
      width: "100%", height: "100%",
      playerVars: { autoplay: 0, rel: 0, modestbranding: 1 },
      events: {
        onReady() { ytReady = true; addSystem("YouTube pronto. Sync ativo."); },
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
let rtcSetup = false;
const ICE = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
] };

function setupScreenshare() {
  if (rtcSetup) return; rtcSetup = true;
  setupRTCSignaling();
  shareBtn.style.display = "block";
  shareBtn.addEventListener("click", startShare);
}

function setupRTCViewer() {
  if (rtcSetup) return; rtcSetup = true;
  setupRTCSignaling();
  addSystem("Aguardando stream do host…");
  setTimeout(() => socket.emit("rtc-request-stream"), 800);
}

function setupRTCSignaling() {
  socket.on("rtc-request-stream", ({ from }) => { if (localStream) sendOffer(from); });
  socket.on("user-joined", ({ socketId }) => { if (localStream) sendOffer(socketId); });

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
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* late */ }
  });
}

async function startShare() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const video = document.createElement("video");
    video.id = "screen-video";
    video.autoplay = true; video.playsInline = true; video.muted = true;
    video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block;";
    video.srcObject = localStream;
    mediaEl.appendChild(video);
    shareBtn.style.display = "none";
    addSystem("Compartilhando sua tela.");
    localStream.getVideoTracks()[0].onended = () => {
      video.remove(); localStream = null;
      shareBtn.style.display = "block";
      addSystem("Compartilhamento encerrado.");
    };
  } catch { addSystem("Permissão negada ou falhou."); }
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
  if (isHost && localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = ({ candidate }) => { if (candidate) socket.emit("rtc-ice", { to: peerId, candidate }); };
  pc.ontrack = ({ streams }) => {
    let v = document.getElementById("screen-video");
    if (v) { v.srcObject = streams[0]; return; }
    v = document.createElement("video");
    v.id = "screen-video"; v.autoplay = true; v.playsInline = true; v.muted = true;
    v.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block;";
    v.srcObject = streams[0];
    mediaEl.appendChild(v);
    shareBtn.style.display = "none";
    const tryPlay = () => v.play().catch(() => {
      const ov = document.createElement("div");
      ov.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0.7);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;z-index:10;";
      ov.innerHTML = `<div style="font-size:64px">▶</div><div style="color:#fff;margin-top:12px">Clique para ver a tela</div>`;
      ov.addEventListener("click", () => { v.play(); ov.remove(); });
      mediaEl.style.position = "relative"; mediaEl.appendChild(ov);
    });
    tryPlay();
    v.addEventListener("canplay", tryPlay, { once: true });
    addSystem("Recebendo tela do host.");
  };
  return pc;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

function showError(msg) {
  errorText.textContent = msg;
  errorOverlay.style.display = "flex";
}
