// Discord bot: listens for slash commands, creates rooms, replies with links.
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  Events,
} from "discord.js";
import { extractYouTubeId, extractPlaylistId, fetchPlaylistItems, fetchVideoTitle } from "../lib/youtube.js";
import { createRoom, getRoom, closeRoom, listRooms } from "../lib/roomStore.js";
import { commands } from "./commands.js";

if (!process.env.DISCORD_TOKEN) console.error("[bot] DISCORD_TOKEN is not set!");
if (!process.env.CLIENT_ID)     console.error("[bot] CLIENT_ID is not set!");
if (!process.env.YOUTUBE_API_KEY) console.warn("[bot] YOUTUBE_API_KEY is not set — /yt playlist will not work.");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

// Auto-register guild slash commands on startup
client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Discord bot online as ${c.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    const guilds = c.guilds.cache;
    for (const [guildId, guild] of guilds) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands },
      );
      console.log(`[bot] Commands registered in guild: ${guild.name} (${guildId})`);
    }
    console.log(`[bot] Slash commands registered in ${guilds.size} guild(s).`);
  } catch (err) {
    console.error("[bot] Failed to auto-register commands:", err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      console.log(`[bot] Command received: /${interaction.commandName}`);
      if      (interaction.commandName === "yt")          await handleYouTube(interaction);
      else if (interaction.commandName === "ytpl")        await handlePlaylist(interaction);
      else if (interaction.commandName === "screenshare") await handleScreenshare(interaction);
      else if (interaction.commandName === "camera")      await handleCamera(interaction);
      else if (interaction.commandName === "status")      await handleStatus(interaction);
      else if (interaction.commandName === "close")       await handleClose(interaction);
    } else if (interaction.isStringSelectMenu() && interaction.customId === "close_room_select") {
      await handleCloseSelect(interaction);
    } else if (interaction.isButton() && interaction.customId === "close_room_cancel") {
      await interaction.update({ content: "Operação cancelada.", embeds: [], components: [] });
    }
  } catch (err) {
    console.error(`[bot] Unhandled error in interaction:`, err);
    const payload = { content: "Algo deu errado. Tente novamente.", ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch { /* expired */ }
  }
});

// --- /yt <link> — sala com fila habilitada, começa com 1 vídeo ---
async function handleYouTube(interaction) {
  const link    = interaction.options.getString("link");
  const videoId = extractYouTubeId(link);
  if (!videoId) return interaction.reply({ content: "Link do YouTube inválido.", ephemeral: true });

  // Fetch video title if API key available
  const videoTitle = await fetchVideoTitle(videoId);

  // Cria sala com fila contendo o vídeo inicial — mais podem ser adicionados no player
  const room = createRoom({
    type:       "youtube",
    media:      {
      queue:      [{ videoId, title: videoTitle }],
      queueIndex: 0,
    },
    hostUserId: interaction.user.id,
  });
  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;

  const embed = new EmbedBuilder()
    .setTitle("📺 YouTube Watch Party")
    .setDescription("Fila ativada — adicione mais vídeos dentro do player.\nClique no botão para entrar.")
    .setURL(roomUrl)
    .setColor(0xff0000)
    .setThumbnail(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);

  return interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
    )],
  });
}

// --- /ytpl <link> — carrega playlist completa ---
async function handlePlaylist(interaction) {
  if (!process.env.YOUTUBE_API_KEY) {
    return interaction.reply({ content: "⚠️ YOUTUBE_API_KEY não está configurado.", ephemeral: true });
  }

  await interaction.deferReply();

  const link       = interaction.options.getString("link");
  const playlistId = extractPlaylistId(link);
  if (!playlistId) {
    return interaction.editReply("Link de playlist inválido. Use um link com `list=PLxxx`.");
  }

  let items;
  try {
    items = await fetchPlaylistItems(playlistId);
  } catch (err) {
    console.error("[bot] fetchPlaylistItems failed:", err.message);
    return interaction.editReply("Não foi possível carregar a playlist. Verifique se o link está correto e se a playlist é pública.");
  }

  if (!items.length) return interaction.editReply("A playlist está vazia ou é privada.");

  const room = createRoom({
    type:       "youtube",
    media:      { queue: items, queueIndex: 0 },
    hostUserId: interaction.user.id,
  });
  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;

  const preview = items.slice(0, 5).map((v, i) => `${i + 1}. ${v.title}`).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("📋 Playlist Watch Party")
    .setDescription(`**${items.length} vídeos** na fila\n\n${preview}${items.length > 5 ? `\n*...e mais ${items.length - 5}*` : ""}`)
    .setURL(roomUrl)
    .setColor(0xff0000)
    .setThumbnail(`https://img.youtube.com/vi/${items[0].videoId}/hqdefault.jpg`);

  return interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
    )],
  });
}

// --- /screenshare ---
async function handleScreenshare(interaction) {
  const room = createRoom({ type: "screenshare", media: {}, hostUserId: interaction.user.id });
  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;
  const embed = new EmbedBuilder()
    .setTitle("🖥️ Screen Share Room")
    .setDescription("Clique no botão para entrar.\nO host compartilhará a tela via WebRTC.")
    .setURL(roomUrl)
    .setColor(0x2ecc71);
  return interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
    )],
  });
}

