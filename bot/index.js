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

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

// Auto-register slash commands on startup (no shell access needed on Render free).
// Uses guild commands (per-server) instead of global — guild commands appear
// instantly in Discord, while global commands can take up to 1 hour.
client.once(Events.ClientReady, async (c) => {
  console.log(`Discord bot online as ${c.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    const guilds = c.guilds.cache;
    for (const [guildId, guild] of guilds) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands },
      );
      console.log(`Commands registered in guild: ${guild.name} (${guildId})`);
    }
    console.log(`Slash commands registered in ${guilds.size} guild(s).`);
  } catch (err) {
    console.error("Failed to auto-register commands:", err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  console.log(`Interaction received: type=${interaction.type} command=${interaction.commandName || "N/A"}`);
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "watch") {
      await handleWatch(interaction);
    } else if (interaction.commandName === "yt") {
      await handleYouTube(interaction);
    } else if (interaction.commandName === "screenshare") {
      await handleScreenshare(interaction);
    }
  } catch (err) {
    console.error("Command error:", err);
    const payload = { content: "Something went wrong. Try again.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

// --- /watch <type> <name> ---
// Searches TMDB for metadata, then creates a Watch2Gether room (replaces internal HLS player).
// For series: shows a Discord Modal to collect season/episode first.
async function handleWatch(interaction) {
  const type = interaction.options.getString("type"); // movie | serie
  const name = interaction.options.getString("name");

  // For series, show a modal BEFORE deferring (modals must be the first response)
  if (type === "serie") {
    const modal = new ModalBuilder()
      .setCustomId(`serie-ep:${name}`)
      .setTitle("Season & Episode");

    const seasonInput = new TextInputBuilder()
      .setCustomId("season")
      .setLabel("Season number")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 1")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3);

    const episodeInput = new TextInputBuilder()
      .setCustomId("episode")
      .setLabel("Episode number")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 1")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3);

    modal.addComponents(
      new ActionRowBuilder().addComponents(seasonInput),
      new ActionRowBuilder().addComponents(episodeInput),
    );

    await interaction.showModal(modal);

    // Wait for the user to submit the modal (up to 5 minutes)
    let modalInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        filter: (i) => i.customId.startsWith("serie-ep:") && i.user.id === interaction.user.id,
        time: 5 * 60 * 1000,
      });
    } catch {
      return; // timed out, user dismissed modal
    }

    await modalInteraction.deferReply();

    const season = parseInt(modalInteraction.fields.getTextInputValue("season"), 10) || 1;
    const episode = parseInt(modalInteraction.fields.getTextInputValue("episode"), 10) || 1;

    const result = await searchTitle("serie", name);
    if (!result) {
      return modalInteraction.editReply(`No results found for "**${name}**".`);
    }

    // Create a W2G room seeded with a YouTube search for the episode
    const ytQuery = encodeURIComponent(`${result.title} season ${season} episode ${episode}`);
    const seedUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;

    let w2gRoomUrl;
    try {
      w2gRoomUrl = await createW2GRoom(seedUrl);
    } catch (err) {
      console.error("[watch2gether] createW2GRoom failed:", err.message);
      return modalInteraction.editReply(
        "Couldn't create the Watch2Gether room. The W2G API may be down — try again in a moment.",
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(`Watch Party — ${result.title}`)
      .setDescription(`📺 ${result.title} S${season}E${episode}\n\nClick the button below to join the synced room.`)
      .setURL(w2gRoomUrl)
      .setColor(0x5865f2)
      .setFooter({ text: "Powered by Watch2Gether" });

    if (result.poster) embed.setThumbnail(result.poster);
    if (result.overview) embed.addFields({ name: "Overview", value: result.overview.slice(0, 300) });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(w2gRoomUrl),
    );

    return modalInteraction.editReply({ embeds: [embed], components: [row] });
  }

  // Movies: defer and proceed
  await interaction.deferReply();

  const result = await searchTitle(type, name);
  if (!result) {
    return interaction.editReply(`No results found for "**${name}**".`);
  }

  // Create a W2G room seeded with a YouTube search for the movie
  const ytQuery = encodeURIComponent(`${result.title} ${result.year} full movie`);
  const seedUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;

  let w2gRoomUrl;
  try {
    w2gRoomUrl = await createW2GRoom(seedUrl);
  } catch (err) {
    console.error("[watch2gether] createW2GRoom failed:", err.message);
    return interaction.editReply(
      "Couldn't create the Watch2Gether room. The W2G API may be down — try again in a moment.",
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(`Watch Party — ${result.title}`)
    .setDescription(`🎬 ${result.title} (${result.year})\n\nClick the button below to join the synced room.`)
    .setURL(w2gRoomUrl)
    .setColor(0x5865f2)
    .setFooter({ text: "Powered by Watch2Gether" });

  if (result.poster) embed.setThumbnail(result.poster);
  if (result.overview) embed.addFields({ name: "Overview", value: result.overview.slice(0, 300) });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Join Room").setStyle(ButtonStyle.Link).setURL(w2gRoomUrl),
  );

  return interaction.editReply({ embeds: [embed], components: [row] });
}

// --- /yt <link> --- (unchanged)
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
    new ButtonBuilder()
      .setLabel("Join Room")
      .setStyle(ButtonStyle.Link)
      .setURL(roomUrl),
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

// --- /screenshare --- (unchanged)
async function handleScreenshare(interaction) {
  const room = createRoom({
    type: "screenshare",
    media: {},
    hostUserId: interaction.user.id,
  });

  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;
  const embed = new EmbedBuilder()
    .setTitle("🖥️ Screen Share Room")
    .setDescription(
      "Click the button to join.\nThe host will be prompted to share their screen.",
    )
    .setURL(roomUrl)
    .setColor(0x2ecc71);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Join Room")
      .setStyle(ButtonStyle.Link)
      .setURL(roomUrl),
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

// Start the bot
client.login(process.env.DISCORD_TOKEN);

export default client;
