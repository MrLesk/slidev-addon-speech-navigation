import type { AddonSettings, NavigationBehavior, SlideRules } from '../shared/contracts'

const DEFAULT_BEHAVIOR: NavigationBehavior = 'balanced'

function readModelName(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

export function resolveModel(override: unknown, configured: unknown, fallback: string): string {
  return readModelName(override) ?? readModelName(configured) ?? fallback
}

export function parseNavigationBehavior(value: unknown, fallback: NavigationBehavior = DEFAULT_BEHAVIOR): NavigationBehavior {
  return value === 'balanced' || value === 'careful' ? value : fallback
}

export function parseAddonSettings(value: unknown): AddonSettings {
  if (!value || typeof value !== 'object')
    return { behavior: DEFAULT_BEHAVIOR, fastMode: true }

  const input = value as Record<string, unknown>
  const language = typeof input.language === 'string'
    ? input.language.trim().slice(0, 40)
    : ''
  const liveModel = readModelName(input.liveModel)
  const model = readModelName(input.model)
  const behavior = parseNavigationBehavior(input.behavior)

  return {
    behavior,
    fastMode: input.fastMode !== false,
    ...(language ? { language } : {}),
    ...(liveModel ? { liveModel } : {}),
    ...(model ? { model } : {}),
    ...(input.reveals === 'speech' ? { reveals: 'speech' as const } : {}),
    ...(input.mode === 'rehearsal' ? { mode: 'rehearsal' as const } : {}),
  }
}

/** Per-slide rules override the deck default. A hold always wins. */
export function parseSlideRules(value: unknown, settings: AddonSettings): SlideRules {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    hold: input.hold === true,
    reveals: input.reveals === 'speech' || input.reveals === 'manual'
      ? input.reveals
      : settings.reveals ?? 'manual',
  }
}
