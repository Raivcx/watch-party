// Shared slash command definitions
import { SlashCommandBuilder } from "discord.js";

export const commands = [
  // /yt <link> — cria sala com fila, começa com 1 video, pode adicionar mais no player
  new SlashCommandBuilder()
    .setName("yt")
    .setDescription("Cria uma sala YouTube com fila — adicione mais vídeos dentro do player")
    .addStringOption(opt =>
      opt.setName("link").setDescription("Link ou ID do vídeo inicial").setRequired(true)
    )
    .toJSON(),

  // /ytpl <link> — carrega uma playlist inteira de uma vez
  new SlashCommandBuilder()
    .setName("ytpl")
    .setDescription("Cria uma sala YouTube com uma playlist completa")
    .addStringOption(opt =>
      opt.setName("link").setDescription("Link da playlist do YouTube").setRequired(true)
    )
    .toJSON(),

  // /screenshare
  {
    name: "screenshare",
    description: "Cria uma sala de compartilhamento de tela via WebRTC",
  },

  // /status
  {
    name: "status",
    description: "Mostra as salas abertas no servidor com links para entrar",
  },

  // /clip <título>
  new SlashCommandBuilder()
    .setName("clip")
    .setDescription("Marca um momento da sessão atual")
    .addStringOption(opt =>
      opt.setName("titulo").setDescription("Título do momento").setRequired(true)
    )
    .toJSON(),

  // /clips [@usuario]
  new SlashCommandBuilder()
    .setName("clips")
    .setDescription("Lista os clips recentes do servidor")
    .addUserOption(opt =>
      opt.setName("usuario").setDescription("Filtrar por usuário").setRequired(false)
    )
    .toJSON(),
];
