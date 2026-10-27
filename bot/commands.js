// Slash command definitions — shared by bot auto-registration and deploy-commands.js.
export const commands = [
  {
    name: "watch",
    description: "Create a synced Watch2Gether room for any video URL",
    options: [
      {
        name: "url",
        description: "Video URL (YouTube, Vimeo, direct MP4, etc.)",
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
