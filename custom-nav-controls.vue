<script setup lang="ts">
import { useNav } from '@slidev/client'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { parseSlideRules } from './src/core/config'
import { constrainDecision } from './src/core/navigation'
import { prefetchSlideWindow, SpeechDirector } from './src/client/director'
import { createRuntimePoller } from './src/client/runtime'
import { createSlideWarmup, type WarmupStatus } from './src/client/warmup'
import { CONFIG_PATH, type DecisionFeedback, type NavigationMode, type NavigationState, type NavigationStatus, type NavigationTool, type RuntimeConfig } from './src/shared/contracts'

const nav = useNav()
const director = shallowRef<SpeechDirector | null>(null)
const config = ref<RuntimeConfig | null>(null)
const status = ref<NavigationStatus>('off')
const panelOpen = ref(false)
const optionsButton = ref<HTMLButtonElement | null>(null)
const mode = ref<NavigationMode>('auto')
const transcript = ref('')
const heardElement = ref<HTMLElement | null>(null)
const fastMode = ref(true)
watch([transcript, panelOpen], async () => {
  await nextTick()
  if (heardElement.value)
    heardElement.value.scrollTop = heardElement.value.scrollHeight
})
const feedback = shallowRef<DecisionFeedback | null>(null)
let modeInitialized = false
const currentRules = computed(() => parseSlideRules(nav.currentSlideRoute.value.meta.slide.frontmatter.speechNavigation,
  config.value?.settings ?? { behavior: 'balanced' }))
const actionLabels = { next_slide: 'Next slide', previous_slide: 'Previous slide', hold_slide: 'Keep this slide', reveal_next: 'Show next item' }

const message = ref('Speech navigation is off')
let sessionAbort: AbortController | null = null
const configError = ref('')
const runtimePoller = createRuntimePoller(refreshConfig)
const warmupStatus = ref<WarmupStatus>('waiting')
const warmupMessage = ref('Waiting for slide images…')
const warmup = createSlideWarmup((state, signal) => prefetchSlideWindow(state, signal, fastMode.value), (state, text) => {
  warmupStatus.value = state
  warmupMessage.value = text
})

function prepareForPresenter(retry = false) {
  const runtime = config.value
  if (!runtime?.ready) {
    warmup.reset()
    return Promise.resolve()
  }
  return warmup.ensure(currentState(), runtime.contextVersion ?? 'legacy', retry)
}

const isActive = computed(() => ['learning', 'connecting', 'listening', 'rehearsing', 'paused', 'acting'].includes(status.value))
const canPause = computed(() => ['listening', 'rehearsing', 'acting', 'paused'].includes(status.value))
const primaryActionLabel = computed(() => {
  if (status.value === 'paused') return 'Resume speech navigation'
  if (canPause.value) return 'Pause speech navigation'
  if (isActive.value) return 'Cancel speech navigation startup'
  return 'Start speech navigation'
})
const isVisible = computed(() => Boolean(import.meta.hot) && window.location.pathname.split('/').includes('presenter'))
const isPreparing = computed(() => !configError.value && (!config.value || ['missing', 'stale', 'preparing'].includes(config.value.assets)))
const isUnavailable = computed(() => config.value?.assets === 'error')
const displayState = computed(() => {
  if (status.value !== 'off')
    return status.value
  if (configError.value)
    return 'error'
  if (isPreparing.value)
    return 'preparing'
  if (config.value && !config.value.ready)
    return 'error'
  if (warmupStatus.value === 'learning') return 'learning'
  if (warmupStatus.value === 'error') return 'error'
  return warmupStatus.value === 'ready' ? 'ready' : 'off'
})
const preparationMessage = computed(() => {
  if (configError.value) return configError.value
  if (!config.value) return 'Checking slide images…'
  if (config.value.assetMessage) return config.value.assetMessage
  if (config.value.assets === 'ready') return `Ready with ${nav.total.value} prepared slides`
  return config.value.message
})
const idleMessage = computed(() => configError.value || (config.value?.ready ? warmupMessage.value : config.value?.message) || 'Checking slide images…')
const displayMessage = computed(() => status.value === 'off' ? idleMessage.value : message.value)
const buttonLabel = computed(() => {
  if (status.value === 'learning') return 'Learning…'
  if (status.value === 'connecting') return 'Connecting…'
  if (status.value === 'acting') return 'Moving…'
  if (status.value === 'listening') return 'Listening'
  if (status.value === 'paused') return 'Paused'
  if (status.value === 'rehearsing') return 'Rehearsal'
  if (status.value === 'error') return 'Try again'
  if (configError.value) return 'Reconnecting…'
  if (isUnavailable.value) return 'Retrying…'
  if (isPreparing.value) return 'Preparing…'
  if (warmupStatus.value === 'learning') return 'Learning slides…'
  if (warmupStatus.value === 'error') return 'Retry preparation'
  if (warmupStatus.value === 'ready') return 'Ready'
  return 'Speech nav'
})

