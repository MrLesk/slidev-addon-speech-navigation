<script setup lang="ts">
import { useNav } from '@slidev/client'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { prefetchSlideWindow, SpeechDirector } from './src/client/director'
import { CONFIG_PATH, type NavigationState, type NavigationStatus, type NavigationTool, type RuntimeConfig } from './src/shared/contracts'

const nav = useNav()
const director = shallowRef<SpeechDirector | null>(null)
const config = ref<RuntimeConfig | null>(null)
const status = ref<NavigationStatus>('off')
const message = ref('Speech navigation is off')
let sessionAbort: AbortController | null = null
let configPoll: ReturnType<typeof setTimeout> | null = null
let mounted = false

const isActive = computed(() => ['learning', 'connecting', 'listening', 'acting'].includes(status.value))
const isVisible = computed(() => Boolean(import.meta.hot) && window.location.pathname.split('/').includes('presenter'))
const isPreparing = computed(() => config.value?.assets === 'preparing')
const isUnavailable = computed(() => config.value?.assets === 'error')
const displayState = computed(() => {
  if (status.value !== 'off')
    return status.value
  if (isPreparing.value)
    return 'preparing'
  if (config.value && !config.value.ready)
    return 'error'
  return 'off'
})
const buttonLabel = computed(() => {
  if (status.value === 'learning') return 'Learning…'
  if (status.value === 'connecting') return 'Connecting…'
  if (status.value === 'acting') return 'Moving…'
  if (status.value === 'listening') return 'Listening'
  if (status.value === 'error') return 'Try again'
  if (isUnavailable.value) return 'Retrying…'
  if (isPreparing.value) return 'Preparing…'
  return 'Speech nav'
})

function currentState(): NavigationState {
  return {
    currentSlide: nav.currentSlideNo.value,
    totalSlides: nav.total.value,
  }
}

async function loadConfig(signal?: AbortSignal) {
  const response = await fetch(CONFIG_PATH, { cache: 'no-store', signal })
  if (!response.ok)
    throw new Error('Could not reach the local speech navigation service')
  config.value = await response.json() as RuntimeConfig
  return config.value
}

function scheduleConfigPoll() {
  if (!mounted)
    return
  if (configPoll)
    clearTimeout(configPoll)
  configPoll = setTimeout(() => {
    configPoll = null
    void refreshConfig().catch(() => {})
  }, 1_000)
}

async function refreshConfig(signal?: AbortSignal) {
  try {
    const runtime = await loadConfig(signal)
    if (!runtime.ready)
      message.value = runtime.message
    else if (status.value === 'off')
      message.value = 'Speech navigation is off'

    if (runtime.assets === 'preparing' || runtime.assets === 'error')
      scheduleConfigPoll()
    return runtime
  }
  catch (error) {
    message.value = 'Could not reach the local speech navigation service'
    throw error
  }
}

async function execute(tool: NavigationTool) {
  if (tool === 'next_slide' && nav.currentSlideNo.value < nav.total.value)
    await nav.nextSlide()
  else if (tool === 'previous_slide' && nav.currentSlideNo.value > 1)
    await nav.prevSlide()
  await nextTick()
}

async function toggle() {
  if (sessionAbort || director.value) {
    stopSession()
    return
  }

  const session = new AbortController()
  sessionAbort = session
  status.value = 'learning'
  message.value = 'Learning this group of slides…'
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

    await prefetchSlideWindow(currentState(), session.signal)
    if (session.signal.aborted)
      return

    const instance = new SpeechDirector({
      getState: currentState,
      execute,
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

let previousState = currentState()
const stopWatching = watch(
  [nav.currentSlideNo, nav.total],
  () => {
    const nextState = currentState()
    director.value?.updateSlideState(previousState, nextState)
    previousState = nextState
    if (director.value && sessionAbort)
      void prefetchSlideWindow(nextState, sessionAbort.signal).catch(() => {})
  },
)

onMounted(() => {
  mounted = true
  if (isVisible.value)
    void refreshConfig().catch(() => {})
})
onBeforeUnmount(() => {
  mounted = false
  if (configPoll)
    clearTimeout(configPoll)
  stopWatching()
  stopSession(false)
})
</script>

<template>
  <div v-if="isVisible" class="speech-navigation" :data-state="displayState">
    <button
      type="button"
      class="slidev-icon-btn speech-navigation-trigger"
      :aria-pressed="isActive"
      :disabled="isPreparing || isUnavailable"
      :aria-label="buttonLabel"
      :title="`${buttonLabel} — ${message}`"
      @click="toggle"
    >
      <span class="speech-navigation-aura" aria-hidden="true" />
      <span class="speech-navigation-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="presentation">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
          <path d="M6.75 11.25V12a5.25 5.25 0 0 0 10.5 0v-.75M12 17.25V21M9.25 21h5.5" />
        </svg>
        <span class="speech-navigation-live-dot" />
      </span>
    </button>

    <div class="speech-navigation-panel" aria-hidden="true">
      <span class="speech-navigation-kicker">
        <span class="speech-navigation-panel-dot" />
        Speech navigation
      </span>
      <span class="speech-navigation-message">{{ message }}</span>
    </div>

    <span class="speech-navigation-announcer" role="status" aria-live="polite">
      {{ message }}
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

.speech-navigation[data-state="listening"] {
  --speech-accent: #059669;
  --speech-accent-rgb: 5 150 105;
}

.speech-navigation[data-state="error"] {
  --speech-accent: #e11d48;
  --speech-accent-rgb: 225 29 72;
}

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
  width: max-content;
  max-width: min(19rem, calc(100vw - 1.5rem));
  padding: 0.72rem 0.82rem 0.78rem;
  overflow-wrap: anywhere;
  border: 1px solid rgb(15 23 42 / 10%);
  border-radius: 0.9rem;
  background: rgb(255 255 255 / 96%);
  color: #0f172a;
  box-shadow:
    0 2px 5px rgb(15 23 42 / 8%),
    0 14px 36px rgb(15 23 42 / 16%);
  opacity: 0;
  pointer-events: none;
  transform: translateY(0.35rem) scale(0.98);
  transform-origin: bottom right;
  visibility: hidden;
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

.speech-navigation:hover .speech-navigation-panel,
.speech-navigation-trigger:focus-visible ~ .speech-navigation-panel,
.speech-navigation[data-state="learning"] .speech-navigation-panel,
.speech-navigation[data-state="connecting"] .speech-navigation-panel,
.speech-navigation[data-state="acting"] .speech-navigation-panel,
.speech-navigation[data-state="preparing"] .speech-navigation-panel,
.speech-navigation[data-state="error"] .speech-navigation-panel {
  opacity: 1;
  transform: translateY(0) scale(1);
  visibility: visible;
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
</style>
