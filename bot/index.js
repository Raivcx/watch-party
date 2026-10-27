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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
} from "discord.js";
import { searchTitle } from "../lib/tmdb.js";
import { extractYouTubeId } from "../lib/youtube.js";
import { createRoom } from "../lib/roomStore.js";
import { commands } from "./commands.js";

// Warn early about missing env vars
if (!process.env.DISCORD_TOKEN) console.error("[bot] DISCORD_TOKEN is not set!");
if (!process.env.CLIENT_ID)     console.error("[bot] CLIENT_ID is not set!");
if (!process.env.TMDB_API_KEY)  console.warn("[bot] TMDB_API_KEY is not set — /watch will fail.");
if (!process.env.EMBED_API_URL) console.warn("[bot] EMBED_API_URL is not set — movie/serie streams will fail.");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

// Auto-register guild slash commands on startup.
// Guild commands appear instantly vs up to 1h for global.
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
  // Modal submits are handled by awaitModalSubmit — ignore here
  if (interaction.isModalSubmit()) return;
  if (!interaction.isChatInputCommand()) return;

  console.log(`[bot] Command received: /${interaction.commandName}`);

  try {
    if (interaction.commandName === "watch") {
      await handleWatch(interaction);
    } else if (interaction.commandName === "yt") {
      await handleYouTube(interaction);
    } else if (interaction.commandName === "screenshare") {
      await handleScreenshare(interaction);
    }
  } catch (err) {
    console.error(`[bot] Unhandled error in /${interaction.commandName}:`, err);
    const payload = { content: "Something went wrong. Please try again.", ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch {
      // Interaction already expired or modal was shown
    }
  }
});

// --- /watch <type> <name> ---
// Busca metadados no TMDB, cria sala interna e retorna link do player com HLS.
async function handleWatch(interaction) {
  const type = interaction.options.getString("type"); // movie | serie
  const name = interaction.options.getString("name");

  if (type === "serie") {
    // Modal DEVE ser a primeira resposta — não pode defer antes
    const modal = new ModalBuilder()
      .setCustomId(`serie-ep:${name}`)
      .setTitle("Season & Episode");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("season")
          .setLabel("Season number")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 1")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(3),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("episode")
          .setLabel("Episode number")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 1")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(3),
      ),
    );

    await interaction.showModal(modal);

    let modalInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        filter: (i) =>
          i.customId.startsWith("serie-ep:") && i.user.id === interaction.user.id,
        time: 5 * 60 * 1000,
      });
    } catch {
      console.log("[bot] Modal timed out or dismissed.");
      return;
    }

    await modalInteraction.deferReply();

    const season  = parseInt(modalInteraction.fields.getTextInputValue("season"),  10) || 1;
    const episode = parseInt(modalInteraction.fields.getTextInputValue("episode"), 10) || 1;

    let result;
    try {
      result = await searchTitle("serie", name);
    } catch (err) {
      console.error("[bot] TMDB searchTitle failed:", err.message);
      return modalInteraction.editReply("Couldn't reach TMDB. Check that TMDB_API_KEY is set on Render.");
    }

    if (!result) {
      return modalInteraction.editReply(`No results found for "**${name}**".`);
    }

    const room = createRoom({
      type: "serie",
      media: { ...result, season, episode },
      hostUserId: interaction.user.id,
    });

    const roomUrl = `${PUBLIC_URL}/room/${room.id}`;

    const embed = new EmbedBuilder()
      .setTitle(`Watch Party — ${result.title}`)
      .setDescription(`📺 ${result.title} S${season}E${episode}\n\nClique no botão para entrar na sala.`)
      .setURL(roomUrl)
      .setColor(0x5865f2);

    if (result.poster)   embed.setThumbnail(result.poster);
    if (result.overview) embed.addFields({ name: "Overview", value: result.overview.slice(0, 300) });

    return modalInteraction.editReply({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
        ),
      ],
    });
  }

  // Filmes: defer e busca TMDB
  await interaction.deferReply();

  let result;
  try {
    result = await searchTitle(type, name);
  } catch (err) {
    console.error("[bot] TMDB searchTitle failed:", err.message);
    return interaction.editReply("Couldn't reach TMDB. Check that TMDB_API_KEY is set on Render.");
  }

  if (!result) {
    return interaction.editReply(`No results found for "**${name}**".`);
  }

  const room = createRoom({
    type: "movie",
    media: { ...result },
    hostUserId: interaction.user.id,
  });

  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;

  const embed = new EmbedBuilder()
    .setTitle(`Watch Party — ${result.title}`)
    .setDescription(`🎬 ${result.title} (${result.year})\n\nClique no botão para entrar na sala.`)
    .setURL(roomUrl)
    .setColor(0x5865f2);

  if (result.poster)   embed.setThumbnail(result.poster);
  if (result.overview) embed.addFields({ name: "Overview", value: result.overview.slice(0, 300) });

  return interaction.editReply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
      ),
    ],
  });
}

// --- /yt <link> ---
async function handleYouTube(interaction) {
  const link    = interaction.options.getString("link");
  const videoId = extractYouTubeId(link);

  if (!videoId) {
    return interaction.reply({
      content: "That doesn't look like a valid YouTube link.",
      ephemeral: true,
    });
  }

  const room = createRoom({
    type: "youtube",
    media: { videoId, url: `https://www.youtube.com/watch?v=${videoId}` },
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
    type: "screenshare",
    media: {},
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

// Start the bot — wrapped in try/catch para não derrubar o servidor HTTP se o token for inválido
try {
  await client.login(process.env.DISCORD_TOKEN);
} catch (err) {
  console.error("[bot] Failed to login to Discord:", err.message);
  console.error("[bot] Check DISCORD_TOKEN in environment variables. The HTTP server will continue running.");
}

export default client;
