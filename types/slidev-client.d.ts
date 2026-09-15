declare module '@slidev/client' {
  import type { ComputedRef } from 'vue'

  export interface SpeechNavigationSlidevNav {
    currentSlideNo: ComputedRef<number>
    total: ComputedRef<number>
    clicks: ComputedRef<number>
    clicksTotal: ComputedRef<number>
    currentSlideRoute: ComputedRef<{ meta: { slide: { frontmatter: Record<string, unknown> } } }>
    next: () => void | Promise<void>
    isPresenter: ComputedRef<boolean>
    isPrintMode: ComputedRef<boolean>
    nextSlide: () => void | Promise<void>
    prevSlide: () => void | Promise<void>
  }

  export function useNav(): SpeechNavigationSlidevNav
}
