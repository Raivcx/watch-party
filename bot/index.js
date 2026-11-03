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
import { extractYouTubeId } from "../lib/youtube.js";
import { createRoom, listRooms } from "../lib/roomStore.js";
import { commands } from "./commands.js";

if (!process.env.DISCORD_TOKEN) console.error("[bot] DISCORD_TOKEN is not set!");
if (!process.env.CLIENT_ID)     console.error("[bot] CLIENT_ID is not set!");

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
    else if (interaction.commandName === "screenshare") await handleScreenshare(interaction);
    else if (interaction.commandName === "status")      await handleStatus(interaction);
  } catch (err) {
    console.error(`[bot] Unhandled error in /${interaction.commandName}:`, err);
    const payload = { content: "Something went wrong. Please try again.", ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch { /* expired */ }
  }
});

// --- /yt <link> ---
async function handleYouTube(interaction) {
  const link    = interaction.options.getString("link");
  const videoId = extractYouTubeId(link);

  if (!videoId) {
    return interaction.reply({ content: "Link do YouTube inválido.", ephemeral: true });
  }

  const room = createRoom({
    type:       "youtube",
    media:      { videoId, url: `https://www.youtube.com/watch?v=${videoId}` },
    hostUserId: interaction.user.id,
  });

  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;

  const embed = new EmbedBuilder()
    .setTitle("📺 YouTube Watch Party")
    .setDescription("Clique no botão para entrar na sala sincronizada.")
    .setURL(roomUrl)
    .setColor(0xff0000)
    .setThumbnail(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);

  return interaction.reply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
      ),
    ],
  });
}

// --- /screenshare ---
async function handleScreenshare(interaction) {
  const room = createRoom({
    type:       "screenshare",
    media:      {},
    hostUserId: interaction.user.id,
  });

  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;

  const embed = new EmbedBuilder()
    .setTitle("🖥️ Screen Share Room")
    .setDescription("Clique no botão para entrar.\nO host compartilhará a tela via WebRTC.")
    .setURL(roomUrl)
    .setColor(0x2ecc71);

  return interaction.reply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
      ),
    ],
  });
}

// --- /status ---
async function handleStatus(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const rooms = listRooms();

  if (rooms.length === 0) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📊 Status do Servidor")
          .setDescription("Nenhuma sala aberta no momento.")
          .setColor(0x5865f2),
      ],
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

  const embed = new EmbedBuilder()
    .setTitle(`📊 Status — ${rooms.length} sala${rooms.length !== 1 ? "s" : ""} ativa${rooms.length !== 1 ? "s" : ""}`)
    .setDescription(lines.join("\n\n"))
    .setColor(0x5865f2)
    .setFooter({ text: `${PUBLIC_URL}` });

  return interaction.editReply({ embeds: [embed] });
}

// Start bot
try {
  await client.login(process.env.DISCORD_TOKEN);
} catch (err) {
  console.error("[bot] Failed to login to Discord:", err.message);
  console.error("[bot] Check DISCORD_TOKEN in environment variables. The HTTP server will continue running.");
}

export default client;
