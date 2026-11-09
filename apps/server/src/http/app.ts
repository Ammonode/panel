import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { config } from '../config'
import { HttpError } from '../lib/errors'
import { getSettings } from '../lib/settings'
import { authenticate } from './middleware/auth'
import { accountRoutes } from './routes/account'
import { adminPanelRoutes } from './routes/admin/panel'
import { adminServerRoutes } from './routes/admin/servers'
import { authRoutes } from './routes/auth'
import { clientRoutes } from './routes/client'
import { remoteRoutes } from './routes/remote'
import type { AppEnv } from './types'

export const api = new Hono<AppEnv>()
  .use(authenticate)
  .get('/health', (c) => c.json({ ok: true }))
  .get('/settings/public', async (c) =>
    c.json(
      await getSettings([
        'app.name',
        'app.logo',
        'app.theme',
        'auth.registration',
        'billing.currency',
        'tickets.enabled',
      ]),
    ),
  )
  .route('/auth', authRoutes)
  .route('/account', accountRoutes)
  .route('/client', clientRoutes)
  .route('/admin', adminPanelRoutes)
  .route('/admin', adminServerRoutes)

export type Api = typeof api

export function createApp() {
  const app = new Hono<AppEnv>()
  app.use(secureHeaders({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: undefined }))

  // Basic CSRF protection for cookie authenticated requests.
  app.use('/api/*', async (c, next) => {
    const method = c.req.method
    if (method !== 'GET' && method !== 'HEAD' && !c.req.header('authorization')) {
      const origin = c.req.header('origin')
      if (origin && origin !== config.url && !config.isDev) throw new HttpError(403, 'Invalid origin', 'csrf')
    }
    await next()
  })

  // Daemon endpoints use node tokens, not sessions.
  app.route('/api/remote', remoteRoutes)
  app.route('/api', api)
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404))

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status)
    }
    console.error(err)
    return c.json({ error: { code: 'server_error', message: 'An unexpected error occurred.' } }, 500)
  })
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404))
  return app
}
