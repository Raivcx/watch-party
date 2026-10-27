// Watch Party Room — Vanilla JS client
// Media: VidSrc iframe (movie/serie), YouTube IFrame API, WebRTC screenshare

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

socket.on("room-error", (msg) => showError(msg));
socket.on("host-left",  () => {
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
  if      (type === "movie" || type === "serie") setupIframePlayer(type, media);
  else if (type === "youtube")                   setupYouTube(media.videoId);
  else if (type === "screenshare")               isHost ? setupScreenshare() : setupRTCViewer();
}

// ── VidSrc Iframe Player (movie / serie) ─────────────────────────────────────
let iframeSources  = [];
let currentSrcIdx  = 0;
let currentIframe  = null;
// Timestamp relativo ao momento em que o iframe foi carregado (não temos acesso ao currentTime)
let iframeLoadedAt = 0;

async function setupIframePlayer(type, media) {
  // Busca fontes do servidor
  let sources;
  try {
    const res = await fetch(`/api/embed/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    sources = body.sources || [];
  } catch (err) {
    showError("Não foi possível carregar o player. Tente novamente.");
    addSystem("Erro ao buscar fontes: " + err.message);
    return;
  }

  if (!sources.length) {
    showError("Nenhuma fonte de vídeo disponível.");
    return;
  }

  iframeSources = sources;
  currentSrcIdx = 0;

  // Painel de controle — barra superior (já carrega o primeiro iframe internamente)
  buildIframeBar(media);

  // Viewers recebem sync do host
  socket.on("iframe-sync", ({ time, sourceIdx }) => {
    if (isHost) return; // host não aplica o próprio sync
    currentSrcIdx  = sourceIdx || 0;
    iframeLoadedAt = Date.now() - (time * 1000);
    loadIframe(currentSrcIdx);
    addSystem(`🔄 Sincronizado com o host.`);
  });
}

function loadIframe(idx) {
  if (!iframeSources[idx]) return;
  currentSrcIdx = idx;

  // Remove iframe anterior
  if (currentIframe) currentIframe.remove();

  const iframe = document.createElement("iframe");
  iframe.src              = iframeSources[idx].url;
  iframe.allowFullscreen  = true;
  iframe.allow            = "autoplay; fullscreen; encrypted-media; picture-in-picture";
  iframe.style.cssText    = "width:100%;height:100%;border:none;display:block;background:#000;";
  mediaEl.appendChild(iframe);
  currentIframe  = iframe;
  iframeLoadedAt = Date.now();

  addSystem(`▶ ${iframeSources[idx].provider} — fonte ${idx + 1}/${iframeSources.length}`);
}

function buildIframeBar(media) {
  const bar = document.createElement("div");
  bar.id = "iframe-bar";
  bar.style.cssText = `
    position:absolute;top:0;left:0;right:0;z-index:20;
    background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);
    padding:5px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;
    font-size:12px;color:#fff;min-height:36px;
  `;

  // Título do conteúdo
  const title = document.createElement("span");
  title.textContent = media.title
    + (media.season ? ` · S${media.season}E${media.episode}` : "");
  title.style.cssText = "opacity:0.65;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;";
  bar.appendChild(title);

  // Separador
  const sep = document.createElement("span");
  sep.textContent = "·";
  sep.style.opacity = "0.3";
  bar.appendChild(sep);

  // Botões por grupo de idioma
  // Agrupa: dub, leg, auto
  const groups = [
    { key: "dub",  label: "🇧🇷 DUB",     color: "#e74c3c", title: "Dublado PT-BR" },
    { key: "leg",  label: "🇧🇷 LEG",     color: "#3498db", title: "Legendado PT-BR" },
    { key: "auto", label: "EN/Auto",      color: "#555",    title: "Inglês / Automático" },
  ];

  // Índice ativo no grupo de lang selecionado
  const groupIdx = { dub: 0, leg: 0, auto: 0 };

  // Cria um botão por grupo — ao clicar, roda pelos sources daquele grupo
  groups.forEach(({ key, label, color, title: ttip }) => {
    const srcs = iframeSources.filter((s) => s.lang === key);
    if (!srcs.length) return;

    const btn = document.createElement("button");
    btn.dataset.langGroup = key;
    btn.textContent = label;
    btn.title = ttip;
    const isActive = key === "dub"; // DUB ativo por padrão
    btn.style.cssText = `
      padding:3px 9px;border:1px solid ${color};
      background:${isActive ? color : "transparent"};
      color:#fff;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;
    `;

    btn.addEventListener("click", () => {
      // Desativa todos os grupos
      bar.querySelectorAll("[data-lang-group]").forEach((b) => {
        const g = groups.find((g) => g.key === b.dataset.langGroup);
        if (g) b.style.background = "transparent";
      });
      // Ativa este
      btn.style.background = color;
      // Carrega próxima source deste grupo (roda entre os do mesmo grupo)
      const groupSrcs = iframeSources.map((s, i) => ({ ...s, idx: i })).filter((s) => s.lang === key);
      const next = groupSrcs[groupIdx[key] % groupSrcs.length];
      groupIdx[key] = (groupIdx[key] + 1) % groupSrcs.length;
      loadIframe(next.idx);
    });

    bar.appendChild(btn);
  });

  // Espaçador flexível
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  bar.appendChild(spacer);

  // Botão Sync — só o host vê
  if (isHost) {
    const syncBtn = document.createElement("button");
    syncBtn.id = "sync-btn";
    syncBtn.textContent = "📍 Sync";
    syncBtn.title = "Envia sua posição atual para todos os viewers";
    syncBtn.style.cssText = `
      padding:3px 12px;background:#2ecc71;color:#000;font-weight:700;
      border:none;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;
    `;
    syncBtn.addEventListener("click", () => {
      const elapsed = Math.floor((Date.now() - iframeLoadedAt) / 1000);
      socket.emit("iframe-sync", { time: elapsed, sourceIdx: currentSrcIdx });
      addSystem(`📍 Sync enviado (${formatTime(elapsed)} desde o início).`);
      syncBtn.textContent = "✅";
      setTimeout(() => { syncBtn.textContent = "📍 Sync"; }, 2000);
    });
    bar.appendChild(syncBtn);
  } else {
    const hint = document.createElement("span");
    hint.textContent = "⏳ aguardando host";
    hint.style.cssText = "font-size:10px;color:#8b8ba0;white-space:nowrap;";
    bar.appendChild(hint);
  }

  mediaEl.style.position = "relative";
  mediaEl.appendChild(bar);
  mediaEl.style.paddingTop = "36px";

  // Carrega o primeiro DUB disponível por padrão
  const firstDub = iframeSources.findIndex((s) => s.lang === "dub");
  loadIframe(firstDub >= 0 ? firstDub : 0);
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
const peers     = {};
let rtcSetup    = false;

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

function newPC(peerId, isHostPeer) {
  if (peers[peerId]) { peers[peerId].close(); delete peers[peerId]; }
  const pc = new RTCPeerConnection(ICE);
  peers[peerId] = pc;
  if (isHostPeer && localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit("rtc-ice", { to: peerId, candidate });
  };
  pc.ontrack = ({ streams }) => {
    let v = document.getElementById("screen-video");
    if (v) { v.srcObject = streams[0]; return; }
    v = document.createElement("video");
    v.id = "screen-video"; v.autoplay = true; v.playsInline = true; v.muted = false;
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