function currentState(): NavigationState {
  return {
    currentSlide: nav.currentSlideNo.value,
    totalSlides: nav.total.value,
    currentClick: nav.clicks.value,
    totalClicks: nav.clicksTotal.value,
  }
}

async function loadConfig(signal?: AbortSignal) {
  const response = await fetch(CONFIG_PATH, { cache: 'no-store', signal })
  if (!response.ok)
    throw new Error('Could not reach the local speech navigation service')
  const runtime = await response.json() as RuntimeConfig
  signal?.throwIfAborted()
  config.value = runtime
  configError.value = ''
  if (!modeInitialized) {
    mode.value = config.value.settings.mode ?? 'auto'
    fastMode.value = config.value.settings.fastMode !== false
    modeInitialized = true
  }
  void prepareForPresenter().catch(() => {})
  return config.value
}

async function refreshConfig(signal?: AbortSignal) {
  try {
    return await loadConfig(signal)
  }
  catch (error) {
    if (!signal?.aborted)
      configError.value = 'Could not reach the local speech navigation service. Retrying…'
    throw error
  }
}

async function execute(tool: NavigationTool) {
  tool = constrainDecision({ tool }, currentState(), currentRules.value).tool
  if (tool === 'reveal_next')
    await nav.next()
  else if (tool === 'next_slide' && nav.currentSlideNo.value < nav.total.value)
    await nav.nextSlide()
  else if (tool === 'previous_slide' && nav.currentSlideNo.value > 1)
    await nav.prevSlide()
  await nextTick()
}

async function toggle() {
  if (canPause.value) {
    togglePause()
    return
  }
  if (sessionAbort || director.value) {
    stopSession()
    return
  }

  const session = new AbortController()
  sessionAbort = session
  status.value = 'connecting'
  message.value = 'Checking speech navigation…'
  try {
    const runtime = await refreshConfig(session.signal)
    if (session.signal.aborted)
      return
    if (runtime.assets === 'preparing') {
      sessionAbort = null
      status.value = 'off'
      return
    }
    if (!runtime.ready)
      throw new Error(runtime.message)

    await prepareForPresenter(true)
    if (session.signal.aborted)
      return

    const instance = new SpeechDirector({
      getState: currentState,
      execute,
      mode: mode.value,
      fastMode: fastMode.value,
      getRules: () => currentRules.value,
      onTranscript(value) { transcript.value = value },
      onDecision(value) { feedback.value = value },
      onStatus(nextStatus, nextMessage) {
        if (director.value !== instance)
          return
        status.value = nextStatus
        message.value = nextMessage
        if (nextStatus === 'error') {
          sessionAbort?.abort()
          sessionAbort = null
          director.value?.disconnect(false)
          director.value = null
        }
      },
    })
    director.value = instance
    await instance.connect()
    if (session.signal.aborted)
      instance.disconnect(false)
  }
  catch (error) {
    if (session.signal.aborted)
      return
    sessionAbort = null
    director.value?.disconnect(false)
    director.value = null
    status.value = 'error'
    message.value = error instanceof Error ? error.message : 'Could not start speech navigation'
  }
}

