// Shared slash command definitions — used by both the bot (auto-register on
// startup) and deploy-commands.js (manual one-time registration).
export const commands = [
  {
    name: "watch",
    description: "Cria uma sala para assistir filme ou série",
    options: [
      {
        name: "type",
        description: "Filme ou série?",
        type: 3, // STRING
        required: true,
        choices: [
          { name: "Movie", value: "movie" },
          { name: "Series", value: "serie" },
        ],
      },
      {
        name: "name",
        description: "Título para buscar no TMDB",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "yt",
    description: "Cria uma sala sincronizada com um vídeo do YouTube",
    options: [
      {
        name: "link",
        description: "Link do YouTube ou ID do vídeo",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "screenshare",
    description: "Cria uma sala de compartilhamento de tela via WebRTC",
  },
  {
    name: "status",
    description: "Mostra as salas abertas no servidor com links para entrar",
  },
];
