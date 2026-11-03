// Watch Party Room — Vanilla JS client
// Discord OAuth2 identity · Discord-style UI · WebRTC · iframe · YouTube sync

// ── Auth: fetch Discord identity before connecting ────────────────────────────
let myUser = null;

async function bootstrap() {
  try {
    const res = await fetch("/auth/me");
    if (!res.ok) {
      // Not authenticated — redirect to login, returning here after
      window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    myUser = await res.json(); // { id, username, avatar }
  } catch {
    window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname)}`;
    return;
  }
  initApp();
}

bootstrap();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const messagesEl    = document.getElementById("chat-messages");
const chatInput     = document.getElementById("chat-input");
const userCountEl   = document.getElementById("user-count");
const mediaEl       = document.getElementById("media-container");
const shareBtn      = document.getElementById("start-share-btn");
const errorOverlay  = document.getElementById("error-overlay");
const errorText     = document.getElementById("error-text");
const kickedOverlay = document.getElementById("kicked-overlay");
const kickedText    = document.getElementById("kicked-text");
const membersList   = document.getElementById("members-list");
const roomTitleEl   = document.getElementById("room-title");
const roomIconEl    = document.getElementById("room-icon");
const roomBadgeEl   = document.getElementById("room-badge");

const roomId = window.location.pathname.split("/room/")[1]?.split("/")[0];
if (!roomId) showError("No room ID in the URL.");

let myId        = null;
let isHost      = false;
let onlineCount = 0;
// Map<socketId, { name, avatar, discordId, isHost }>
const roomMembers = new Map();

// ── Message grouping state ────────────────────────────────────────────────────
let lastMsgSocketId = null;
let lastMsgTime     = 0;
const MSG_GROUP_MS  = 5 * 60 * 1000; // group messages within 5 min

// ── Chat rate limit ───────────────────────────────────────────────────────────
let msgTimestamps = [];
const MSG_LIMIT   = 5;
const MSG_WINDOW  = 5000;

// ── Socket (lazy init after auth) ────────────────────────────────────────────
// ── Resize handle ─────────────────────────────────────────────────────────────
(function initResize() {
  const handle   = document.getElementById('resize-handle');
  const mediaPnl = document.getElementById('media-panel');
  const app      = document.getElementById('app');
  if (!handle || !mediaPnl) return;
  const saved = localStorage.getItem('wp_media_width');
  if (saved) mediaPnl.style.flex = '0 0 ' + saved;
  let dragging = false;
  handle.addEventListener('mousedown', (e) => { dragging = true; handle.classList.add('dragging'); e.preventDefault(); });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const r = app.getBoundingClientRect();
    const pct = ((e.clientX - r.left) / r.width * 100).toFixed(1);
    mediaPnl.style.flex = '0 0 ' + Math.min(85, Math.max(25, pct)) + '%';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    localStorage.setItem('wp_media_width', mediaPnl.style.flex.replace('0 0 ', ''));
  });
})();

// ── Members panel resize + collapse ──────────────────────────────────────────
(function initMembersPanel() {
  const panel      = document.getElementById('members-panel');
  const handle     = document.getElementById('members-resize-handle');
  const collapseBtn= document.getElementById('members-collapse-btn');
  const app        = document.getElementById('app');
  if (!panel) return;

  // Restore saved state
  const savedWidth     = localStorage.getItem('wp_members_width');
  const savedCollapsed = localStorage.getItem('wp_members_collapsed') === '1';

  if (savedCollapsed) {
    panel.classList.add('collapsed');
    collapseBtn.textContent = '›';
  } else if (savedWidth) {
    panel.style.width = savedWidth;
  }

  // Collapse toggle
  collapseBtn?.addEventListener('click', () => {
    // Only collapse/expand — never hide (that is toggle-members-btn's job)
    if (panel.classList.contains('hidden')) return;
    const isCollapsed = panel.classList.toggle('collapsed');
    collapseBtn.title = isCollapsed ? 'Expandir' : 'Retrair';
    localStorage.setItem('wp_members_collapsed', isCollapsed ? '1' : '0');
    if (!isCollapsed && savedWidth) panel.style.width = savedWidth;
  });

  // Resize drag
  if (!handle) return;
  let dragging = false;
  handle.addEventListener('mousedown', (e) => {
    if (panel.classList.contains('collapsed')) return;
    dragging = true;
    handle.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const r    = panel.getBoundingClientRect();
    const newW = Math.min(400, Math.max(56, r.right - e.clientX));
    panel.style.width = newW + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    localStorage.setItem('wp_members_width', panel.style.width);
  });
})();


let socket = null;

function initApp() {
  // Toggle members panel
  const toggleBtn    = document.getElementById('toggle-members-btn');
  const membersPanel = document.getElementById('members-panel');
  if (toggleBtn && membersPanel) {
    const savedHidden = localStorage.getItem('wp_members_hidden') === '1';
    if (savedHidden) membersPanel.classList.add('hidden');
    else toggleBtn.classList.add('active');
    toggleBtn.addEventListener('click', () => {
      const hidden = membersPanel.classList.toggle('hidden');
      localStorage.setItem('wp_members_hidden', hidden ? '1' : '0');
      toggleBtn.classList.toggle('active', !hidden);
      // Update tooltip
      toggleBtn.title = hidden ? 'Mostrar membros' : 'Ocultar membros';
    });
  }

  // Send button
  document.getElementById('send-btn')?.addEventListener('click', sendChat);

  socket = io({ transports: ["websocket", "polling"] });

  // Chat input: Enter sends
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  // Typing indicator
  let typingTimer = null;
  let isTyping = false;
  chatInput.addEventListener("input", () => {
    if (!isTyping) { isTyping = true; socket.emit("typing-start"); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { isTyping = false; socket.emit("typing-stop"); }, 1500);
  });

  // ── Socket events ───────────────────────────────────────────────────────────
  socket.on("connect", () => {
    addSystem("Conectando à sala…");
    socket.emit("join-room", roomId);
  });

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

    // Populate members from initial list
    if (Array.isArray(info.members)) {
      info.members.forEach(m => {
        roomMembers.set(m.socketId, {
          name:      m.username,
          avatar:    m.avatar,
          discordId: null, // not exposed in members snapshot
          isHost:    m.isHost,
        });
      });
      renderMembers();
    }

    // Set room header
    setRoomHeader(info.type, info.media);
    addSystem(`Sala pronta · ${isHost ? "Você é o host" : "Você é viewer"}`);
    setupMedia(info.type, info.media);
    if (isHost) { const ha = document.getElementById('header-actions'); if (ha) ha.style.display = 'flex'; }
  });

  socket.on("room-error", (msg) => showError(msg));

  socket.on("host-left", () => {
    errorText.textContent = "O host encerrou a sessão. Esta sala foi fechada.";
    errorOverlay.style.display = "flex";
    setTimeout(() => { window.location.href = "/"; }, 4000);
  });

  socket.on('stream-permission-granted', ({ message }) => {
    addSystem('🎥 ' + message);
    const pc = document.getElementById('player-controls');
    const sg = document.getElementById('ctrl-share-group');
    const wt = document.getElementById('ctrl-viewer-waiting');
    if (pc) pc.style.display = 'flex';
    if (sg) sg.style.display = 'flex';
    if (wt) wt.style.display = 'none';
    const btnSh = document.getElementById('btn-share-screen');
    if (btnSh && !btnSh.dataset.wired) {
      btnSh.dataset.wired = '1';
      btnSh.addEventListener('click', startShare);
    }
    const btnSt = document.getElementById('btn-stop-share');
    if (btnSt && !btnSt.dataset.wired) {
      btnSt.dataset.wired = '1';
      btnSt.addEventListener('click', stopShare);
    }
    if (!rtcSetup) { rtcSetup = true; setupRTCSignaling(); }
  });

  socket.on('stream-permission-revoked', ({ message }) => {
    addSystem('⛔ ' + message);
    const sg = document.getElementById('ctrl-share-group');
    if (sg) sg.style.display = 'none';
    // Stop sharing if active and cleanup grid + peers
    stopShare();
  });

  socket.on('stream-permission-update', ({ socketId: sid, name, granted }) => {
    if (granted) { streamPermissions.add(sid); addSystem('🎥 ' + name + ' pode compartilhar tela.'); }
    else streamPermissions.delete(sid);
    renderMembers();
  });

  socket.on('transfer-host-ack', ({ message }) => {
    addSystem('👑 ' + message);
  });

  socket.on("kicked", ({ message }) => {
    kickedText.textContent = message || "Você foi removido da sala pelo host.";
    kickedOverlay.style.display = "flex";
    setTimeout(() => { window.location.href = "/"; }, 4000);
  });

  socket.on("host-promoted", ({ message }) => {
    isHost = true;
    addSystem(`👑 ${message}`);
    // DO NOT cleanupScreenVideo — other streams may still be active
    if (!rtcSetup) { rtcSetup = true; setupRTCSignaling(); }
    // Show share controls for new host
    const _pc = document.getElementById("player-controls");
    const _sg = document.getElementById("ctrl-share-group");
    const _wt = document.getElementById("ctrl-viewer-waiting");
    const _rv = document.getElementById("ctrl-viewer-receiving");
    if (_pc) _pc.style.display = "flex";
    if (_sg) _sg.style.display = "flex";
    if (_wt) _wt.style.display = "none";
    if (_rv) _rv.style.display = "none";
    const shareBtn2 = document.getElementById("btn-share-screen");
    const stopBtn2  = document.getElementById("btn-stop-share");
    if (shareBtn2 && !shareBtn2.dataset.wired) {
      shareBtn2.dataset.wired = "1";
      shareBtn2.addEventListener("click", startShare);
    }
    if (stopBtn2 && !stopBtn2.dataset.wired) {
      stopBtn2.dataset.wired = "1";
      stopBtn2.addEventListener("click", stopShare);
    }
    const ha = document.getElementById("header-actions");
    if (ha) ha.style.display = "flex";
    renderMembers();
  });

  socket.on("host-changed", ({ newHostId, newHostName }) => {
    addSystem(`👑 Novo host: ${esc(newHostName || newHostId.slice(0, 6))}`);
    cleanupScreenVideo();
    addSystem("⏳ Aguardando nova transmissão do host…");
    // Update host flag in members
    roomMembers.forEach((m, sid) => { m.isHost = sid === newHostId; });
    renderMembers();
  });

  socket.on("stream-started", ({ from }) => {
    // Only clear the stale tile of whoever just (re)started — never nuke the whole grid.
    if (from) removeStreamVideo(from);

    if (!localStream) {
      // We are not sharing — request the new stream from whoever started.
      if (!isHost) {
        const _w2 = document.getElementById("ctrl-viewer-waiting");
        const _r2 = document.getElementById("ctrl-viewer-receiving");
        if (_w2) _w2.style.display = "flex";
        if (_r2) _r2.style.display = "none";
        addSystem("🟢 Nova transmissão disponível, conectando…");
      }
      setTimeout(() => socket.emit("rtc-request-stream"), 600);
    } else {
      // We ARE also sharing. The new sharer does not know about our stream yet.
      // Send them an offer so they receive our stream, and request theirs back.
      if (from) {
        setTimeout(() => {
          sendOffer(from);                    // push our stream to them
          socket.emit("rtc-request-stream"); // ask for their stream too
        }, 600);
      }
    }
  });

  socket.on("chat-message", addMessage);

  socket.on("user-joined", ({ socketId, discordId, name, avatar, userCount }) => {
    onlineCount = userCount || onlineCount + 1;
    updateCountDisplay();
    addSystem(`${esc(name || socketId.slice(0, 6))} entrou na sala.`);
    roomMembers.set(socketId, { name, avatar, discordId, isHost: false });
    renderMembers();
    if (localStream) sendOffer(socketId);
  });

  socket.on("user-left", ({ socketId, name, userCount }) => {
    onlineCount = userCount || Math.max(1, onlineCount - 1);
    updateCountDisplay();
    addSystem(`${esc(name || socketId.slice(0, 6))} saiu da sala.`);
    roomMembers.delete(socketId);
    renderMembers();
    if (peers[socketId]) { peers[socketId].close(); delete peers[socketId]; }
    removeStreamVideo(socketId);
  });

  socket.on("viewer-joined-notify", ({ name: viewerName }) => {
    const elapsed = Math.floor((Date.now() - iframeLoadedAt) / 1000);
    const btn = document.getElementById("sync-btn");
    if (!btn) return;
    const displayName = esc(viewerName && viewerName !== "anon" ? viewerName : "Alguém");
    addSystem(`👤 ${displayName} entrou — clique 📍 Sync para sincronizar (você está em ${formatTime(elapsed)}).`);
    btn.style.background = "#f0b132";
    btn.classList.add("sync-pulse");
    setTimeout(() => { btn.style.background = "#23a559"; btn.classList.remove("sync-pulse"); }, 5000);
  });

  // Typing indicator
  const typingUsers = new Map();
  const typingEl = document.getElementById("typing-indicator");
  socket.on("user-typing", ({ socketId, name: typingName }) => {
    typingUsers.set(socketId, typingName || socketId.slice(0, 6));
    updateTypingIndicator(typingUsers, typingEl);
  });
  socket.on("user-stop-typing", ({ socketId }) => {
    typingUsers.delete(socketId);
    updateTypingIndicator(typingUsers, typingEl);
  });
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !socket) return;
  const now = Date.now();
  msgTimestamps = msgTimestamps.filter(t => now - t < MSG_WINDOW);
  if (msgTimestamps.length >= MSG_LIMIT) {
    addSystem("⚠️ Você está enviando mensagens rápido demais.");
    return;
  }
  msgTimestamps.push(now);
  socket.emit("chat-message", { text });
  chatInput.value = "";
}

// ── Discord-style message rendering ──────────────────────────────────────────
function addMessage({ socketId, text, name, avatar, ts }) {
  const isSelf  = socketId === myId;
  const now     = ts || Date.now();
  const isCont  = socketId === lastMsgSocketId && (now - lastMsgTime) < MSG_GROUP_MS;

  lastMsgSocketId = socketId;
  lastMsgTime     = now;

  const displayName = isSelf ? myUser?.username || "Você" : (name || socketId.slice(0, 6));
  const avatarSrc   = isSelf ? (myUser?.avatar || "") : (avatar || "");
  const isHostMsg   = isHost && isSelf; // show HOST badge on own messages if host

  const el = document.createElement("div");
  el.className = "msg msg-new" + (isSelf ? " self" : "") + (isCont ? " continuation" : "");

  if (isCont) {
    el.innerHTML = `
      <div class="avatar-col">
        <span class="ts-mini">${formatTs(now)}</span>
      </div>
      <div class="msg-content">
        <div class="text">${esc(text)}</div>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="avatar-col">
        <img src="${esc(avatarSrc)}" alt="${esc(displayName)}" onerror="this.src=''">
      </div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="who">${esc(displayName)}</span>
          ${isHostMsg ? '<span class="msg-host-badge">HOST</span>' : ""}
          <span class="ts">${formatTs(now)}</span>
        </div>
        <div class="text">${esc(text)}</div>
      </div>
    `;
  }

  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystem(text) {
  lastMsgSocketId = null; // break message grouping after system messages
  const el = document.createElement("div");
  el.className = "msg system";
  el.innerHTML = `<span class="system-text">${esc(text)}</span>`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function esc(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

// ── Members panel ─────────────────────────────────────────────────────────────
function renderMembers() {
  if (!membersList) return;
  membersList.innerHTML = "";
  const countEl = document.getElementById("members-count");
  if (countEl) countEl.textContent = roomMembers.size;

  for (const [socketId, m] of roomMembers) {
    const isSelf = socketId === myId;
    const item   = document.createElement("div");
    item.className = "member-item";
    item.dataset.socketId  = socketId;
    item.dataset.discordId = m.discordId || "";
    item.dataset.tip       = m.name || "";

    const isStreaming = streamPermissions.has(socketId);
    const ringClass = m.isHost ? "status-host" : isStreaming ? "status-stream" : "status-online";
    item.innerHTML = `
      <div class="member-avatar-wrap ${ringClass}">
        <img class="member-avatar" src="${esc(m.avatar || "")}" alt="${esc(m.name)}" onerror="this.src=''">
        <span class="member-online-dot"></span>
      </div>
      <div class="member-info">
        <div class="member-name">${esc(m.name)}${isSelf ? " <small>(você)</small>" : ""}</div>
        ${m.isHost ? '<div class="member-role role-host">👑 Host</div>' : isStreaming ? '<div class="member-role role-stream">📡 Stream</div>' : ""}
      </div>
    `;

    if (isHost && !isSelf) {
      const actions = document.createElement('div');
      actions.className = 'member-actions';
      if (m.discordId) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'member-action-btn kick';
        kickBtn.title = 'Remover ' + m.name;
        kickBtn.textContent = '✕';
        kickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm('Remover ' + m.name + ' da sala?')) socket.emit('kick-user', { discordId: m.discordId });
        });
        actions.appendChild(kickBtn);
      }
      const txBtn = document.createElement('button');
      txBtn.className = 'member-action-btn transfer';
      txBtn.title = 'Transferir host para ' + m.name;
      txBtn.textContent = '👑';
      txBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Transferir host para ' + m.name + '?')) socket.emit('transfer-host', { targetSocketId: socketId });
      });
      actions.appendChild(txBtn);

      // Stream permission button (host grants viewer ability to share screen)
      const hasPermission = streamPermissions.has(socketId);
      const permBtn = document.createElement('button');
      permBtn.className = 'member-action-btn perm' + (hasPermission ? ' perm-active' : '');
      permBtn.title = hasPermission ? 'Revogar permissão de stream' : 'Permitir compartilhar tela';
      permBtn.textContent = hasPermission ? '📡' : '🎥';
      permBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hasPermission) {
          socket.emit('revoke-stream-permission', { targetSocketId: socketId });
          streamPermissions.delete(socketId);
        } else {
          socket.emit('grant-stream-permission', { targetSocketId: socketId });
          streamPermissions.add(socketId);
        }
        renderMembers();
      });
      actions.appendChild(permBtn);

      item.appendChild(actions);
    }

    membersList.appendChild(item);
  }
}

// ── Transfer host modal ──────────────────────────────────────────────────────
function openTransferModal() {
  const modal = document.getElementById('transfer-modal');
  const list  = document.getElementById('transfer-list');
  if (!modal || !list) return;
  list.innerHTML = '';
  let hasOptions = false;
  for (const [socketId, m] of roomMembers) {
    if (socketId === myId) continue;
    hasOptions = true;
    const opt = document.createElement('div');
    opt.className = 'transfer-option';
    const img = document.createElement('img');
    img.src = m.avatar || '';
    const info = document.createElement('div');
    info.innerHTML = '<div class="t-name">' + (m.name || '').replace(/</g,'&lt;') + '</div><div class="t-role">Viewer</div>';
    opt.appendChild(img);
    opt.appendChild(info);
    opt.addEventListener('click', () => {
      if (confirm('Transferir host para ' + m.name + '?')) {
        socket.emit('transfer-host', { targetSocketId: socketId });
        modal.style.display = 'none';
      }
    });
    list.appendChild(opt);
  }
  if (!hasOptions) {
    list.innerHTML = '<p style="color:var(--dc-text-muted);text-align:center;padding:16px">Nenhum viewer na sala</p>';
  }
  modal.style.display = 'flex';
}
document.getElementById('transfer-cancel-btn')?.addEventListener('click', () => {
  document.getElementById('transfer-modal').style.display = 'none';
});
document.getElementById('transfer-host-btn')?.addEventListener('click', openTransferModal);

function updateCountDisplay() {
  if (userCountEl) userCountEl.textContent = onlineCount;
}

function updateTypingIndicator(typingUsers, el) {
  if (!el) return;
  if (typingUsers.size === 0) { el.innerHTML = ""; return; }
  const names = [...typingUsers.values()].slice(0, 3).map(n => esc(n));
  const label = names.join(", ") + (typingUsers.size === 1 ? " está digitando" : " estão digitando");
  el.innerHTML = label + `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>`;
}

// ── Room header ───────────────────────────────────────────────────────────────
const TYPE_ICONS  = { movie: "🎬", serie: "📺", youtube: "▶️", screenshare: "🖥️" };
const TYPE_LABELS = { movie: "Filme", serie: "Série", youtube: "YouTube", screenshare: "Screenshare" };

function setRoomHeader(type, media) {
  if (!roomIconEl || !roomTitleEl) return;
  roomIconEl.textContent = TYPE_ICONS[type] || "📺";
  roomBadgeEl.textContent = TYPE_LABELS[type] || type;
  roomBadgeEl.style.display = "inline-block";

  if (type === "movie" || type === "serie") {
    roomTitleEl.textContent = media.title + (media.season ? ` · S${media.season}E${media.episode}` : "");
  } else if (type === "youtube") {
    roomTitleEl.textContent = "YouTube Sync";
  } else if (type === "screenshare") {
    roomTitleEl.textContent = "Screen Share";
  }
}

// ── Media router ──────────────────────────────────────────────────────────────
function setupMedia(type, media) {
  if      (type === "movie" || type === "serie") setupIframePlayer(type, media);
  else if (type === "youtube")                   setupYouTube(media.videoId);
  else if (type === "screenshare")               isHost ? setupScreenshare() : setupRTCViewer();
}

// ── VidSrc Iframe Player ──────────────────────────────────────────────────────
let iframeSources  = [];
let currentSrcIdx  = 0;
let currentIframe  = null;
let iframeLoadedAt = 0;

async function setupIframePlayer(type, media) {
  document.title = `${TYPE_ICONS[type]} ${media.title}${media.season ? ` S${media.season}E${media.episode}` : ""} — Watch Party`;

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

  if (!sources.length) { showError("Nenhuma fonte de vídeo disponível."); return; }

  iframeSources = sources;
  currentSrcIdx = 0;
  buildIframeBar(media);

  socket.on("iframe-sync", ({ time, sourceIdx, autoSync }) => {
    if (isHost) return;
    const t = time || 0;
    loadIframe(sourceIdx || 0, t);
    addSystem(`${autoSync ? "⚡ Sincronizado automaticamente" : "🔄 Sincronizado com o host"}${t > 5 ? ` em ${formatTime(t)}` : ""}.`);
  });
}

function loadIframe(idx, startAtSeconds = 0) {
  if (!iframeSources[idx]) return;
  currentSrcIdx = idx;
  if (currentIframe) { currentIframe.remove(); currentIframe = null; }
  if (window._iframeWatchdog) { clearTimeout(window._iframeWatchdog); window._iframeWatchdog = null; }

  let url = iframeSources[idx].url;
  if (startAtSeconds > 5) {
    const sep = url.includes("?") ? "&" : "?";
    if (url.includes("moviesnexus")) url += `${sep}startAt=${startAtSeconds}`;
    else if (url.includes("vidcore")) url += `${sep}t=${startAtSeconds}`;
  }

  const iframe = document.createElement("iframe");
  iframe.src             = url;
  iframe.allowFullscreen = true;
  iframe.allow           = "autoplay; fullscreen; encrypted-media; picture-in-picture";
  iframe.style.cssText   = "width:100%;height:100%;border:none;display:block;background:#000;";
  mediaEl.appendChild(iframe);
  currentIframe  = iframe;
  iframeLoadedAt = Date.now() - (startAtSeconds * 1000);

  const seekLabel = startAtSeconds > 5 ? ` · ⏩ ${formatTime(startAtSeconds)}` : "";
  addSystem(`▶ ${iframeSources[idx].provider} · ${iframeSources[idx].label || "Auto"}${seekLabel}`);

  const baseUrl = iframeSources[idx].url.split("?")[0];
  window._iframeWatchdog = setTimeout(() => {
    if (currentIframe && currentIframe.src.startsWith(baseUrl)) {
      const nextInGroup = iframeSources.map((s,i) => ({...s,i}))
        .filter(s => s.lang === iframeSources[idx].lang && s.i !== idx);
      if (nextInGroup.length > 0) {
        addSystem(`⏱ Sem resposta — tentando ${nextInGroup[0].provider}…`);
        loadIframe(nextInGroup[0].i, startAtSeconds);
      }
    }
  }, 14000);
}

// Block popup attempts from player iframes
(function blockPopups() {
  const _open = window.open.bind(window);
  window.open = function(url, target, features) {
    if (!url) return _open(url, target, features);
    console.warn("[security] window.open bloqueado:", url);
    return null;
  };
})();

function buildIframeBar(media) {
  const bar = document.createElement("div");
  bar.id = "iframe-bar";

  // Title
  const titleSpan = document.createElement("span");
  titleSpan.textContent = media.title + (media.season ? ` · S${media.season}E${media.episode}` : "");
  titleSpan.style.cssText = "opacity:.6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;";
  bar.appendChild(titleSpan);

  const dot = document.createElement("span");
  dot.textContent = "·"; dot.style.opacity = ".3";
  bar.appendChild(dot);

  const groups = [
    { key:"dub",  label:"🇧🇷 DUB",  color:"#e74c3c", title:"Dublado PT-BR" },
    { key:"leg",  label:"🇧🇷 LEG",  color:"#3498db", title:"Legendado PT-BR" },
    { key:"auto", label:"EN/Auto", color:"#555",    title:"Inglês / Auto" },
  ];
  const groupIdx = { dub:0, leg:0, auto:0 };
  let activeKey = null;

  function activateGroup(key) {
    activeKey = key;
    bar.querySelectorAll("[data-lang-group]").forEach(b => {
      const g = groups.find(g => g.key === b.dataset.langGroup);
      b.style.background = b.dataset.langGroup === key ? (g?.color || "#555") : "transparent";
    });
  }

  groups.forEach(({ key, label, color, title: ttip }) => {
    if (!iframeSources.some(s => s.lang === key)) return;
    const btn = document.createElement("button");
    btn.dataset.langGroup = key;
    btn.textContent = label;
    btn.title = ttip;
    btn.style.cssText = `padding:3px 9px;border:1px solid ${color};background:${key==="dub"?color:"transparent"};color:#fff;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;`;
    btn.addEventListener("click", () => {
      activateGroup(key);
      const srcs = iframeSources.map((s,i) => ({...s,i})).filter(s => s.lang === key);
      const next = srcs[groupIdx[key] % srcs.length];
      groupIdx[key] = (groupIdx[key]+1) % srcs.length;
      loadIframe(next.i);
    });
    bar.appendChild(btn);
  });

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  bar.appendChild(spacer);

  // Fullscreen button
  const fsBtn = document.createElement("button");
  fsBtn.textContent = "⛶"; fsBtn.title = "Fullscreen";
  fsBtn.style.cssText = "padding:3px 8px;background:transparent;color:#fff;font-size:14px;border:1px solid #555;border-radius:4px;cursor:pointer;";
  fsBtn.addEventListener("click", () => {
    const t = currentIframe || mediaEl;
    if (t.requestFullscreen) t.requestFullscreen();
    else if (t.webkitRequestFullscreen) t.webkitRequestFullscreen();
  });
  bar.appendChild(fsBtn);

  if (isHost) {
    const syncBtn = document.createElement("button");
    syncBtn.id = "sync-btn";
    syncBtn.textContent = "📍 Sync";
    syncBtn.title = "Envia sua posição atual para todos os viewers";
    syncBtn.style.cssText = "padding:3px 12px;background:#23a559;color:#fff;font-weight:700;border:none;border-radius:4px;cursor:pointer;font-size:11px;transition:background 0.3s;";
    syncBtn.addEventListener("click", () => {
      const elapsed = Math.floor((Date.now() - iframeLoadedAt) / 1000);
      socket.emit("iframe-sync", { time: elapsed, sourceIdx: currentSrcIdx });
      addSystem(`📍 Sync enviado (${formatTime(elapsed)} desde o início).`);
      syncBtn.textContent = "✅";
      setTimeout(() => { syncBtn.textContent = "📍 Sync"; }, 2000);
    });
    bar.appendChild(syncBtn);

    setInterval(() => {
      const el = document.getElementById("sync-btn");
      if (!el) return;
      el.title = `Posição atual: ${formatTime(Math.floor((Date.now()-iframeLoadedAt)/1000))} — clique para sincronizar`;
    }, 5000);
  } else {
    const hint = document.createElement("span");
    hint.textContent = "⏳ aguardando host";
    hint.style.cssText = "font-size:10px;color:var(--dc-text-muted);";
    bar.appendChild(hint);
  }

  mediaEl.style.position = "relative";
  mediaEl.appendChild(bar);
  mediaEl.style.paddingTop = "38px";

  const firstDub = iframeSources.findIndex(s => s.lang === "dub");
  loadIframe(firstDub >= 0 ? firstDub : 0);
  activateGroup(firstDub >= 0 ? "dub" : "auto");
}

