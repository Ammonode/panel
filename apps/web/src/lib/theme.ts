import { useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

function apply(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      return (localStorage.getItem('ammonode.theme') as ThemeMode) || 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    apply(mode)
    try {
      localStorage.setItem('ammonode.theme', mode)
    } catch {}
  }, [mode])
  const isDark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  return { mode, setMode, isDark }
}
