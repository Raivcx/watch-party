// Register slash commands with Discord manually (optional).
// The bot now auto-registers on startup, so this is only needed if you want
// to register commands without starting the full server.
// Usage: node bot/deploy-commands.js
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

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
