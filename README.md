# Slidev Speech Navigation

An MIT-licensed [Slidev](https://sli.dev/) addon that follows a live presenter
and changes slides from meaning, without requiring spoken commands.

It learns the real rendered slides, not only their Markdown. Each slide image is
paired with its speaker notes. This makes the addon work with different themes,
layouts, diagrams, images, components, and other addons.

## Install

You need Slidev 52 or newer, Node.js 20.19 or newer, and an OpenAI API key.

1. Install the addon and Slidev's Chromium renderer:

   ```bash
   npm install -D slidev-addon-speech-navigation playwright-chromium
   ```

2. Add the addon to the headmatter at the top of `slides.md`:

   ```yaml
   ---
   addons:
     - slidev-addon-speech-navigation
   ---
   ```

3. Put the API key in a local `.env` file. Do not commit this file:

   ```dotenv
   OPENAI_API_KEY=your_key_here
   ```

4. Start Slidev as usual:

   ```bash
   npm run dev
   ```

   The addon prepares the slide images in the background on startup. It
   also refreshes them when deck-local slide content, styles, components, or
   images change. You do not need to change your existing `dev` script.

Open the **Presenter** link printed by Slidev (normally `/presenter/`) and click
**Speech nav**. The first start can
take a short time while the addon learns the first group of slides. Allow
microphone access when the browser asks.

## Speaker notes

Write normal Slidev speaker notes in the last HTML comment on a slide:

```md
# Why visual context matters

<DiagramOfTheSystem />

<!--
Explain that the diagram moves from audio, to understanding, to one safe slide
action. Pause on the diagram before introducing the next section.
-->
```

The image and this note are sent together when the model learns that slide.
Notes can explain intent that is not visible, such as a planned demo or pause.

## Optional settings

Most decks need no settings. Two options cover the useful exceptions:

```yaml
---
addons:
  - slidev-addon-speech-navigation
speechNavigation:
  language: en
  behavior: balanced
---
```

- `language` gives transcription a language hint. Omit it for automatic
  detection.
- `behavior` is `balanced` by default. Use `careful` when a false slide change
  would be more harmful than a late one.

Window size, overlap, prefetch timing, caching, and models use maintained
defaults. Advanced model overrides are available through
`OPENAI_SPEECH_NAVIGATION_LIVE_MODEL` and
`OPENAI_SPEECH_NAVIGATION_MODEL` environment variables.

## How it works

1. During normal Slidev startup, the addon uses Slidev's exporter to prepare
   PNG files in the background. The result includes the active theme, layouts,
   components, and addons.
2. At runtime, the addon sends up to ten adjacent images to OpenAI. Each image
   is directly paired with its Slidev speaker notes.
3. The visual understanding is cached in memory. Near the end of a group, the
   next group is learned with a three-slide overlap, like an infinite list.
4. Live presenter audio is transcribed. A small decision request compares the
   recent transcript with the current visual group and chooses exactly one
   action: next, previous, or hold.
5. The browser checks that the slide did not change while a request was in
   flight, then uses Slidev's public navigation API.

The OpenAI API key stays in the local Slidev server. The browser never receives
it. Analyses and transcripts are not written to disk.

## Current scope

- Works in Slidev's local presenter view. The local API rejects other computers.
- Navigates whole slides. Click animations remain under presenter control.
- Uses prepared PNG files. This gives more stable results than trying to
  interpret theme-dependent browser markup while presenting.
- Uses online OpenAI APIs, so accuracy, latency, and usage cost vary by deck and
  network conditions. Rehearse important talks and keep a manual remote ready.
- Watches visual source files inside the presentation project and refreshes the
  images after they change. Changes inside installed dependencies take effect
  after restarting Slidev.

## Development

```bash
git clone https://github.com/MrLesk/slidev-addon-speech-navigation.git
cd slidev-addon-speech-navigation
npm install
npm run dev
```

Put a test key in `example/.env` only when you want to try real speech. Unit
tests and builds never need an API key.

The project is split by responsibility:

- `src/core` contains small pure functions and prompts.
- `src/client` handles WebRTC, transcript checkpoints, and stale decisions.
- `src/server` reads prepared slides and calls OpenAI without exposing the key.
- `global-top.vue` is the presenter control.
- `setup/vite-plugins.ts` is the official Slidev addon entry point.

Run `npm run check` before a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
