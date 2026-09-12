import type { AddonSettings, NavigationBehavior } from '../shared/contracts'

const DEFAULT_BEHAVIOR: NavigationBehavior = 'balanced'

export function parseAddonSettings(value: unknown): AddonSettings {
  if (!value || typeof value !== 'object')
    return { behavior: DEFAULT_BEHAVIOR }

  const input = value as Record<string, unknown>
  const language = typeof input.language === 'string'
    ? input.language.trim().slice(0, 40)
    : ''
  const behavior = input.behavior === 'careful' ? 'careful' : DEFAULT_BEHAVIOR

  return {
    behavior,
    ...(language ? { language } : {}),
  }
}
