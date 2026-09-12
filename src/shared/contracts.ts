export const API_ROOT = '/__slidev-speech-navigation'
export const CONFIG_PATH = `${API_ROOT}/config`
export const LIVE_SESSION_PATH = `${API_ROOT}/live-session`
export const PREFETCH_PATH = `${API_ROOT}/prefetch`
export const DECISION_PATH = `${API_ROOT}/decision`

export type NavigationTool = 'next_slide' | 'previous_slide' | 'hold_slide'
export type NavigationStatus = 'off' | 'learning' | 'connecting' | 'listening' | 'acting' | 'error'
export type NavigationBehavior = 'balanced' | 'careful'

export interface NavigationState {
  currentSlide: number
  totalSlides: number
}

export interface AddonSettings {
  language?: string
  behavior: NavigationBehavior
}

export interface RuntimeConfig {
  ready: boolean
  hasApiKey: boolean
  assets: 'ready' | 'missing' | 'stale' | 'preparing' | 'error'
  message: string
  settings: AddonSettings
}

export interface NavigationDecision {
  tool: NavigationTool
}

export interface PreparedSlide {
  number: number
  title: string
  notes: string
  revision: string
  imageDataUrl: string
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
