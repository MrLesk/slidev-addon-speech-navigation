declare module '@slidev/client' {
  import type { ComputedRef } from 'vue'

  export interface SpeechNavigationSlidevNav {
    currentSlideNo: ComputedRef<number>
    total: ComputedRef<number>
    isPresenter: ComputedRef<boolean>
    isPrintMode: ComputedRef<boolean>
    nextSlide: () => void | Promise<void>
    prevSlide: () => void | Promise<void>
  }

  export function useNav(): SpeechNavigationSlidevNav
}
