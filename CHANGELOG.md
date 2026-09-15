# Changelog

All notable changes will be documented here.

This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 - Unreleased

- Always scroll Heard to the newest speech.
- Keep whole-slide speech across reveals and advance on completion without requiring the next topic.
- Add an API Fast mode checkbox and fastMode frontmatter option for Responses processing speed.

- Prevent unchanged status polls from canceling navigation decisions and clearing speech.
- Preserve recent Heard history separately from per-slide decision context.
- Wait for Live session.started before showing Listening and handle session closure explicitly.

- Serialize concurrent image exports, publish complete generations atomically, isolate exporter caches, and ignore initial discovery of existing files.

- Analyze the current slide group during presenter setup so microphone startup reuses prepared navigation context.

- Keep presenter preparation status synchronized after startup, slide edits, and server reconnects; show prepared images separately from listening status.

- Add `speechNavigation.liveModel` and `speechNavigation.model` settings alongside environment overrides.

- Add pause/resume without restarting the live connection.
- Put Pause/Play and Stop directly in the presenter toolbar; keep setup in the controls panel.
- Add rehearsal mode, recent transcript feedback, and navigation suggestions in Presenter view.
- Add optional speech-driven click reveals using current and next rendered step images.
- Add per-slide manual holds and reveal overrides.
- Discard pending decisions after manual clicks, pauses, mode changes, and rule changes.
- Prevent automatic slide changes while reveal steps remain.
- Pin Floating Vue in development to keep Slidev reveal capture working.

- First public version.
- Learn slides from exported images and speaker notes.
- Follow live presenter speech and move one slide forward or back.
- Load ten-slide visual windows and prefetch the next overlapping window.
- Prepare and refresh slide images automatically during normal Slidev development.
- Retry interrupted image preparation automatically without a manual workflow.
- Add a theme-safe presenter toolbar control with non-blocking status feedback.
