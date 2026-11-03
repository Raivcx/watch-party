// Shared slash command definitions
export const commands = [
  {
    name: "yt",
    description: "Cria uma sala sincronizada com um vídeo do YouTube",
    options: [
      {
        name: "link",
        description: "Link do YouTube ou ID do vídeo",
        type: 3,
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
