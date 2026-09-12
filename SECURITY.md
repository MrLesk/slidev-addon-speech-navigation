# Security and privacy

## Report a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
security advisory feature for this repository.

## Data flow

When speech navigation is on, microphone audio is sent directly from the
presenter browser to OpenAI. Exported images, speaker notes, and recent
transcript text are sent through the local Slidev development server to the
OpenAI API. The addon does not write transcripts or model analyses to disk.

`OPENAI_API_KEY` stays in the local Node.js process. It is never returned to the
browser. Add `.env` and generated slide images only to trusted machines.

The local API rejects non-loopback requests. This first release is intended for
presenting from the same computer that runs Slidev. Do not expose the Slidev
development server to the public internet.