function stopSession(showStatus = true) {
  sessionAbort?.abort()
  sessionAbort = null
  director.value?.disconnect(false)
  director.value = null
  if (showStatus) {
    status.value = 'off'
    message.value = 'Speech navigation is off'
  }
}

function closePanel() {
  panelOpen.value = false
  optionsButton.value?.focus()
}

function togglePause() {
  if (status.value === 'paused')
    director.value?.resume()
  else
    director.value?.pause()
}

watch(mode, value => director.value?.setMode(value))
watch(fastMode, value => director.value?.setFastMode(value))
watch(
  [() => currentRules.value.hold, () => currentRules.value.reveals],
  () => director.value?.updateRules(),
)

let previousState = currentState()
const stopWatching = watch(
  [nav.currentSlideNo, nav.total, nav.clicks, nav.clicksTotal],
  () => {
    const nextState = currentState()
    director.value?.updateSlideState(previousState, nextState)
    previousState = nextState
    void prepareForPresenter().catch(() => {})
    if (director.value && sessionAbort)
      void prefetchSlideWindow(nextState, sessionAbort.signal, fastMode.value).catch(() => {})
  },
)

onMounted(() => {
  if (isVisible.value)
    runtimePoller.start()
})
onBeforeUnmount(() => {
  runtimePoller.stop()
  warmup.stop()
  stopWatching()
  stopSession(false)
})
</script>

<template>
  <div v-if="isVisible" class="speech-navigation" :data-state="displayState">
    <button
      type="button"
      class="slidev-icon-btn speech-navigation-trigger"
      :disabled="!isActive && (isPreparing || isUnavailable || warmupStatus === 'learning')"
      :aria-label="primaryActionLabel"
      :title="`${primaryActionLabel} — ${buttonLabel}: ${displayMessage}`"
      @click="toggle"
    >
      <span class="speech-navigation-aura" aria-hidden="true" />
      <span class="speech-navigation-glyph" aria-hidden="true">
        <svg v-if="status === 'paused'" viewBox="0 0 24 24" role="presentation">
          <path class="speech-navigation-solid" d="m8 5 11 7-11 7Z" />
        </svg>
        <svg v-else-if="canPause" viewBox="0 0 24 24" role="presentation">
          <path class="speech-navigation-solid" d="M6 5h4v14H6zM14 5h4v14h-4z" />
        </svg>
        <svg v-else-if="isActive" viewBox="0 0 24 24" role="presentation">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
        <svg v-else viewBox="0 0 24 24" role="presentation">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
          <path d="M6.75 11.25V12a5.25 5.25 0 0 0 10.5 0v-.75M12 17.25V21M9.25 21h5.5" />
        </svg>
        <span v-if="!isActive" class="speech-navigation-live-dot" />
      </span>
    </button>

    <span v-if="!isActive" class="speech-navigation-preparation" :title="idleMessage">{{ buttonLabel }}</span>

    <button v-if="canPause" type="button" class="speech-navigation-stop" aria-label="Stop speech navigation" title="Stop speech navigation" @click="stopSession()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
    </button>

    <button ref="optionsButton" type="button" class="speech-navigation-options" aria-label="Speech controls" :aria-expanded="panelOpen" aria-controls="speech-controls-panel" @click="panelOpen = !panelOpen">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 4v16M12 4v16M19 4v16M2 8h6M9 16h6M16 10h6" /></svg>
    </button>
    <div v-if="panelOpen" id="speech-controls-panel" class="speech-navigation-panel" role="region" aria-label="Speech controls" @keydown.esc.stop="closePanel">
      <div class="speech-navigation-panel-header">
        <span class="speech-navigation-kicker"><span class="speech-navigation-panel-dot" />Speech navigation</span>
        <button type="button" class="speech-navigation-close" aria-label="Close speech controls" title="Close" @click.stop="closePanel">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <strong class="speech-navigation-message" role="status">{{ displayMessage }}</strong>
      <p v-if="preparationMessage !== displayMessage" class="speech-help speech-preparation-detail">{{ preparationMessage }}</p>
      <label class="speech-control-row">Mode
        <select v-model="mode" aria-label="Navigation mode">
          <option value="auto">Automatic</option>
          <option value="rehearsal">Rehearsal</option>
        </select>
      </label>
      <label class="speech-control-row speech-fast-mode"><span>Fast mode (API)</span>
        <input v-model="fastMode" type="checkbox" aria-label="Fast mode (API)" />
      </label>
      <p class="speech-help">Faster slide analysis and decisions. Higher API cost.</p>
      <p v-if="mode === 'rehearsal'" class="speech-help">Suggestions only. Use manual controls to change slides and show items.</p>
      <div class="speech-control-row">
        <span>Slide {{ nav.currentSlideNo.value }}<template v-if="nav.clicksTotal.value"> · Step {{ nav.clicks.value }}/{{ nav.clicksTotal.value }}</template></span>
      </div>
      <p v-if="currentRules.hold" class="speech-help">Manual hold. Use the slide controls to leave this slide.</p>
      <p v-else-if="nav.clicks.value < nav.clicksTotal.value" class="speech-help">Reveals: {{ currentRules.reveals === 'speech' ? 'follow speech' : 'manual clicks' }}</p>
      <div class="speech-feedback">
        <span class="speech-detail-label">Heard</span>
        <p ref="heardElement" class="speech-transcript">{{ transcript || 'Waiting for speech…' }}</p>
        <template v-if="feedback">
          <span class="speech-detail-label">{{ feedback.applied ? 'Last action' : 'Suggestion' }}</span>
          <strong>{{ actionLabels[feedback.decision.tool] }}</strong>
          <p v-if="feedback.decision.reason">{{ feedback.decision.reason }}</p>
        </template>
      </div>
    </div>

    <span class="speech-navigation-announcer" role="status" aria-live="polite">
      {{ displayMessage }}
    </span>
  </div>
