import { Hono } from 'hono'
import { z } from 'zod'
import { encrypt } from '../../../lib/crypto'
import { HttpError } from '../../../lib/errors'
import { getSettings, setSettings } from '../../../lib/settings'
import { s3Storage } from '../../../services/backups'
import { requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import { validate } from '../../validate'

const MASK = '••••••••'
const keys = ['backups.driver', 'backups.s3_endpoint', 'backups.s3_region', 'backups.s3_bucket', 'backups.s3_access_key', 'backups.s3_secret_key', 'backups.s3_prefix', 'backups.s3_path_style']

export const adminBackupStorageRoutes = new Hono<AppEnv>()
  .get('/backup-storage', requirePermission('admin.settings.manage'), async (c) => {
    const s = await getSettings(keys)
    return c.json({ data: { ...s, 'backups.s3_secret_key': s['backups.s3_secret_key'] ? MASK : '' } })
  })
  .put(
    '/backup-storage',
    requirePermission('admin.settings.manage'),
    validate(
      'json',
      z.object({
        'backups.driver': z.enum(['local', 's3']),
        'backups.s3_endpoint': z.union([z.url(), z.literal('')]),
        'backups.s3_region': z.string().max(64),
        'backups.s3_bucket': z.string().max(191),
        'backups.s3_access_key': z.string().max(191),
        'backups.s3_secret_key': z.string().max(512),
        'backups.s3_prefix': z.string().max(191),
        'backups.s3_path_style': z.boolean(),
      }),
    ),
    async (c) => {
      const body = c.req.valid('json')
      if (body['backups.driver'] === 's3' && (!body['backups.s3_bucket'] || !body['backups.s3_access_key'])) throw new HttpError(422, 'Bucket and access key are required for S3', 'invalid')
      const values: Record<string, unknown> = { ...body }
      if (body['backups.s3_secret_key'] === MASK) delete values['backups.s3_secret_key']
      else if (body['backups.s3_secret_key']) values['backups.s3_secret_key'] = encrypt(body['backups.s3_secret_key'])
      await setSettings(values)
      return c.json({ ok: true })
    },
  )
  // Writes, reads and deletes a tiny object with the saved settings.
  .post('/backup-storage/test', requirePermission('admin.settings.manage'), async (c) => {
    const s3 = await s3Storage()
    if (!s3) throw new HttpError(422, 'Select S3 storage and save first', 'invalid')
    const key = s3.key({ serverId: 0, uuid: `connection-test-${Date.now()}` })
    try {
      await s3.client.write(key, 'ammonode connection test')
      const text = await s3.client.file(key).text()
      await s3.client.delete(key)
      if (text !== 'ammonode connection test') throw new Error('object content did not match')
    } catch (e) {
      throw new HttpError(422, `S3 test failed: ${(e as Error).message}`, 's3_failed')
    }
    return c.json({ ok: true })
  })
