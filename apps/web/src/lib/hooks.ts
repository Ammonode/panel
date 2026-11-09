import { type RefObject, useEffect } from 'react'

/** Calls `onOutside` when a pointer press or Escape happens outside of `ref`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onOutside()
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [ref, open, onOutside])
}
