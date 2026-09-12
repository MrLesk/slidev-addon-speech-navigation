import { defineVitePluginsSetup } from '@slidev/types'
import { loadEnv } from 'vite'
import { parseAddonSettings } from '../src/core/config'
import { createSpeechNavigationPlugin } from '../src/server/plugin'

export default defineVitePluginsSetup((options) => {
  const env = loadEnv(options.mode, options.userRoot, '')
  const settings = parseAddonSettings(options.data.headmatter.speechNavigation)

  return createSpeechNavigationPlugin({
    apiKey: process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY,
    userRoot: options.userRoot,
    entry: options.entry,
    slides: () => options.data.slides,
    settings,
    liveModel: process.env.OPENAI_SPEECH_NAVIGATION_LIVE_MODEL
      ?? env.OPENAI_SPEECH_NAVIGATION_LIVE_MODEL,
    navigationModel: process.env.OPENAI_SPEECH_NAVIGATION_MODEL
      ?? env.OPENAI_SPEECH_NAVIGATION_MODEL,
  })
})
