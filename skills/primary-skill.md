# Agent Guidelines and Skills - Watch Party Refactoring

## 1. Code Pruning (Safe Cleanup)
* **Focus:** Surgical removal of obsolete code.
* **Action:** Identify and delete heavy media processing dependencies (such as FFmpeg, yt-dlp, or download libraries) and native media streaming routes/commands.
* **Restriction:** Ensure that the bot's core functionality (initialization, login, permission system, event listeners) is not broken during the removal process.

## 2. Asynchronous RESTful Integration
* **Focus:** Communication with an External API (e.g., Watch2Gether).
* **Action:** Build asynchronous HTTP requests (`POST`/`GET`) to send the video URL and retrieve the synchronized room ID.
* **Restriction:** Implement strict exception handling (`try/catch`) to deal with timeouts, rate limits, and external API downtime, ensuring the bot returns friendly error messages to the user on Discord instead of crashing.

## 3. Clean Architecture for Bots
* **Focus:** Separation of concerns (Decoupling).
* **Action:** Evaluate if the current code mixes interface logic (Discord messages/Slash Commands) with service logic.
* **Restriction:** Isolate the external API calls in a separate Service Layer, away from the bot's command files. This facilitates future testing and maintenance. Additionally, ensure that all tokens and API keys are strictly kept in `.env` files and never hardcoded.