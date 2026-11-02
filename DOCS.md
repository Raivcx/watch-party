# Watch Party — Documentação

## Bot do Discord

O bot roda junto com o servidor (mesmo processo Node). Ele escuta slash commands no servidor Discord e cria as salas de watch party.

---

### Comandos

#### `/watch`
Cria uma sala para assistir **filme ou série** com player iframe sincronizado.

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `type` | Escolha | `Movie` ou `Series` |
| `name` | Texto | Nome do título para buscar no TMDB |

- Para **séries**: abre um modal pedindo temporada e episódio antes de criar a sala.
- O bot busca metadados (título, poster, sinopse, ano) na API do TMDB.
- A resposta é um embed com botão **Join Room** linkando para a sala.

#### `/yt`
Cria uma sala com **YouTube sincronizado**.

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `link` | Texto | URL do YouTube ou ID do vídeo (ex: `dQw4w9WgXcQ`) |

- Qualquer ação de play/pause/seek de qualquer participante é replicada para todos em tempo real.
- A resposta inclui thumbnail do vídeo e botão **Join Room**.

#### `/screenshare`
Cria uma sala de **compartilhamento de tela** via WebRTC peer-to-peer.

- Não precisa de parâmetros.
- Quem usou o comando é o host e pode iniciar a transmissão.
- Viewers precisam de permissão explícita do host para também compartilhar.

#### `/status`
Lista todas as salas abertas no momento (resposta visível só para quem usou o comando).

Mostra por sala: tipo, título, quantidade de pessoas online, tempo ativo e link para entrar.

---

### Como a sala é criada

1. O bot cria a sala em memória (`roomStore`) com um UUID único.
2. O `creatorId` é definido como o Discord ID de quem usou o comando — imutável.
3. O bot posta o embed com o link `https://[domínio]/room/[uuid]`.
4. Qualquer pessoa com o link pode entrar (desde que autenticada com Discord OAuth2).

---

## Interface da Sala

### Autenticação

Ao acessar qualquer sala sem estar logado, o site redireciona para o Discord OAuth2 e volta automaticamente para a sala após o login.

---

### Painel de Membros (lado direito)

| Ícone | Significado |
|-------|-------------|
| Anel dourado | Host da sala |
| Anel verde | Viewer online |
| Anel roxo | Viewer com permissão de stream |
| `📡 Stream` | Este membro pode/está compartilhando tela |

O painel pode ser colapsado (modo ícones) ou ocultado completamente pelo botão no cabeçalho do chat.

---

### Botões — Host

O host é quem usou o slash command. Se o host der F5 ou reconectar em até 12 segundos, recupera o controle automaticamente.

#### Cabeçalho da sala
| Botão | Ação |
|-------|------|
| **Transferir Host** | Abre modal para escolher um viewer e passar o controle da sala |

#### Painel de membros (ações por membro)
| Botão | Ação |
|-------|------|
| `✕` | Remove o membro da sala (ban temporário até a sala fechar) |
| `👑` | Transfere o host diretamente para este membro |
| `🎥` | Dá permissão de screenshare para este viewer |
| `📡` | Revoga a permissão de screenshare deste viewer |

#### Barra de controles — Sala de Screenshare
| Botão | Estado | Ação |
|-------|--------|------|
| **Compartilhar Tela** | Visível quando não está compartilhando | Abre o seletor de captura do OS e inicia a transmissão WebRTC |
| **Parar** | Visível durante compartilhamento ativo | Para a captura, fecha todas as conexões peer, remove o tile do grid |

#### Barra de controles — Sala de Filme/Série
| Botão | Ação |
|-------|------|
| **📍 Sync** | Envia a posição atual do player para todos os viewers sincronizarem |
| **⛶ Fullscreen** | Abre o player em tela cheia |
| Botões DUB / LEG / EN | Troca a fonte de vídeo para dublado, legendado ou inglês |

#### Barra de controles — YouTube
| Botão | Ação |
|-------|------|
| **⛶ Fullscreen** | Abre o player em tela cheia |

---

### Botões — Viewer

#### Barra de controles — Sala de Screenshare

| Elemento | Descrição |
|----------|-----------|
| `● Aguardando transmissão…` | Nenhum stream ativo no momento |
| `● Ao vivo` | Recebendo stream, tudo funcionando |
| **Compartilhar Tela** | Aparece somente após o host conceder permissão — funciona igual ao do host |
| **Parar** | Para a própria transmissão do viewer (visível só enquanto está compartilhando) |

#### Barra de controles — Filme/Série
| Elemento | Descrição |
|----------|-----------|
| `⏳ aguardando host` | O host ainda não sincronizou — posição do player não foi recebida |

Viewers de filme/série **não controlam** o player. A posição é controlada pelo host via botão Sync.

#### Barra de controles — YouTube
Todos os participantes podem dar play/pause/seek — qualquer ação é replicada para a sala inteira.

---

## Grid de Streams (Screenshare)

- Cada stream aparece como um **tile** com badge "AO VIVO" e nome do participante.
- **Clicar no tile** foca aquela stream (ocupa 70% do grid) e **desmuta** o áudio.
- Por padrão todos os tiles começam **mutados** para garantir autoplay.
- Quando há apenas um stream, ele ocupa o grid inteiro.
- Quando há dois ou mais, dividem o espaço igualmente (50/50), exceto se um estiver focado (70/30).

---

## Chat

- Mensagens agrupadas por autor em janelas de 5 minutos (estilo Discord).
- Limite de 5 mensagens por 5 segundos por usuário (client-side) e 10 por 10 segundos (server-side).
- Indicador de digitação em tempo real.
- Máximo de 500 caracteres por mensagem.
