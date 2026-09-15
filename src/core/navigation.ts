import type { NavigationDecision, NavigationState, NavigationTool, SlideRules } from '../shared/contracts'

export function sameNavigationState(a: NavigationState, b: NavigationState) {
  return a.currentSlide === b.currentSlide && a.totalSlides === b.totalSlides
    && (a.currentClick ?? 0) === (b.currentClick ?? 0)
    && (a.totalClicks ?? 0) === (b.totalClicks ?? 0)
}

export function allowedTools(state: NavigationState, rules: SlideRules): NavigationTool[] {
  if (rules.hold)
    return ['hold_slide']
  const tools: NavigationTool[] = ['hold_slide']
  if (state.currentSlide > 1)
    tools.push('previous_slide')
  if ((state.currentClick ?? 0) < (state.totalClicks ?? 0)) {
    if (rules.reveals === 'speech')
      tools.push('reveal_next')
  }
  else if (state.currentSlide < state.totalSlides) {
    tools.push('next_slide')
  }
  return tools
}

/** Enforce rules even if a model returns an unavailable action. */
export function constrainDecision(decision: NavigationDecision, state: NavigationState, rules: SlideRules): NavigationDecision {
  return allowedTools(state, rules).includes(decision.tool)
    ? decision
    : { tool: 'hold_slide', reason: rules.hold ? 'This slide uses manual control.' : 'This action is not available at the current step.' }
}
