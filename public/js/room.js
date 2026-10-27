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
const nameModal    = document.getElementById("name-modal");
const nameInput    = document.getElementById("name-input");
const nameForm     = document.getElementById("name-form");

let myId        = null;
let isHost      = false;
let onlineCount = 0;
let myName      = localStorage.getItem("watchPartyName") || "";

// ── Nome do usuário ───────────────────────────────────────────────────────────
if (!myName) {
  nameModal.style.display = "flex";
  nameInput.focus();
} else {
  initSocket();
}

nameForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const val = nameInput.value.trim().slice(0, 20);
  if (!val) return;
  myName = val;
  localStorage.setItem("watchPartyName", myName);
  nameModal.style.display = "none";
  initSocket();
});

// ── Chat ──────────────────────────────────────────────────────────────────────
let msgTimestamps = [];
const MSG_LIMIT   = 5;
const MSG_WINDOW  = 5000;

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  const now = Date.now();
  msgTimestamps = msgTimestamps.filter((t) => now - t < MSG_WINDOW);
  if (msgTimestamps.length >= MSG_LIMIT) {
    addSystem("⚠️ Você está enviando mensagens rápido demais. Aguarde um momento.");
    return;
  }
  msgTimestamps.push(now);

  socket.emit("chat-message", { text, name: myName });
  chatInput.value = "";
});

// Enter envia (não duplica com o submit do form, mas garante que
// Enter dentro do <input> não seja bloqueado por eventos externos)
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// Indicador de "digitando"
let typingTimer = null;
let isTyping = false;
chatInput.addEventListener("input", () => {
  if (!isTyping) {
    isTyping = true;
    socket.emit("typing-start");
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    socket.emit("typing-stop");
  }, 1500);
});

