# Contributing

Thank you for helping improve Slidev Speech Navigation. Small, focused pull
requests are easiest to review.

## Local setup

```bash
npm install
npm run dev
```

Open Slidev's presenter view and use the **Speech nav** button. A real OpenAI
request needs `OPENAI_API_KEY` in `example/.env`.

Before opening a pull request, run:

```bash
npm run check
```

## Project shape

- `global-top.vue` is the small presenter interface.
- `src/client/` handles microphone and navigation state.
- `src/server/` keeps the API key private and calls OpenAI.
- `src/core/` contains pure window and prompt logic.
- `setup/vite-plugins.ts` connects the addon to Slidev.
- `src/server/prepare.ts` refreshes images during normal Slidev development.
- `bin/` is the private helper that runs Slidev's renderer.

Start with the pure functions when adding behavior. Keep network and browser
code at the edges. Add a test for each behavior change. New user settings need
a clear use case that cannot be handled safely by a good default.

Common changes have clear homes:

- Change window timing in `src/core/window.ts` and update `tests/window.test.ts`.
- Change a navigation rule in `src/core/prompts.ts` and add a prompt test.
- Add a setting in `src/core/config.ts`, then document it in the README. Avoid
  adding a setting when one maintained default works for most decks.
