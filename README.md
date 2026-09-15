# Slidev Speech Navigation

An MIT-licensed [Slidev](https://sli.dev/) addon that follows a live presenter
and changes slides from meaning, without requiring spoken commands.

It learns the real rendered slides, not only their Markdown. Each slide image is
paired with its speaker notes. This makes the addon work with different themes,
layouts, diagrams, images, components, and other addons.

## Install

You need Slidev 52 or newer, Node.js 22.12 or newer, and an OpenAI API key.

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
the microphone control labelled **Speech nav** in the navigation bar. The first start can
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

Most decks need no settings. You can enable speech-driven reveals or start in rehearsal mode:

```yaml
---
addons:
  - slidev-addon-speech-navigation
speechNavigation:
  language: en
  behavior: balanced
  liveModel: gpt-live-1
  model: gpt-5.6-luna
  reveals: speech
  mode: rehearsal
---
```

- `language` gives transcription a language hint. Omit it for automatic
  detection.
- `behavior` is `balanced` by default. Use `careful` when avoiding an early slide change matters more.
- `fastMode` defaults to `true` and requests OpenAI API Fast mode for slide analysis and navigation decisions. You can uncheck **Fast mode (API)** in Speech controls or set `fastMode: false` for standard processing. It uses `service_tier: fast` (unchecked uses `default`), costs more, and requires model/project support. It does not change slide timing rules or speed up the GPT-Live audio stream. Existing analysis is reused; new requests use the selected tier. See [OpenAI Fast mode](https://developers.openai.com/api/docs/guides/fast-mode).

- `liveModel` selects the live audio model. The default is `gpt-live-1`.
- `model` selects the model used for slide understanding and navigation decisions. The default is `gpt-5.6-luna`.
- `reveals` is `manual` by default. Set it to `speech` to show native Slidev click steps from speech.
- `mode` is `auto` by default. Set it to `rehearsal` to show suggestions without applying them.

### Presenter controls

Opening local Presenter view prepares navigation in the background: first slide images, then model analysis (**Learning slides**). This sends the slide images and any notes to OpenAI using the configured key. The microphone stays off. Wait for **Ready** before starting; the main button then only opens the live audio connection. The analysis is reused until the slides change or the development server restarts.

Use the main presenter toolbar button to start speech navigation. Once connected, it becomes **Pause**; while paused, it becomes **Play** to resume. A separate **Stop** button ends the session. During startup, the main button cancels the connection.

Use the sliders icon to open **Speech controls** for setup and rehearsal feedback. You do not need to open this panel to pause, resume, or stop.

- **Pause** mutes the microphone and stops navigation decisions. It keeps the live connection open.
- **Resume** starts with a fresh transcript. **Stop speech navigation** closes the microphone and connection.
- **Rehearsal** shows proposed actions. Use Slidev's manual controls to move to the next slide or reveal step.
- **Automatic** applies the proposed actions. Changing modes discards pending decisions.
- **Heard** always scrolls to the newest text and keeps recent speech across slide changes, pauses, and mode changes. Starting a new session clears it. The navigation model receives the current slide’s speech plus the text for the current reveal step, so it can track content covered across reveals. **Suggestion** or **Last action** shows the action and a short observation about the topic.

The panel is visible only in local Presenter view. It stores no transcript or decision history on disk.
Rehearsal uses the same online APIs as automatic mode. A paused session keeps its connection open; use Stop to end it.

The addon advances when you have explained the main current content and reached a clear ending. A brief mention is not enough. It holds while you add details, examples, or comparisons, or when completion is uncertain. You do not need to introduce the next topic. Hidden reveal steps and manual holds still prevent advancing.

### Speech-driven reveals

Use normal Slidev `v-click`, `v-clicks`, or code highlight steps. No special spoken command is required.
The addon captures each click step and compares the current image with the next image.
It reveals one step when you start discussing that content. It cannot advance to the next slide while steps remain.
Manual clicks still work and discard decisions for the previous step.

Preparing many reveal steps takes more time. Speech reveals send the current and next images with decision requests, which adds API usage.
Dynamic content that changes after capture is not analyzed live. Rehearse diagrams, videos, and complex code transitions before the talk.

### Rules for one slide

Put `speechNavigation` in that slide's frontmatter:

```yaml
---
speechNavigation:
  hold: true
---
```

`hold: true` prevents all automatic navigation on this slide, including reveals and backward moves.
Use manual slide controls to leave it. This is useful for a demo, questions, or a QR code.
You can also set `reveals: manual` on a slide to override the deck's `reveals: speech` setting.
A hold rule is explicit. Notes about a planned pause still guide the model, but are not a hard navigation lock.

Window size, overlap, prefetch timing, caching, and models use maintained
defaults. Model selection uses this order: process environment, local `.env`,
Slidev settings, then built-in defaults. Blank values are ignored.
`OPENAI_SPEECH_NAVIGATION_LIVE_MODEL` overrides `liveModel`.
`OPENAI_SPEECH_NAVIGATION_MODEL` overrides `model`.
Restart Slidev after changing model settings or environment overrides.

## How it works

1. During normal Slidev startup, the addon uses Slidev's exporter to prepare
   PNG files for the initial view and each reveal step in the background. The result includes the active theme, layouts,
   components, and addons.
2. At runtime, the addon sends the completed images of up to ten adjacent slides to OpenAI. Each image
   is directly paired with its Slidev speaker notes.
3. The visual understanding is cached in memory. Near the end of a group, the
   next group is learned with a three-slide overlap, like an infinite list.
4. Live presenter audio is transcribed. A small decision request compares the
   recent transcript with the current visual group and chooses exactly one
   action: reveal the next step, next slide, previous slide, or hold.
5. The browser checks that the slide, reveal step, session mode, and pause state did not change while a request was in
   flight, then uses Slidev's public navigation API.

The OpenAI API key stays in the local Slidev server. The browser never receives
it. Analyses and transcripts are not written to disk.

## Current scope

- Works in Slidev's local presenter view. The local API rejects other computers.
- Navigates whole slides and, when enabled, native Slidev click steps. Remaining manual steps prevent an automatic slide advance.
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
- `custom-nav-controls.vue` is the presenter toolbar control.
- `setup/vite-plugins.ts` is the official Slidev addon entry point.

Run `npm run check` before a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