// ── YouTube ───────────────────────────────────────────────────────────────────
let ytPlayer = null, ytReady = false, suppressYT = false;

function setupYouTube(videoId) {
  document.title = "▶ YouTube Watch Party";
  const ph = document.createElement("div");
  ph.id = "yt-player"; ph.style.cssText = "width:100%;height:100%;";
  mediaEl.appendChild(ph);
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = () => {
    ytPlayer = new YT.Player("yt-player", {
      videoId, width:"100%", height:"100%",
      playerVars: { autoplay:0, rel:0, modestbranding:1 },
      events: {
        onReady() { ytReady = true; addSystem("YouTube pronto. Sync ativo."); },
        onStateChange(e) {
          if (suppressYT || !ytReady) return;
          const t = ytPlayer.getCurrentTime();
          if      (e.data === YT.PlayerState.PLAYING) socket.emit("yt-action", { action:"play",  time:t });
          else if (e.data === YT.PlayerState.PAUSED)  socket.emit("yt-action", { action:"pause", time:t });
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

// ── WebRTC ────────────────────────────────────────────────────────────────────

// ── Multi-stream support ──────────────────────────────────────────────────────
// Map<socketId, { stream, videoEl, peerId }> — active incoming streams
const activeStreams = new Map();

function addStreamVideo(fromId, stream) {
  // Remove existing video for this peer if any
  removeStreamVideo(fromId);

  const wrapper = document.createElement("div");
  wrapper.id = "stream-" + fromId;
  wrapper.className = "stream-tile";

  const v = document.createElement("video");
  v.autoplay = true; v.playsInline = true;
  // Start muted so autoplay is guaranteed; user can click tile to unmute
  v.muted = true;
  v.srcObject = stream;

  const label = document.createElement("div");
  label.className = "stream-label";
  // roomMembers key IS the socketId — use .get() directly
  let labelName;
  if (fromId === myId || fromId === "local") {
    labelName = myUser?.username || "Você";
  } else {
    const member = roomMembers.get(fromId);
    labelName = member ? member.name : fromId.slice(0, 6);
  }
  label.textContent = labelName;

  const badge = document.createElement("div");
  badge.className = "stream-live-badge";
  badge.textContent = "AO VIVO";

  wrapper.appendChild(v);
  wrapper.appendChild(label);
  wrapper.appendChild(badge);

  wrapper.addEventListener("click", () => {
    focusStream(fromId);
    // Toggle mute on click
    if (v.muted) {
      v.muted = false;
      // Show brief "🔊" indicator
      const s2 = activeStreams.get(fromId);
      if (s2) {
        const ind = document.createElement("div");
        ind.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:32px;pointer-events:none;opacity:1;transition:opacity .6s;";
        ind.textContent = "🔊";
        wrapper.appendChild(ind);
        setTimeout(() => { ind.style.opacity = "0"; setTimeout(() => ind.remove(), 600); }, 800);
      }
    }
  });

  activeStreams.set(fromId, { stream, videoEl: v, wrapper });

  // Add to grid — ensure visible
  ensureStreamGrid();
  const grid = document.getElementById("stream-grid");
  if (grid) {
    grid.style.display = "flex";
    grid.appendChild(wrapper);
  } else {
    mediaEl.appendChild(wrapper);
  }

  // Play when metadata is ready — avoids black frame on slow WebRTC negotiation
  const tryPlay = () => v.play().catch(e => console.warn("[stream] play failed:", e));
  if (v.readyState >= 2) {
    tryPlay();
  } else {
    v.addEventListener("loadedmetadata", tryPlay, { once: true });
  }
  updateStreamLayout();
}

function removeStreamVideo(fromId) {
  const s = activeStreams.get(fromId);
  if (s) {
    // Do NOT stop remote tracks — only localStream tracks are ours to stop.
    // Tracks are stopped exclusively by stopShare().
    s.wrapper?.remove();
    activeStreams.delete(fromId);
  }
  const grid = document.getElementById("stream-grid");
  if (grid && activeStreams.size === 0) grid.style.display = "none";
  updateStreamLayout();
}

function focusStream(fromId) {
  // Toggle focused class — focused stream takes full width
  const s = activeStreams.get(fromId);
  if (!s) return;
  const isFocused = s.wrapper.classList.contains('focused');
  activeStreams.forEach(st => st.wrapper.classList.remove('focused'));
  if (!isFocused) s.wrapper.classList.add('focused');
  updateStreamLayout();
}

function updateStreamLayout() {
  const grid = document.getElementById('stream-grid');
  if (!grid) return;
  const count = activeStreams.size;
  if (count === 0) {
    grid.style.display = 'none';
    return;
  }
  grid.style.display = 'flex';
  grid.style.flexWrap = 'wrap';
  grid.style.gap = '4px';
  grid.style.width = '100%';
  grid.style.height = '100%';
  // If one is focused, give it 70% width
  const focused = [...activeStreams.values()].find(s => s.wrapper.classList.contains('focused'));
  if (focused && count > 1) {
    focused.wrapper.style.flex = '0 0 calc(70% - 2px)';
    activeStreams.forEach((s) => {
      if (!s.wrapper.classList.contains('focused')) s.wrapper.style.flex = '1 1 calc(30% - 2px)';
    });
  } else {
    activeStreams.forEach(s => { s.wrapper.style.flex = '1 1 calc(50% - 2px)'; });
  }
}


// Set of socketIds that the host has granted stream permission to
const streamPermissions = new Set();
let localStream = null;
const peers     = {};
let rtcSetup    = false;
let _sharingInProgress = false;

const ICE = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]};

function setupScreenshare() {
  if (rtcSetup) return; rtcSetup = true;
  document.title = "🖥️ Screen Share — Watch Party";
  ensureStreamGrid();
  setupRTCSignaling();
  const pc     = document.getElementById('player-controls');
  const btnSh  = document.getElementById('btn-share-screen');
  const btnSt  = document.getElementById('btn-stop-share');
  const btnFs  = document.getElementById('btn-fullscreen');
  if (pc) pc.style.display = 'flex';
  // Show share controls for host
  const shareGroup = document.getElementById("ctrl-share-group");
  if (shareGroup) shareGroup.style.display = "flex";
  if (btnSh) btnSh.addEventListener('click', startShare);
  if (btnSt) btnSt.addEventListener('click', stopShare);
  if (btnFs) btnFs.addEventListener('click', () => {
    const v = document.getElementById('screen-video') || document.getElementById('media-container');
    if (v?.requestFullscreen) v.requestFullscreen();
  });
}

function setupRTCViewer() {
  if (rtcSetup) return; rtcSetup = true;
  document.title = "🖥️ Screen Share — Watch Party";
  ensureStreamGrid();
  setupRTCSignaling();
  const pc = document.getElementById("player-controls");
  const waiting = document.getElementById("ctrl-viewer-waiting");
  if (pc) pc.style.display = "flex";
  if (waiting) waiting.style.display = "flex";
  addSystem("Aguardando stream do host…");
  setTimeout(() => socket.emit("rtc-request-stream"), 800);
}


function ensureStreamGrid() {
  if (document.getElementById('stream-grid')) return;
  const grid = document.createElement('div');
  grid.id = 'stream-grid';
  // No inline style — CSS handles display:none/.stream-tile etc
  mediaEl.appendChild(grid);
}
function setupRTCSignaling() {
  socket.on("rtc-request-stream", ({ from }) => { if (localStream && from !== socket.id) sendOffer(from); });
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
  if (_sharingInProgress) return;
  _sharingInProgress = true;
  try {
    closeAllPeers();
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

    // Host also uses the stream-grid so all streams (own + others) are visible together
    addStreamVideo(myId || "local", localStream);

    const _bsh = document.getElementById("btn-share-screen");
    const _bst = document.getElementById("btn-stop-share");
    if (_bsh) _bsh.style.display = "none";
    if (_bst) _bst.style.display = "flex";
    addSystem("Compartilhando sua tela.");
    socket.emit("stream-started");

    localStream.getVideoTracks()[0].onended = stopShare;
  } catch (err) {
    _sharingInProgress = false;
    if (err.name === "NotAllowedError") addSystem("Compartilhamento cancelado.");
    else { addSystem("Erro ao compartilhar: " + (err.message || err.name)); console.error("[screenshare]", err); }
  }
}


function stopShare() {
  _sharingInProgress = false;
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  removeStreamVideo(myId || "local");
  closeAllPeers();
  const _bsh = document.getElementById("btn-share-screen");
  const _bst = document.getElementById("btn-stop-share");
  if (_bsh) _bsh.style.display = "flex";
  if (_bst) _bst.style.display = "none";
  addSystem("Compartilhamento encerrado.");
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
    if (!streams || !streams[0]) return;
    const stream = streams[0];
    // Wait until at least one track is live before rendering
    const doAdd = () => {
      const member = roomMembers.get(peerId);
      const memberName = member ? member.name : peerId.slice(0, 6);
      addStreamVideo(peerId, stream);
      addSystem("📺 Recebendo tela de " + memberName + ".");
      const _wt = document.getElementById("ctrl-viewer-waiting");
      const _rv = document.getElementById("ctrl-viewer-receiving");
      if (_wt) _wt.style.display = "none";
      if (_rv) _rv.style.display = "flex";
    };
    if (stream.getTracks().some(t => t.readyState === "live")) {
      doAdd();
    } else {
      stream.addEventListener("active", doAdd, { once: true });
    }
  };
  return pc;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanupScreenVideo() {
  // Clear old single-video element (legacy)
  const v = document.getElementById("screen-video");
  if (v) { if (v.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; } v.remove(); }
  // Clear multi-stream grid
  activeStreams.forEach((s, id) => removeStreamVideo(id));
}

function closeAllPeers() {
  for (const id of Object.keys(peers)) { peers[id].close(); delete peers[id]; }
}

function formatTime(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

function formatTs(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
}

function showError(msg) {
  if (errorText)    errorText.textContent = msg;
  if (errorOverlay) errorOverlay.style.display = "flex";
}