</template>

<style scoped>
.speech-navigation {
  --speech-accent: #64748b;
  --speech-accent-rgb: 100 116 139;
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

.speech-navigation[data-state="learning"],
.speech-navigation[data-state="connecting"],
.speech-navigation[data-state="acting"],
.speech-navigation[data-state="preparing"] {
  --speech-accent: #d97706;
  --speech-accent-rgb: 217 119 6;
}

.speech-navigation[data-state="ready"],
.speech-navigation[data-state="listening"] {
  --speech-accent: #059669;
  --speech-accent-rgb: 5 150 105;
}

.speech-navigation[data-state="error"] {
  --speech-accent: #e11d48;
  --speech-accent-rgb: 225 29 72;
}

.speech-navigation-preparation { font-size: .7rem; font-weight: 500; color: var(--speech-accent); margin: 0 .4rem 0 .35rem; white-space: nowrap; }

.speech-navigation-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.35rem;
  height: 2.35rem;
  padding: 0;
  overflow: visible;
  border: 1px solid rgb(var(--speech-accent-rgb) / 22%);
  border-radius: 0.9rem;
  background:
    radial-gradient(circle at 30% 15%, rgb(255 255 255 / 88%), transparent 44%),
    linear-gradient(145deg, rgb(var(--speech-accent-rgb) / 16%), rgb(var(--speech-accent-rgb) / 7%));
  color: var(--speech-accent);
  box-shadow:
    0 1px 2px rgb(15 23 42 / 8%),
    0 6px 16px rgb(var(--speech-accent-rgb) / 12%),
    inset 0 1px 0 rgb(255 255 255 / 64%);
  opacity: 1;
  transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
}

.speech-navigation-trigger:hover {
  background:
    radial-gradient(circle at 30% 15%, rgb(255 255 255 / 96%), transparent 46%),
    linear-gradient(145deg, rgb(var(--speech-accent-rgb) / 22%), rgb(var(--speech-accent-rgb) / 10%));
  box-shadow:
    0 2px 4px rgb(15 23 42 / 10%),
    0 9px 22px rgb(var(--speech-accent-rgb) / 18%),
    inset 0 1px 0 rgb(255 255 255 / 72%);
  transform: translateY(-1px);
}

.speech-navigation-trigger:active {
  transform: translateY(0) scale(0.96);
}