function addMessage({ socketId, text, name }) {
  const isSelf = socketId === myId;
  const displayName = isSelf ? "Você" : (name || socketId.slice(0, 6));
  const el = document.createElement("div");
  el.className = "msg" + (isSelf ? " self" : "");
  el.innerHTML = `<div class="who">${esc(displayName)}</div>${esc(text)}`;
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
function initSocket() {
  socket.on("connect", () => {
    addSystem("Conectando à sala…");
    socket.emit("join-room", roomId);
  });

  // Se o socket já estava conectado antes de initSocket ser chamado
  // (caso do modal de nome: socket conecta imediatamente mas os listeners
  // só existem depois que o usuário submete o nome), emite join-room direto.
  if (socket.connected) {
    addSystem("Conectando à sala…");
    socket.emit("join-room", roomId);
  }

  socket.on("connect_error", (err) => addSystem("Erro de conexão: " + err.message));

  socket.on("room-info", (info) => {
    myId        = info.yourId;
    isHost      = info.isHost;
    onlineCount = info.userCount || 1;
    updateCountDisplay();
    addSystem(`Sala pronta · ${isHost ? "Você é o host" : "Você é viewer"}`);
    setupMedia(info.type, info.media);
  });

  socket.on("room-error", (msg) => showError(msg));

  socket.on("host-left", () => {
    errorText.textContent = "O host encerrou a sessão. Esta sala foi fechada.";
    errorOverlay.style.display = "flex";
    setTimeout(() => { window.location.href = "/"; }, 4000);
  });

  socket.on("host-promoted", ({ message }) => {
    isHost = true;
    addSystem(`👑 ${message}`);

    // Remove o vídeo da stream anterior que ainda pode estar no DOM
    // (o viewer tinha o screen-video do host antigo montado via ontrack)
    cleanupScreenVideo();

    // Viewer que vira host já passou por setupRTCViewer() que setou rtcSetup=true,
    // então setupScreenshare() retornaria imediatamente sem mostrar o botão.
    // Fazemos manualmente: configura signaling se ainda não foi, mostra o botão.
    if (!rtcSetup) {
      rtcSetup = true;
      setupRTCSignaling();
    }
    shareBtn.removeEventListener("click", startShare);
    shareBtn.addEventListener("click", startShare);
    shareBtn.style.display = "block";
  });

  socket.on("host-changed", ({ newHostId, newHostName }) => {
    addSystem(`👑 Novo host: ${esc(newHostName || newHostId.slice(0, 6))}`);
    // Limpa o vídeo antigo e aguarda nova stream do novo host
    cleanupScreenVideo();
    addSystem("⏳ Aguardando nova transmissão do host…");
  });

  // Novo host subiu stream — viewers limpam estado antigo e pedem a nova
  socket.on("stream-started", () => {
    if (isHost) return;
    cleanupScreenVideo();
    addSystem("🟢 Nova transmissão disponível, conectando…");
    // Pequeno delay para o novo host terminar de configurar as tracks
    setTimeout(() => socket.emit("rtc-request-stream"), 600);
  });

  socket.on("chat-message", addMessage);

  socket.on("user-joined", ({ socketId, name: joinName, userCount }) => {
    onlineCount = userCount || onlineCount + 1;
    updateCountDisplay();
    addSystem(`${esc(joinName || socketId.slice(0, 6))} entrou na sala.`);
    // WebRTC: host manda offer para novo viewer se estiver compartilhando
    if (localStream) sendOffer(socketId);
  });

  socket.on("user-left", ({ socketId, name: leftName, userCount }) => {
    onlineCount = userCount || Math.max(1, onlineCount - 1);
    updateCountDisplay();
    addSystem(`${esc(leftName || socketId.slice(0, 6))} saiu da sala.`);
    if (peers[socketId]) {
      peers[socketId].close();
      delete peers[socketId];
    }
  });

  // Notificação para o host quando novo viewer entra na sala de filme
  socket.on("viewer-joined-notify", ({ name: viewerName }) => {
    // Só relevante para salas de filme/série (o host precisa sincronizar manualmente)
    const elapsed = Math.floor((Date.now() - iframeLoadedAt) / 1000);
    const btn = document.getElementById("sync-btn");
    if (!btn) return; // não é sala de iframe
    const displayName = esc(viewerName && viewerName !== "anon" ? viewerName : "Alguém");
    addSystem(`👤 ${displayName} entrou — clique 📍 Sync para sincronizar (você está em ${formatTime(elapsed)}).`);
    // Pulsa o botão de sync em amarelo por 5s para chamar atenção
    btn.style.background = "#f39c12";
    btn.style.color = "#000";
    setTimeout(() => {
      btn.style.background = "#2ecc71";
    }, 5000);
  });

  // Indicador de "digitando"
  const typingUsers = new Map();
  socket.on("user-typing", ({ socketId, name: typingName }) => {
    typingUsers.set(socketId, typingName || socketId.slice(0, 6));
    updateTypingIndicator(typingUsers);
  });
  socket.on("user-stop-typing", ({ socketId }) => {
    typingUsers.delete(socketId);
    updateTypingIndicator(typingUsers);
  });
}

function updateCountDisplay() {
  userCountEl.textContent = `${onlineCount} online`;
}

function updateTypingIndicator(typingUsers) {
  let el = document.getElementById("typing-indicator");
  if (typingUsers.size === 0) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "typing-indicator";
    el.className = "msg system";
    messagesEl.appendChild(el);
  }
  const names = [...typingUsers.values()].slice(0, 3).map(esc);
  el.textContent = names.join(", ") + (typingUsers.size === 1 ? " está digitando…" : " estão digitando…");
  messagesEl.scrollTop = messagesEl.scrollHeight;
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
let iframeLoadedAt = 0;

async function setupIframePlayer(type, media) {
  // Atualiza o título da aba com o conteúdo da sala
  document.title = `📺 ${media.title}${media.season ? ` S${media.season}E${media.episode}` : ""} — Watch Party`;

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

  buildIframeBar(media);

  // Recebe sync do host (manual ou auto-sync ao entrar na sala)
  socket.on("iframe-sync", ({ time, sourceIdx, autoSync }) => {
    if (isHost) return;
    const t = time || 0;
    const label = autoSync ? "⚡ Sincronizado automaticamente" : "🔄 Sincronizado com o host";
    loadIframe(sourceIdx || 0, t);
    addSystem(`${label}${t > 5 ? ` em ${formatTime(t)}` : ""}.`);
  });
}

/**
 * Carrega o iframe de um provider com seek opcional via parâmetro de URL.
 * @param {number} idx - índice em iframeSources
 * @param {number} startAtSeconds - timestamp em segundos (0 = início)
 */
function loadIframe(idx, startAtSeconds = 0) {
  if (!iframeSources[idx]) return;
  currentSrcIdx = idx;

  if (currentIframe) {
    currentIframe.remove();
    currentIframe = null;
  }
  if (window._iframeWatchdog) { clearTimeout(window._iframeWatchdog); window._iframeWatchdog = null; }

  // Injeta parâmetro de seek dependendo do provider
  let url = iframeSources[idx].url;
  if (startAtSeconds > 5) {
    const sep = url.includes("?") ? "&" : "?";
    if (url.includes("moviesnexus")) {
      url += `${sep}startAt=${startAtSeconds}`;
    } else if (url.includes("vidcore")) {
      url += `${sep}t=${startAtSeconds}`;
    }
    // vidsrc.to e vidsrc.cc não suportam seek por URL — viewer começa do início
  }

  const iframe = document.createElement("iframe");
  iframe.src             = url;
  iframe.allowFullscreen = true;
  iframe.allow           = "autoplay; fullscreen; encrypted-media; picture-in-picture";
  iframe.style.cssText   = "width:100%;height:100%;border:none;display:block;background:#000;";

  mediaEl.appendChild(iframe);
  currentIframe  = iframe;
  // Ajusta iframeLoadedAt para que o timer do host reflita o tempo correto
  iframeLoadedAt = Date.now() - (startAtSeconds * 1000);

  const seekLabel = startAtSeconds > 5 ? ` · ⏩ ${formatTime(startAtSeconds)}` : "";
  addSystem(`▶ ${iframeSources[idx].provider} · ${iframeSources[idx].label || "Auto"}${seekLabel}`);

  // Watchdog: se o iframe não responder em 14s, tenta próximo do mesmo grupo
  const baseUrl = iframeSources[idx].url.split("?")[0];
  window._iframeWatchdog = setTimeout(() => {
    if (currentIframe && currentIframe.src.startsWith(baseUrl)) {
      const nextInGroup = iframeSources
        .map((s, i) => ({ ...s, i }))
        .filter((s) => s.lang === iframeSources[idx].lang && s.i !== idx);
      if (nextInGroup.length > 0) {
        addSystem(`⏱ Sem resposta — tentando ${nextInGroup[0].provider}…`);
        loadIframe(nextInGroup[0].i, startAtSeconds);
      }
    }
  }, 14000);
}

// Bloqueia popups e navegação indesejada dos players.
(function blockPopups() {
  const _open = window.open.bind(window);
  window.open = function (url, target, features) {
    if (!url) return _open(url, target, features);
    console.warn("[security] window.open bloqueado:", url);
    return null;
  };
})();

function buildIframeBar(media) {
  const bar = document.createElement("div");
  bar.id = "iframe-bar";
  bar.style.cssText = `
    position:absolute;top:0;left:0;right:0;z-index:20;
    background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);
    padding:5px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;
    font-size:12px;color:#fff;min-height:36px;
  `;

  const title = document.createElement("span");
  title.textContent = media.title + (media.season ? ` · S${media.season}E${media.episode}` : "");
  title.style.cssText = "opacity:0.65;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;";
  bar.appendChild(title);

  const sep = document.createElement("span");
  sep.textContent = "·";
  sep.style.opacity = "0.3";
  bar.appendChild(sep);

  const groups = [
    { key: "dub",  label: "🇧🇷 DUB",  color: "#e74c3c", title: "Dublado PT-BR" },
    { key: "leg",  label: "🇧🇷 LEG",  color: "#3498db", title: "Legendado PT-BR" },
    { key: "auto", label: "EN/Auto",   color: "#555",    title: "Inglês / Automático" },
  ];

  let activeGroupKey = null;
  const groupIdx = { dub: 0, leg: 0, auto: 0 };

  function activateGroup(key, color) {
    activeGroupKey = key;
    bar.querySelectorAll("[data-lang-group]").forEach((b) => {
      const g = groups.find((g) => g.key === b.dataset.langGroup);
      b.style.background = (b.dataset.langGroup === key) ? (g?.color || color) : "transparent";
    });
  }

  groups.forEach(({ key, label, color, title: ttip }) => {
    const srcs = iframeSources.filter((s) => s.lang === key);
    if (!srcs.length) return;

    const btn = document.createElement("button");
    btn.dataset.langGroup = key;
    btn.textContent = label;
    btn.title = ttip;
    const isDefault = key === "dub";
    btn.style.cssText = `
      padding:3px 9px;border:1px solid ${color};
      background:${isDefault ? color : "transparent"};
      color:#fff;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;
    `;

    btn.addEventListener("click", () => {
      activateGroup(key, color);
      const groupSrcs = iframeSources.map((s, i) => ({ ...s, idx: i })).filter((s) => s.lang === key);
      const next = groupSrcs[groupIdx[key] % groupSrcs.length];
      groupIdx[key] = (groupIdx[key] + 1) % groupSrcs.length;
      loadIframe(next.idx);
    });

    bar.appendChild(btn);
  });

  // Spacer
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  bar.appendChild(spacer);

  // Botão fullscreen
  const fsBtn = document.createElement("button");
  fsBtn.textContent = "⛶";
  fsBtn.title = "Fullscreen";
  fsBtn.style.cssText = `
    padding:3px 8px;background:transparent;color:#fff;font-size:14px;
    border:1px solid #555;border-radius:4px;cursor:pointer;white-space:nowrap;
  `;
  fsBtn.addEventListener("click", () => {
    const target = currentIframe || mediaEl;
    if (target.requestFullscreen) target.requestFullscreen();
    else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
  });
  bar.appendChild(fsBtn);

  // Botão Sync — só o host vê; viewers veem o hint "aguardando"
  if (isHost) {
    const syncBtn = document.createElement("button");
    syncBtn.id = "sync-btn";
    syncBtn.textContent = "📍 Sync";
    syncBtn.title = "Envia sua posição atual para todos os viewers";
    syncBtn.style.cssText = `
      padding:3px 12px;background:#2ecc71;color:#000;font-weight:700;
      border:none;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;
      transition:background 0.3s;
    `;
    syncBtn.addEventListener("click", () => {
      const elapsed = Math.floor((Date.now() - iframeLoadedAt) / 1000);
      socket.emit("iframe-sync", { time: elapsed, sourceIdx: currentSrcIdx });
      addSystem(`📍 Sync enviado (${formatTime(elapsed)} desde o início).`);
      syncBtn.textContent = "✅";
      syncBtn.style.background = "#2ecc71";
      setTimeout(() => { syncBtn.textContent = "📍 Sync"; }, 2000);
    });
    bar.appendChild(syncBtn);

    // Timer: atualiza o title do botão Sync com a posição atual a cada 5s
    setInterval(() => {
      const el = document.getElementById("sync-btn");
      if (!el) return;
      const elapsed = Math.floor((Date.now() - iframeLoadedAt) / 1000);
      el.title = `Posição atual: ${formatTime(elapsed)} — clique para sincronizar todos`;
    }, 5000);

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
  if (firstDub >= 0) activateGroup("dub", "#e74c3c");
  else activateGroup("auto", "#555");
}

// ── YouTube (IFrame API + sync) ───────────────────────────────────────────────
let ytPlayer   = null;
let ytReady    = false;
let suppressYT = false;

function setupYouTube(videoId) {
  // Atualiza título da aba para salas de YouTube também
  document.title = `▶ YouTube Watch Party`;

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
  document.title = "🖥️ Screen Share — Watch Party";
  setupRTCSignaling();
  shareBtn.style.display = "block";
  shareBtn.addEventListener("click", startShare);
}

function setupRTCViewer() {
  if (rtcSetup) return; rtcSetup = true;
  document.title = "🖥️ Screen Share — Watch Party";
  setupRTCSignaling();
  addSystem("Aguardando stream do host…");
  setTimeout(() => socket.emit("rtc-request-stream"), 800);
}

function setupRTCSignaling() {
  socket.on("rtc-request-stream", ({ from }) => { if (localStream) sendOffer(from); });

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

let _sharingInProgress = false;

async function startShare() {
  // Evita múltiplas chamadas simultâneas (duplo-clique, listener duplicado)
  if (_sharingInProgress) return;
  _sharingInProgress = true;

  try {
    // Fecha peer connections antigas antes de criar novas
    closeAllPeers();

    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

    // Remove vídeo antigo se ainda existir no DOM
    cleanupScreenVideo();

    const video = document.createElement("video");
    video.id = "screen-video";
    video.autoplay = true; video.playsInline = true; video.muted = true;
    video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block;";
    video.srcObject = localStream;
    mediaEl.appendChild(video);
    shareBtn.style.display = "none";
    addSystem("Compartilhando sua tela.");

    // Avisa todos os viewers que a nova stream está disponível
    socket.emit("stream-started");

    localStream.getVideoTracks()[0].onended = () => {
      video.remove(); localStream = null;
      _sharingInProgress = false;
      closeAllPeers();
      shareBtn.style.display = "block";
      addSystem("Compartilhamento encerrado.");
    };
  } catch (err) {
    _sharingInProgress = false;
    // NotAllowedError = usuário cancelou o picker ou negou permissão
    if (err.name === "NotAllowedError") {
      addSystem("Compartilhamento cancelado.");
    } else {
      addSystem(`Erro ao compartilhar: ${err.message || err.name}`);
      console.error("[screenshare]", err);
    }
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




