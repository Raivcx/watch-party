# Tasks — Watch Party Platform

## Status: ✅ Completo + Melhorias Aplicadas

---

## 1. Setup & Dependências
- [x] `package.json` com Express, discord.js, Socket.IO, axios, dotenv
- [x] `.env.example` com todas as variáveis (DISCORD_TOKEN, CLIENT_ID, TMDB_API_KEY, PUBLIC_URL, PORT)
- [x] `.gitignore`
- [x] `render.yaml` para deploy one-click no Render

## 2. Backend / WebSockets
- [x] `server.js` — Express (REST + static) + Socket.IO server
- [x] `lib/roomStore.js` — store in-memory com create/get/delete/prune (salas expiram em 4h)
- [x] `lib/tmdb.js` — busca de filmes/séries via TMDB API + info de temporadas
- [x] `lib/youtube.js` — extração de video ID de múltiplos formatos de URL
- [x] Endpoint `/health` para keep-alive (UptimeRobot)
- [x] Endpoint `/api/room/:id` para metadados da sala
- [x] Rota `/room/:id` serve o frontend
- [x] Socket.IO: join-room, chat-message, yt-action (sync)
- [x] Socket.IO: WebRTC signaling (rtc-offer, rtc-answer, rtc-ice, rtc-request-stream)
- [x] **[FIX]** Race condition do `hostSocketId` corrigido — host definido antes do `room-info` ser emitido
- [x] **[FIX]** `userCount` real enviado no `room-info` e em todos os eventos join/leave
- [x] **[FIX]** Validação de UUID no `join-room` e nas rotas REST
- [x] **[FIX]** Rate limit server-side no chat (10 msgs / 10s por socket)
- [x] Typing indicator: eventos `typing-start` / `typing-stop` repassados para a sala
- [x] Propagação de `name` nos eventos `user-joined`, `user-left`, `chat-message`

## 3. Comandos do Discord (Bot)
- [x] `bot/deploy-commands.js` — registro de slash commands
- [x] `bot/index.js` — listener de interações
- [x] `/watch movie <name>` → busca TMDB → cria sala com player integrado
- [x] `/watch serie <name>` → busca TMDB → pede temporada/episódio → cria sala
- [x] `/yt <link>` → extrai video ID → cria sala com YouTube embed
- [x] `/screenshare` → cria sala com WebRTC
- [x] `/status` → lista salas abertas com links
- [x] Embeds com botão "Join Room" linkando para a sala
- [x] Tratamento de erros em cada comando

## 4. Frontend Vanilla JS
- [x] `public/index.html` — landing page
- [x] `public/room.html` — layout 75% mídia / 25% chat
- [x] `public/css/style.css` — tema dark, responsivo (mobile stacking)
- [x] `public/js/room.js` — cliente Socket.IO completo:
  - [x] **[FIX]** Listener `user-joined` unificado — chat + WebRTC sem sobrescrita
  - [x] **[FIX]** Contagem de usuários sincronizada com o servidor
  - [x] **[FIX]** Estado visual dos botões DUB/LEG/Auto corrigido (função `activateGroup`)
  - [x] Chat em tempo real com nomes de usuário
  - [x] Modal de nome de usuário (salvo no localStorage)
  - [x] Rate limit client-side (5 msgs / 5s)
  - [x] Indicador "X está digitando…"
  - [x] Botão fullscreen nativo para o player de iframe
  - [x] Pomfy/VidSrc player via iframe (movie/serie)
  - [x] YouTube IFrame Player API com sync play/pause/seek
  - [x] WebRTC screen share (host: getDisplayMedia, viewer: receive stream)
  - [x] WebRTC: fecha peer connections de usuários que saíram
  - [x] Contagem de usuários online (real)
  - [x] Error overlay para sala inválida

## 5. Documentação & Deploy
- [x] `README.md` — overview, arquitetura, quick start
- [x] `DEPLOY.md` — guia passo a passo
- [x] `roadmap.md` — arquitetura detalhada, fluxos de dados, limitações

## 6. Verificação
- [ ] `npm install` (requer execução local)
- [ ] Teste local com tokens reais (depende do usuário)
- [ ] Deploy no Render (depende do usuário)
