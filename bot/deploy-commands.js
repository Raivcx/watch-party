// Register slash commands with Discord (run once, or when commands change).
// Usage: node bot/deploy-commands.js
import "dotenv/config";
import { REST, Routes } from "discord.js";

const commands = [
  {
    name: "watch",
    description: "Create a watch-party room for a movie or series",
    options: [
      {
        name: "type",
        description: "Movie or TV series?",
        type: 3, // STRING
        required: true,
        choices: [
          { name: "Movie", value: "movie" },
          { name: "Series", value: "serie" },
        ],
      },
      {
        name: "name",
        description: "Title to search on TMDB",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "yt",
    description: "Create a watch-party room synced to a YouTube video",
    options: [
      {
        name: "link",
        description: "YouTube link or video ID",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "screenshare",
    description: "Create a watch-party room for screen sharing via WebRTC",
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log("Registering slash commands...");
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands },
  );
  console.log("Successfully registered commands.");
} catch (err) {
  console.error("Failed to register commands:", err);
  process.exit(1);
}