.speech-navigation-trigger:disabled {
  cursor: wait;
  opacity: 0.72;
}

.speech-navigation-trigger:focus-visible {
  outline-color: var(--speech-accent);
}

.speech-navigation-aura {
  position: absolute;
  inset: -0.22rem;
  border: 1px solid rgb(var(--speech-accent-rgb) / 0%);
  border-radius: 1.06rem;
  pointer-events: none;
}

.speech-navigation[data-state="learning"] .speech-navigation-aura,
.speech-navigation[data-state="connecting"] .speech-navigation-aura,
.speech-navigation[data-state="acting"] .speech-navigation-aura,
.speech-navigation[data-state="preparing"] .speech-navigation-aura {
  border-color: rgb(var(--speech-accent-rgb) / 26%);
  border-top-color: var(--speech-accent);
  animation: speech-navigation-spin 1.15s linear infinite;
}

.speech-navigation[data-state="listening"] .speech-navigation-aura {
  border-color: rgb(var(--speech-accent-rgb) / 38%);
  animation: speech-navigation-breathe 2.2s ease-out infinite;
}

.speech-navigation-glyph {
  position: relative;
  display: grid;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
}

.speech-navigation-glyph svg {
  width: 1.12rem;
  height: 1.12rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.75;
}

.speech-navigation-glyph .speech-navigation-solid {
  fill: currentColor;
  stroke: none;
}

.speech-navigation-live-dot {
  position: absolute;
  right: -0.18rem;
  bottom: -0.16rem;
  width: 0.42rem;
  height: 0.42rem;
  border: 1.5px solid rgb(255 255 255 / 92%);
  border-radius: 999px;
  background: var(--speech-accent);
  box-shadow: 0 1px 3px rgb(15 23 42 / 22%);
}

.speech-navigation-panel {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.72rem);
  display: grid;
  gap: 0.22rem;
  width: 21rem;
  max-width: calc(100vw - 1.5rem);
  max-height: min(36rem, calc(100vh - 5rem));
  overflow-y: auto;
  padding: 0.72rem 0.82rem 0.78rem;
  overflow-wrap: anywhere;
  border: 1px solid rgb(15 23 42 / 10%);
  border-radius: 0.9rem;
  background: rgb(255 255 255 / 96%);
  color: #0f172a;
  box-shadow:
    0 2px 5px rgb(15 23 42 / 8%),
    0 14px 36px rgb(15 23 42 / 16%);
  opacity: 1;
  pointer-events: auto;
  transform: none;
  transform-origin: bottom right;
  visibility: visible;
  backdrop-filter: blur(18px) saturate(1.25);
  transition: opacity 160ms ease, transform 160ms ease, visibility 160ms ease;
}

.speech-navigation-panel::after {
  position: absolute;
  right: 0.8rem;
  bottom: -0.34rem;
  width: 0.65rem;
  height: 0.65rem;
  border-right: 1px solid rgb(15 23 42 / 10%);
  border-bottom: 1px solid rgb(15 23 42 / 10%);
  background: inherit;
  content: '';
  transform: rotate(45deg);
}

.speech-navigation-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.speech-navigation-close {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 0;
  border-radius: 0.4rem;
  color: inherit;
  background: transparent;
  opacity: 0.65;
  cursor: pointer;
}

.speech-navigation-close:hover {
  background: rgb(100 116 139 / 12%);
  opacity: 1;
}

.speech-navigation-close svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.speech-navigation-kicker {
  display: flex;
  align-items: center;
  gap: 0.38rem;
  color: #64748b;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1.2;
  text-transform: uppercase;
}

.speech-navigation-panel-dot {
  width: 0.42rem;
  height: 0.42rem;
  flex: none;
  border-radius: 999px;
  background: var(--speech-accent);
  box-shadow: 0 0 0 0.18rem rgb(var(--speech-accent-rgb) / 12%);
}

.speech-navigation-message {
  display: block;
  max-width: 17rem;
  font-size: 0.78rem;
  font-weight: 540;
  letter-spacing: -0.006em;
  line-height: 1.42;
}

