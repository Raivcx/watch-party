// Shared slash command definitions
import {
  SlashCommandBuilder,
} from "discord.js";

export const commands = [
  // /yt video <link> | /yt playlist <link>
  new SlashCommandBuilder()
    .setName("yt")
    .setDescription("Cria uma sala sincronizada do YouTube")
    .addSubcommand(sub =>
      sub.setName("video")
         .setDescription("Vídeo único do YouTube")
         .addStringOption(opt =>
           opt.setName("link").setDescription("Link do YouTube ou ID do vídeo").setRequired(true)
         )
    )
    .addSubcommand(sub =>
      sub.setName("playlist")
         .setDescription("Playlist do YouTube (toca em sequência com auto-avanço)")
         .addStringOption(opt =>
           opt.setName("link").setDescription("Link da playlist do YouTube").setRequired(true)
         )
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
