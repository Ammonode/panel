import { mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { config } from '../../../config'
import { randomString } from '../../../lib/crypto'
import { HttpError } from '../../../lib/errors'
import { setSettings } from '../../../lib/settings'
import { requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'

const dir = () => join(config.storagePath, 'public', 'branding')
const types: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

export const adminBrandingRoutes = new Hono<AppEnv>()
  .post('/branding/logo', requirePermission('admin.settings.manage'), async (c) => {
    const body = await c.req.parseBody()
    const file = body.logo
    if (!(file instanceof File) || !file.size) throw new HttpError(422, 'Choose an image', 'invalid')
    const ext = types[file.type]
    if (!ext) throw new HttpError(422, 'Use a PNG, JPG, WebP or SVG image', 'invalid')
    if (file.size > 1024 * 1024) throw new HttpError(422, 'The logo may be at most 1 MB', 'invalid')
    await mkdir(dir(), { recursive: true })
    // Remove previous logos; a new random name avoids stale browser caches.
    for (const f of await readdir(dir()))
      if (f.startsWith('logo-')) await unlink(join(dir(), f)).catch(() => {})
    const name = `logo-${randomString(8)}.${ext}`
    await Bun.write(join(dir(), name), file)
    await setSettings({ 'app.logo': `/media/branding/${name}` })
    return c.json({ data: { url: `/media/branding/${name}` } })
  })
  .delete('/branding/logo', requirePermission('admin.settings.manage'), async (c) => {
    await setSettings({ 'app.logo': null })
    return c.json({ ok: true })
  })

/** Public files (logos). Served with a sandbox CSP so SVGs cannot run scripts. */
export const mediaRoutes = new Hono().get('/branding/:file', async (c) => {
  const name = c.req.param('file')
  if (!/^logo-[A-Za-z0-9]+\.(png|jpg|webp|svg)$/.test(name)) return c.notFound()
  const file = Bun.file(join(dir(), name))
  if (!(await file.exists())) return c.notFound()
  return new Response(file, {
    headers: {
      'content-type': file.type,
      'cache-control': 'public, max-age=31536000, immutable',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  })
})
