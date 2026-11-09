import { realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { Hono } from 'hono'
import { getExtension } from '../../extensions/registry'

const types: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  woff2: 'font/woff2',
}

/**
 * Static files of installed extensions (web modules, theme CSS, images).
 * Only enabled extensions are served and paths cannot leave the extension folder.
 */
export const extensionAssetRoutes = new Hono().get('/:id/*', async (c) => {
  const ext = getExtension(c.req.param('id'))
  if (!ext?.enabled || !ext.path) return c.notFound()
  const rel = decodeURIComponent(c.req.path.slice(`/extension-assets/${c.req.param('id')}/`.length))
  const ext2 = rel.split('.').pop()?.toLowerCase() ?? ''
  const type = types[ext2]
  if (!type || rel.includes('\\0')) return c.notFound()
  let file: string
  try {
    const root = await realpath(ext.path)
    file = await realpath(join(root, rel))
    if (!file.startsWith(root + sep)) return c.notFound()
  } catch {
    return c.notFound()
  }
  // Never expose the server entry or other source of the extension.
  if (ext.manifest.server && file.endsWith(ext.manifest.server.replace(/^\.?\//, ''))) return c.notFound()
  return new Response(Bun.file(file), {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
})
