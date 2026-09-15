export const API_ROOT = '/__slidev-speech-navigation'
export const CONFIG_PATH = `${API_ROOT}/config`
export const LIVE_SESSION_PATH = `${API_ROOT}/live-session`
export const PREFETCH_PATH = `${API_ROOT}/prefetch`
export const DECISION_PATH = `${API_ROOT}/decision`

export type NavigationTool = 'next_slide' | 'previous_slide' | 'hold_slide' | 'reveal_next'
export type NavigationStatus = 'off' | 'learning' | 'connecting' | 'listening' | 'rehearsing' | 'paused' | 'acting' | 'error'
export type NavigationBehavior = 'balanced' | 'careful'

export interface NavigationState {
  currentSlide: number
  totalSlides: number
  currentClick?: number
  totalClicks?: number
}

export interface AddonSettings {
  language?: string
  liveModel?: string
  model?: string
  behavior: NavigationBehavior
  fastMode?: boolean
  reveals?: RevealMode
  mode?: NavigationMode
}

export interface RuntimeConfig {
  ready: boolean
  hasApiKey: boolean
  assetMessage?: string
  contextVersion?: string
  assets: 'ready' | 'missing' | 'stale' | 'preparing' | 'error'
  message: string
  settings: AddonSettings
}

export type RevealMode = 'manual' | 'speech'
export type NavigationMode = 'auto' | 'rehearsal'

export interface SlideRules {
  hold: boolean
  reveals: RevealMode
}

export interface NavigationDecision {
  tool: NavigationTool
  reason?: string
}

export interface DecisionFeedback {
  decision: NavigationDecision
  state: NavigationState
  applied: boolean
}

export interface PreparedSlide {
  number: number
  title: string
  notes: string
  revision: string
  imageDataUrl: string
  steps?: { click: number, imageDataUrl: string }[]
}

export interface SlideUnderstanding {
  number: number
  visualDescription: string
  speakingGoal: string
  transitionCues: string[]
  dwell: boolean
}

export interface SlideWindowAnalysis {
  start: number
  end: number
  slides: SlideUnderstanding[]
}