// --- /camera ---
async function handleCamera(interaction) {
  const room = createRoom({ type: "camera", media: {}, hostUserId: interaction.user.id });
  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;
  const embed = new EmbedBuilder()
    .setTitle("📷 Camera Stream Room")
    .setDescription("Clique no botão para entrar.\nO host poderá transmitir a câmera ou tela via WebRTC.")
    .setURL(roomUrl)
    .setColor(0x9b59b6);
  return interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
    )],
  });
}

// --- /status ---
async function handleStatus(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const rooms = listRooms();
  if (rooms.length === 0) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("📊 Status do Servidor").setDescription("Nenhuma sala aberta no momento.").setColor(0x5865f2)],
    });
  }
  const typeEmoji = { youtube: "▶️", screenshare: "🖥️", camera: "📷" };
  const typeLabel = { youtube: "YouTube", screenshare: "Screenshare", camera: "Câmera" };
  const lines = rooms.map((r) => {
    const emoji   = typeEmoji[r.type] || "📺";
    const label   = typeLabel[r.type] || r.type;
    const title   = r.type === "youtube" ? `YouTube · ${r.title}` : r.type === "camera" ? "Camera Stream" : "Screen Share";
    const roomUrl = `${PUBLIC_URL}/room/${r.id}`;
    const users   = r.userCount > 0 ? `👥 ${r.userCount}` : "👤 vazia";
    const age     = Math.floor((Date.now() - r.createdAt) / 60000);
    const ageStr  = age < 60 ? `${age}m` : `${Math.floor(age / 60)}h${age % 60}m`;
    return `${emoji} **${title}** · ${label} · ${users} · ${ageStr}\n[Entrar na sala](${roomUrl})`;
  });
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(`📊 Status — ${rooms.length} sala${rooms.length !== 1 ? "s" : ""} ativa${rooms.length !== 1 ? "s" : ""}`)
      .setDescription(lines.join("\n\n"))
      .setColor(0x5865f2)
      .setFooter({ text: PUBLIC_URL })],
  });
}

// --- /close — abre menu do Discord para selecionar a sala a ser fechada ---
async function handleClose(interaction) {
  const rooms = listRooms();
  if (rooms.length === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle("🗑️ Fechar Sala")
        .setDescription("Nenhuma sala aberta no momento.")
        .setColor(0x5865f2)],
      ephemeral: true,
    });
  }

  const typeEmoji = { youtube: "▶️", screenshare: "🖥️", camera: "📷" };
  const typeLabel = { youtube: "YouTube", screenshare: "Screen Share", camera: "Câmera" };

  const select = new StringSelectMenuBuilder()
    .setCustomId("close_room_select")
    .setPlaceholder("Selecione a sala que deseja fechar…")
    .addOptions(
      rooms.slice(0, 25).map((r) => {
        const emoji  = typeEmoji[r.type] || "📺";
        const label  = typeLabel[r.type] || r.type;
        const title  = r.type === "youtube" ? `YouTube: ${r.title}` : label;
        const users  = r.userCount > 0 ? `${r.userCount} online` : "vazia";
        const age    = Math.floor((Date.now() - r.createdAt) / 60000);
        const ageStr = age < 60 ? `${age}m` : `${Math.floor(age / 60)}h${age % 60}m`;
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${emoji} ${title} (${users})`.slice(0, 100))
          .setDescription(`${label} · Aberta há ${ageStr} · ID ${r.id.slice(0, 8)}`.slice(0, 100))
          .setValue(r.id);
      }),
    );

  const cancelBtn = new ButtonBuilder()
    .setCustomId("close_room_cancel")
    .setLabel("Cancelar")
    .setStyle(ButtonStyle.Secondary);

  const embed = new EmbedBuilder()
    .setTitle("🗑️ Fechar Sala")
    .setDescription("Selecione abaixo qual sala ativa deseja encerrar. Todos os participantes conectados serão desconectados.")
    .setColor(0xed4245);

  return interaction.reply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(cancelBtn),
    ],
    ephemeral: true,
  });
}

async function handleCloseSelect(interaction) {
  const roomId = interaction.values[0];
  const room = getRoom(roomId);
  if (!room) {
    return interaction.update({
      content: "⚠️ Esta sala já foi fechada ou expirou.",
      embeds: [],
      components: [],
    });
  }

  const queueTitle = Array.isArray(room.media?.queue)
    ? room.media.queue[room.media.queueIndex || 0]?.title
    : null;
  const displayTitle = room.type === "youtube"
    ? `YouTube · ${room.media?.title || queueTitle || room.media?.videoId || "Sala"}`
    : room.type === "camera"
      ? "Camera Stream"
      : "Screen Share";

  closeRoom(roomId, { closedBy: interaction.user.globalName || interaction.user.username });

  const embed = new EmbedBuilder()
    .setTitle("✅ Sala fechada")
    .setDescription(`A sala **${displayTitle}** (\`${roomId.slice(0, 8)}\`) foi encerrada com sucesso.`)
    .setColor(0x3ba55c);

  return interaction.update({
    embeds: [embed],
    components: [],
  });
}

// Start bot
try {
  await client.login(process.env.DISCORD_TOKEN);
} catch (err) {
  console.error("[bot] Failed to login to Discord:", err.message);
  console.error("[bot] Check DISCORD_TOKEN in environment variables. The HTTP server will continue running.");
}

export default client;
