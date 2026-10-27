// Shared slash command definitions — used by both the bot (auto-register on
// startup) and deploy-commands.js (manual one-time registration).
export const commands = [
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
