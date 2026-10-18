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
import { searchTitle, getShowInfo } from "../lib/tmdb.js";
import { extractYouTubeId } from "../lib/youtube.js";
import { createRoom } from "../lib/roomStore.js";
import { commands } from "./commands.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

// Auto-register slash commands on startup (no shell access needed on Render free).
client.once(Events.ClientReady, async (c) => {
  console.log(`Discord bot online as ${c.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log("Slash commands registered automatically.");
  } catch (err) {
    console.error("Failed to auto-register commands:", err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
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
async function handleWatch(interaction) {
  const type = interaction.options.getString("type"); // movie | serie
  const name = interaction.options.getString("name");

  await interaction.deferReply();

  const result = await searchTitle(type, name);
  if (!result) {
    return interaction.editReply(`No results found for "**${name}".`);
  }

  // For series, ask for season/episode
  let season = 1;
  let episode = 1;

  if (type === "serie") {
    const show = await getShowInfo(result.tmdbId);
    const seasonNumbers = show.seasons
      .filter((s) => s.season_number > 0)
      .map((s) => s.season_number);
    if (seasonNumbers.length > 0) {
      season = seasonNumbers[0];
    }
    // Prompt for season/episode
    await interaction.editReply({
      content: `Found **${result.title}** (${result.year}).\nReply with \`season episode\` (e.g. \`1 5\`) in the next 60 seconds, or I'll default to S${season}E1.`,
    });

    try {
      const collected = await interaction.channel.awaitMessages({
        filter: (m) => m.author.id === interaction.user.id,
        max: 1,
        time: 60_000,
        errors: ["time"],
      });
      const reply = collected.first().content.trim().split(/\s+/);
      const s = parseInt(reply[0], 10);
      const e = parseInt(reply[1], 10);
      if (!isNaN(s) && !isNaN(e)) {
        season = s;
        episode = e;
      }
    } catch {
      // timed out — use defaults
    }
  }

  let url;
  if (type === "movie") {
    url = `https://api.pomfy.stream/filme/${result.tmdbId}`;
  } else {
    url = `https://api.pomfy.stream/serie/${result.tmdbId}/${season}/${episode}`;
  }

  const room = createRoom({
    type,
    media: {
      ...result,
      url,
      season,
      episode,
    },
    hostUserId: interaction.user.id,
  });

  const roomUrl = `${PUBLIC_URL}/room/${room.id}`;
  const mediaLabel =
    type === "movie"
      ? `🎬 ${result.title} (${result.year})`
      : `📺 ${result.title} S${season}E${episode}`;

  const embed = new EmbedBuilder()
    .setTitle(`Watch Party — ${result.title}`)
    .setDescription(`${mediaLabel}\n\nClick the button below to join the room.`)
    .setURL(roomUrl)
    .setColor(0x5865f2);

  if (result.poster) embed.setThumbnail(result.poster);
  if (result.overview) embed.addFields({
    name: "Overview",
    value: result.overview.slice(0, 300) || "No description available.",
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Join Room")
      .setStyle(ButtonStyle.Link)
      .setURL(roomUrl),
  );

  return interaction.editReply({ embeds: [embed], components: [row] });
}

// --- /yt <link> ---
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
