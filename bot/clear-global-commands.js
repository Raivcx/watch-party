// Limpa TODOS os slash commands globais da aplicação.
// Rode uma vez: node bot/clear-global-commands.js
import "dotenv/config";
import { REST, Routes } from "discord.js";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

console.log("[bot] Limpando comandos globais...");
await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
console.log("[bot] Comandos globais removidos. Os comandos de servidor (guild) continuam ativos.");
