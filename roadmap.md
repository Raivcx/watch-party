# Roadmap — Watch Party Platform

## Visão Geral

Plataforma de watch party via Discord: usuários geram links de salas privadas para assistir filmes/séries (Pomfy), vídeos do YouTube sincronizados, ou compartilhar a tela via WebRTC. Cada sala tem chat em tempo real.

## Arquitetura

```
┌──────────────┐     Slash Commands      ┌─────────────────────────────────┐
│  Discord     │ ──────────────────────► │  Node.js (processo único)        │
│  Bot         │                         │                                 │
│ (discord.js) │ ◄──── link da sala ──── │  ┌────────────┐  ┌───────────┐  │
└──────────────┘                         │  │ Express   │  │ Socket.IO │  │
                                         │  │ (REST +   │  │ (chat, YT │  │
┌──────────────┐                         │  │  static)  │  │ sync,     │  │
│  Navegador   │ ◄── HTML/JS/CSS ────── │  └────────────┘  │ WebRTC)   │  │
│  (cliente)   │ ─── WebSocket ────────► │                  └───────────┘  │
└──────────────┘                         │                                 │
                                         │  ┌──────────────────────────┐   │
┌──────────────┐  HTTPS (TMDB search)   │  │ Room Store (in-memory)   │   │
│  TMDB API    │ ◄──────────────────── │  │ Map<roomId, {type,media}>│   │
└──────────────┘                         │  └──────────────────────────┘   │
                                         └─────────────────────────────────┘
                                                      │
                                                      │ deploy
                                                      ▼
                                              Render Free Tier
```

## Decisões de Design (Free Tier)

| Decisão | Por quê |
|---------|---------|
| Um processo Node (bot + web) | Render free = 1 web service |
| Room store in-memory | 512 MB RAM é suficiente; salas são efêmeras |
| STUN do Google | Free; sem TURN para grupos pequenos |
| `/health` + UptimeRobot | Evita sleep do Render free |
| Frontend servido pelo backend | Sem custo extra de Vercel; 1 domínio |
| Supabase opcional | Só se salas precisam sobreviver a restarts |

## Stack

- **Runtime:** Node.js 18+ (ES Modules)
- **Bot:** discord.js 14 (slash commands)
- **Web:** Express 4 (REST + static) + Socket.IO 4 (WebSocket)
- **Real-time:** WebRTC (peer-to-peer) + Socket.IO (signaling + chat)
- **APIs externas:** TMDB (metadados), Pomfy (player), YouTube IFrame API
- **Frontend:** Vanilla HTML/CSS/JS (sem build step)

## Estrutura de Arquivos

```
watch-party/
├── server.js              # Express + Socket.IO + inicia bot
├── package.json
├── render.yaml            # Config de deploy no Render
├── .env.example
├── .gitignore
├── README.md
├── DEPLOY.md              # Guia de deploy passo a passo
├── bot/
│   ├── index.js           # Listeners de slash commands
│   └── deploy-commands.js # Registro de commands (1x)
├── lib/
│   ├── roomStore.js       # Store in-memory (create/get/prune)
│   ├── tmdb.js            # Wrapper da API TMDB
│   └── youtube.js         # Extração de video ID
└── public/
    ├── index.html         # Landing page
    ├── room.html          # Layout 75% mídia / 25% chat
    ├── css/style.css      # Tema dark, responsivo
    └── js/room.js         # Chat + YT sync + Pomfy + WebRTC client
```

## Fluxo de Dados

### 1. Criar sala (Discord → Server)
```
User digita /watch movie Inception
  → Bot busca TMDB → obtem TMDB ID
  → Bot chama createRoom() → gera UUID
  → Bot responde no Discord com link: https://app/room/{uuid}
```

### 2. Entrar na sala (Browser → WebSocket)
```
Browser carrega /room/{uuid}
  → socket.emit("join-room", uuid)
  → Server valida sala, adiciona ao Socket.IO room
  → Server envia room-info (type + media)
  → Frontend monta player apropriado
```

### 3. YouTube Sync
```
User clica Play → YT API onStateChange
  → socket.emit("yt-action", {action:"play", time})
  → Server broadcasta para outros no room
  → Outros clients: ytPlayer.seekTo(time); playVideo()
```

### 4. WebRTC Screen Share
```
Host clica "Start Screen Share"
  → getDisplayMedia() → stream local
Viewer entra → socket "user-joined"
  → Host cria RTCPeerConnection → createOffer
  → Server relaya SDP offer/answer + ICE candidates
  → Viewer recebe stream via pc.ontrack
```

### 5. Chat
```
User digita msg → socket.emit("chat-message", {text})
  → Server broadcasta io.to(roomId)
  → Todos clients renderizam a mensagem
```

## Limitações Conhecidas (Free Tier)

- Render free dorme após 15 min inativo (mitigado com UptimeRobot)
- Salas in-memory se perrem no sleep/restart
- WebRTC sem TURN: falha em redes restritivas (NAT simétrico)
- Pomfy pode estar indisponível ou bloqueado por região
- YouTube sync tem ~1-3s de atraso (latência de rede)
