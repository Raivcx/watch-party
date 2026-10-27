// Discord bot — slash commands, Watch2Gether room creation, backend only.
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
import { createW2GRoom } from "../lib/watch2gether.js";
import { createRoom } from "../lib/roomStore.js";
import { commands } from "./commands.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

// Auto-register guild slash commands on startup.
// Guild commands appear instantly; global commands can take up to 1 hour.
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
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "watch") {
      await handleWatch(interaction);
    } else if (interaction.commandName === "screenshare") {
      await handleScreenshare(interaction);
    }
  } catch (err) {
    console.error(`Command error [${interaction.commandName}]:`, err);
    const payload = { content: "Something went wrong. Please try again.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

// --- /watch <url> ---
// Calls Watch2Gether API to create a synced room and returns the room link.
async function handleWatch(interaction) {
  const videoUrl = interaction.options.getString("url").trim();

  // Basic URL sanity check before hitting the API
  let parsedUrl;
  try {
    parsedUrl = new URL(videoUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("non-http protocol");
    }
  } catch {
    return interaction.reply({
      content: "That doesn't look like a valid URL. Please provide a full `https://` link.",
      ephemeral: true,
    });
  }

  // Defer immediately — W2G API call can take a moment
  await interaction.deferReply();

  let w2gRoomUrl;
  try {
    w2gRoomUrl = await createW2GRoom(videoUrl);
  } catch (err) {
    console.error("[watch2gether] createW2GRoom failed:", err.message);
    return interaction.editReply(
      "Couldn't create the Watch2Gether room. The W2G API may be down — try again in a moment.",
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("📺 Watch Party Room Ready")
    .setDescription(
      `A synced room has been created for:\n**${videoUrl}**\n\nClick the button below to join. Everyone joins the same Watch2Gether session.`,
    )
    .setURL(w2gRoomUrl)
    .setColor(0x5865f2)
    .setFooter({ text: "Powered by Watch2Gether" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Join Watch Party")
      .setStyle(ButtonStyle.Link)
      .setURL(w2gRoomUrl),
  );

  return interaction.editReply({ embeds: [embed], components: [row] });
}

// --- /screenshare ---
// Creates an in-house WebRTC screenshare room served by this app's own server.
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

export { client };
