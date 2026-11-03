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
  Events,
} from "discord.js";
import { extractYouTubeId, extractPlaylistId, fetchPlaylistItems, fetchVideoTitle } from "../lib/youtube.js";
import { createRoom, listRooms, getRooms } from "../lib/roomStore.js";
import { saveClip, listClips } from "../lib/clips.js";
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
  if (!interaction.isChatInputCommand()) return;
  console.log(`[bot] Command received: /${interaction.commandName}`);
  try {
    if      (interaction.commandName === "yt")          await handleYouTube(interaction);
    else if (interaction.commandName === "ytpl")        await handlePlaylist(interaction);
    else if (interaction.commandName === "screenshare") await handleScreenshare(interaction);
    else if (interaction.commandName === "status")      await handleStatus(interaction);
    else if (interaction.commandName === "clip")        await handleClip(interaction);
    else if (interaction.commandName === "clips")       await handleClips(interaction);
  } catch (err) {
    console.error(`[bot] Unhandled error in /${interaction.commandName}:`, err);
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

// --- /status ---
async function handleStatus(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const rooms = listRooms();
  if (rooms.length === 0) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("📊 Status do Servidor").setDescription("Nenhuma sala aberta no momento.").setColor(0x5865f2)],
    });
  }
  const typeEmoji = { youtube: "▶️", screenshare: "🖥️" };
  const typeLabel = { youtube: "YouTube", screenshare: "Screenshare" };
  const lines = rooms.map((r) => {
    const emoji   = typeEmoji[r.type] || "📺";
    const label   = typeLabel[r.type] || r.type;
    const title   = r.type === "youtube" ? `YouTube · ${r.title}` : "Screen Share";
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

// --- /clip <titulo> ---
async function handleClip(interaction) {
  const title   = interaction.options.getString("titulo");
  const userId  = interaction.user.id;
  const guildId = interaction.guildId;

  // Find an active room where this user is a member
  const allRooms = getRooms();
  let activeRoom = null;
  for (const room of allRooms) {
    if (room.members.has(userId)) { activeRoom = room; break; }
  }

  if (!activeRoom) {
    return interaction.reply({ content: "Você não está em nenhuma sala ativa no momento.", ephemeral: true });
  }

  try {
    await saveClip({
      roomId:   activeRoom.id,
      guildId,
      userId,
      username: interaction.user.globalName || interaction.user.username,
      title,
    });
  } catch (err) {
    console.error("[bot] saveClip failed:", err.message);
    return interaction.reply({ content: "Erro ao salvar o clip. Tente novamente.", ephemeral: true });
  }

  const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return interaction.reply({ content: `✂️ Clip salvo: **${title}** — ${hora}`, ephemeral: true });
}

// --- /clips [@usuario] ---
async function handleClips(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const targetUser = interaction.options.getUser("usuario");
  const guildId    = interaction.guildId;

  let clips;
  try {
    clips = await listClips({ guildId, userId: targetUser?.id, limit: 10 });
  } catch (err) {
    console.error("[bot] listClips failed:", err.message);
    return interaction.editReply("Erro ao buscar clips. Verifique se o Supabase está configurado.");
  }

  if (!clips.length) {
    const msg = targetUser ? `Nenhum clip de **${targetUser.globalName || targetUser.username}** encontrado.` : "Nenhum clip encontrado neste servidor.";
    return interaction.editReply({ content: msg });
  }

  const lines = clips.map((c) => {
    const ts = new Date(c.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `✂️ **${c.title}** — ${c.username} · ${ts}`;
  });

  const title = targetUser ? `Clips de ${targetUser.globalName || targetUser.username}` : "Clips do Servidor";
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(`🎬 ${title}`)
      .setDescription(lines.join("\n"))
      .setColor(0x5865f2)],
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