.speech-navigation-announcer {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* The full selector must be global so Vue keeps the dark-mode descendant. */
:global(.dark .speech-navigation-trigger) {
  background:
    radial-gradient(circle at 30% 15%, rgb(255 255 255 / 16%), transparent 44%),
    linear-gradient(145deg, rgb(var(--speech-accent-rgb) / 22%), rgb(15 23 42 / 26%));
  box-shadow:
    0 1px 2px rgb(0 0 0 / 20%),
    0 7px 18px rgb(var(--speech-accent-rgb) / 14%),
    inset 0 1px 0 rgb(255 255 255 / 10%);
}

:global(.dark .speech-navigation-live-dot) {
  border-color: rgb(15 23 42 / 92%);
}

:global(.dark .speech-navigation-panel) {
  border-color: rgb(255 255 255 / 11%);
  background: rgb(15 23 42 / 95%);
  color: #f8fafc;
  box-shadow:
    0 2px 6px rgb(0 0 0 / 28%),
    0 16px 40px rgb(0 0 0 / 36%);
}

:global(.dark .speech-navigation-panel::after) {
  border-color: rgb(255 255 255 / 11%);
}

:global(.dark .speech-navigation-kicker) {
  color: #94a3b8;
}

@keyframes speech-navigation-spin {
  to { transform: rotate(360deg); }
}

@keyframes speech-navigation-breathe {
  0%, 100% {
    box-shadow: 0 0 0 0 rgb(var(--speech-accent-rgb) / 0%);
    opacity: 0.72;
  }
  48% {
    box-shadow: 0 0 0 0.28rem rgb(var(--speech-accent-rgb) / 12%);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .speech-navigation-aura,
  .speech-navigation-panel,
  .speech-navigation-trigger {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}

.speech-navigation-stop, .speech-navigation-options { width: 1.8rem; height: 2.35rem; display: grid; place-items: center; border-radius: .5rem; color: #64748b; }
.speech-navigation-stop svg, .speech-navigation-options svg { width: 1rem; height: 1rem; }
.speech-navigation-stop:hover, .speech-navigation-options:hover { background: rgb(100 116 139 / 12%); }
.speech-navigation-stop:focus-visible, .speech-navigation-options:focus-visible, .speech-navigation-panel button:focus-visible, .speech-navigation-panel select:focus-visible { outline: 2px solid #6366f1; outline-offset: 3px; }
.speech-control-row { display: flex; justify-content: space-between; align-items: center; gap: .75rem; margin-top: .65rem; font-size: .8rem; }
.speech-control-row button, .speech-control-row select { border: 1px solid rgb(100 116 139 / 30%); border-radius: .4rem; padding: .3rem .55rem; background: transparent; color: inherit; font: inherit; }
.speech-fast-mode input { width: 1rem; height: 1rem; accent-color: #6366f1; cursor: pointer; }
.speech-fast-mode input:focus-visible { outline: 2px solid #6366f1; outline-offset: 3px; }
.speech-control-row button:disabled { opacity: .4; cursor: not-allowed; }
.speech-help { font-size: .75rem; line-height: 1.4; color: #64748b; margin: .4rem 0 0; }
.speech-feedback { display: grid; gap: .3rem; margin-top: .7rem; padding-top: .7rem; border-top: 1px solid rgb(100 116 139 / 20%); font-size: .8rem; line-height: 1.4; }
.speech-feedback p { margin: 0; }
.speech-detail-label { color: #64748b; font-size: .65rem; text-transform: uppercase; letter-spacing: .06em; }
.speech-transcript { max-height: 6rem; overflow-y: auto; white-space: pre-wrap; margin-bottom: .5rem !important; }
.speech-navigation[data-state="rehearsing"] { --speech-accent: #6366f1; --speech-accent-rgb: 99 102 241; }
.speech-navigation[data-state="paused"] { --speech-accent: #d97706; --speech-accent-rgb: 217 119 6; }
:global(.dark .speech-help), :global(.dark .speech-detail-label) { color: #a3b1c6; }

</style>
