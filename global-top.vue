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

const isActive = computed(() => ['learning', 'connecting', 'listening', 'acting'].includes(status.value))
const isVisible = computed(() => Boolean(import.meta.hot) && nav.isPresenter.value && !nav.isPrintMode.value)
const buttonLabel = computed(() => {
  if (status.value === 'learning') return 'Learning…'
  if (status.value === 'connecting') return 'Connecting…'
  if (status.value === 'acting') return 'Moving…'
  if (status.value === 'listening') return 'Listening'
  if (status.value === 'error') return 'Try again'
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
    const runtime = await loadConfig(session.signal)
    if (session.signal.aborted)
      return
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
  void loadConfig().then((runtime) => {
    if (!runtime.ready)
      message.value = runtime.message
  }).catch(() => {
    message.value = 'Could not reach the local speech navigation service'
  })
})
onBeforeUnmount(() => {
  stopWatching()
  stopSession(false)
})
</script>

<template>
  <div v-if="isVisible" class="speech-navigation" :data-state="status">
    <button
      type="button"
      :aria-pressed="isActive"
      :title="message"
      @click="toggle"
    >
      <span class="speech-navigation-dot" aria-hidden="true" />
      {{ buttonLabel }}
    </button>
    <span class="speech-navigation-status" role="status" aria-live="polite">{{ message }}</span>
  </div>
</template>

<style scoped>
.speech-navigation {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 0.75rem;
  color: #18181b;
}

.speech-navigation button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.25rem;
  padding: 0.45rem 0.75rem;
  border: 1px solid rgb(24 24 27 / 18%);
  border-radius: 999px;
  background: rgb(255 255 255 / 94%);
  color: inherit;
  box-shadow: 0 2px 12px rgb(0 0 0 / 14%);
  cursor: pointer;
}

.speech-navigation button:hover {
  background: #fff;
}

.speech-navigation button:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.speech-navigation-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #71717a;
}

[data-state="learning"] .speech-navigation-dot,
[data-state="connecting"] .speech-navigation-dot,
[data-state="acting"] .speech-navigation-dot {
  background: #f59e0b;
}

[data-state="listening"] .speech-navigation-dot {
  background: #16a34a;
  box-shadow: 0 0 0 0.2rem rgb(22 163 74 / 18%);
}

[data-state="error"] .speech-navigation-dot {
  background: #dc2626;
}

.speech-navigation-status {
  max-width: 18rem;
  padding: 0.35rem 0.55rem;
  border-radius: 0.4rem;
  background: rgb(255 255 255 / 90%);
  box-shadow: 0 1px 6px rgb(0 0 0 / 10%);
}

[data-state="off"] .speech-navigation-status,
[data-state="listening"] .speech-navigation-status {
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
</style>
