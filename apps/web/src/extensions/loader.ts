import type { QueryClient } from '@tanstack/react-query'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ui from '../components/ui'
import { api } from '../lib/api'
import { registry } from './registry'

type Asset = { id: string; type: string; version: string; web: string | null; stylesheet: string | null }

/**
 * Everything an extension's web module can use, exposed as `window.Ammonode`.
 * Modules are plain ES modules; their default export is called with this object.
 */
export function createPublicApi(queryClient: QueryClient, router: unknown) {
  return { version: 1, React, jsx: jsxRuntime, ui, api, registry, queryClient, router }
}
export type AmmonodeWebApi = ReturnType<typeof createPublicApi>

/** Loads theme stylesheets and extension modules of enabled extensions. */
export async function loadWebExtensions(publicApi: AmmonodeWebApi) {
  let assets: Asset[] = []
  try {
    assets = (await api.get<{ data: Asset[] }>('/ui/extensions')).data
  } catch {
    return
  }
  for (const a of assets) {
    if (a.stylesheet) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = a.stylesheet
      link.dataset.extension = a.id
      // Appended after the app styles so theme tokens win.
      document.head.appendChild(link)
    }
  }
  await Promise.all(
    assets
      .filter((a) => a.web)
      .map(async (a) => {
        try {
          const mod = await import(/* @vite-ignore */ a.web!)
          if (typeof mod.default === 'function') await mod.default(publicApi)
        } catch (e) {
          console.error(`Extension ${a.id} failed to load:`, e)
        }
      }),
  )
}
