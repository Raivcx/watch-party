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
import { createW2GRoom } from "../lib/watch2gether.js";
import { commands } from "./commands.js";

// Warn early about missing env vars — helps debug Render deployments
if (!process.env.DISCORD_TOKEN) console.error("[bot] DISCORD_TOKEN is not set!");
if (!process.env.CLIENT_ID)     console.error("[bot] CLIENT_ID is not set!");
if (!process.env.TMDB_API_KEY)  console.warn("[bot] TMDB_API_KEY is not set — /watch will fail.");
if (!process.env.W2G_API_KEY)   console.warn("[bot] W2G_API_KEY is not set — /watch will fail.");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

// Auto-register slash commands on startup.
// Uses guild commands (per-server) — appear instantly vs up to 1h for global.
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
  // Handle modal submits separately — they are not chat input commands
  if (interaction.isModalSubmit()) {
    // awaitModalSubmit handles these; nothing to do here
    return;
  }

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
    // Only attempt error reply if we haven't already shown a modal
    const payload = { content: "Something went wrong. Please try again.", ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch {
      // Interaction already expired or modal was shown — nothing we can do
    }
  }
});

// --- /watch <type> <name> ---
// Searches TMDB for metadata, then creates a Watch2Gether room.
// For series: shows a Discord Modal to collect season/episode first.
async function handleWatch(interaction) {
  const type = interaction.options.getString("type"); // movie | serie
  const name = interaction.options.getString("name");

  if (type === "serie") {
    // Modal MUST be the first response — cannot defer before showing it
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

    // awaitModalSubmit is NOT inside the InteractionCreate try/catch scope —
    // timeout is silent (user just closed the modal), any other error propagates up.
    let modalInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        filter: (i) =>
          i.customId.startsWith("serie-ep:") && i.user.id === interaction.user.id,
        time: 5 * 60 * 1000,
      });
    } catch {
      // User dismissed the modal or it timed out — no reply needed
      console.log("[bot] Modal timed out or dismissed.");
      return;
    }

    // Defer modal reply while we do async work
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

    const ytQuery = encodeURIComponent(`${result.title} season ${season} episode ${episode}`);
    const seedUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;

    let w2gRoomUrl;
    try {
      w2gRoomUrl = await createW2GRoom(seedUrl);
    } catch (err) {
      console.error("[bot] W2G createRoom failed:", err.message);
      return modalInteraction.editReply(
        `Couldn't create the Watch2Gether room: ${err.message}`,
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(`Watch Party — ${result.title}`)
      .setDescription(`📺 ${result.title} S${season}E${episode}\n\nClick below to join the synced room.`)
      .setURL(w2gRoomUrl)
      .setColor(0x5865f2)
      .setFooter({ text: "Powered by Watch2Gether" });

    if (result.poster)   embed.setThumbnail(result.poster);
    if (result.overview) embed.addFields({ name: "Overview", value: result.overview.slice(0, 300) });

    return modalInteraction.editReply({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(w2gRoomUrl),
        ),
      ],
    });
  }

  // Movies: defer immediately then do async work
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

  const ytQuery = encodeURIComponent(`${result.title} ${result.year} full movie`);
  const seedUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;

  let w2gRoomUrl;
  try {
    w2gRoomUrl = await createW2GRoom(seedUrl);
  } catch (err) {
    console.error("[bot] W2G createRoom failed:", err.message);
    return interaction.editReply(
      `Couldn't create the Watch2Gether room: ${err.message}`,
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(`Watch Party — ${result.title}`)
    .setDescription(`🎬 ${result.title} (${result.year})\n\nClick below to join the synced room.`)
    .setURL(w2gRoomUrl)
    .setColor(0x5865f2)
    .setFooter({ text: "Powered by Watch2Gether" });

  if (result.poster)   embed.setThumbnail(result.poster);
  if (result.overview) embed.addFields({ name: "Overview", value: result.overview.slice(0, 300) });

  return interaction.editReply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(w2gRoomUrl),
      ),
    ],
  });
}

// --- /yt <link> --- (unchanged from original)
async function handleYouTube(interaction) {
  const link = interaction.options.getString("link");
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
    .setDescription("Click the button to join the synced room.")
    .setURL(roomUrl)
    .setColor(0xff0000)
    .setThumbnail(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

// --- /screenshare --- (unchanged from original)
async function handleScreenshare(interaction) {
  const room = createRoom({
    type: "screenshare",
    media: {},
    hostUserId: interaction.user.id,
  });

  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;

  const embed = new EmbedBuilder()
    .setTitle("🖥️ Screen Share Room")
    .setDescription("Click the button to join.\nThe host will be prompted to share their screen.")
    .setURL(roomUrl)
    .setColor(0x2ecc71);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(roomUrl),
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

// Start the bot
client.login(process.env.DISCORD_TOKEN);

export default client;
