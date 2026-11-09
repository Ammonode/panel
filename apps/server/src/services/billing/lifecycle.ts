import type { ServiceContext } from '@ammonode/sdk'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { emit, getProvisioner } from '../../extensions/registry'
import { logActivity } from '../../lib/activity'
import { serviceActivated, serviceSuspended } from '../notify'
import { addPeriod } from './money'

type Service = typeof schema.services.$inferSelect

/** Builds what a provisioner extension receives for a service. */
export async function serviceContext(service: Service): Promise<ServiceContext> {
  const product = (await db.query.products.findFirst({ where: eq(schema.products.id, service.productId) }))!
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, service.userId) }))!
  const configs = await db.query.serviceConfigs.findMany({
    where: eq(schema.serviceConfigs.serviceId, service.id),
  })
  const options = configs.length ? await db.query.configOptions.findMany() : []
  const configOptions: Record<string, string> = {}
  for (const c of configs) {
    const option = options.find((o) => o.id === c.configOptionId)
    const value = c.configValueId ? options.find((o) => o.id === c.configValueId) : null
    if (!option) continue
    const key = option.envVariable || option.name
    // For select/radio the value's env variable (e.g. "4096") is the machine value.
    configOptions[key] = value ? value.envVariable || value.name : (c.value ?? '')
  }
  const props = service.properties ?? {}
  const { getExtension } = await import('../../extensions/registry')
  return {
    service: {
      id: service.id,
      userId: service.userId,
      status: service.status,
      quantity: service.quantity,
      expiresAt: service.expiresAt,
      properties: props,
    },
    user: { id: user.id, uuid: user.uuid, email: user.email, username: user.username },
    product: { id: product.id, name: product.name, settings: product.serverSettings },
    configOptions,
    checkoutConfig: (props.checkout as Record<string, string>) ?? {},
    settings: (product.serverExtension && getExtension(product.serverExtension)?.settings) || {},
  }
}

async function provisionerFor(service: Service) {
  const product = await db.query.products.findFirst({ where: eq(schema.products.id, service.productId) })
  return getProvisioner(product?.serverExtension)
}

async function notifyAdmins(title: string, body: string, url: string) {
  const admins = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
  if (admins.length)
    await db.insert(schema.notifications).values(admins.map((a) => ({ userId: a.id, title, body, url })))
}

async function setStatus(id: number, values: Partial<Service>) {
  await db.update(schema.services).set(values).where(eq(schema.services.id, id))
}

/** Called when an invoice for the service is paid. */
export async function activateOrRenew(serviceId: number) {
  const service = await db.query.services.findFirst({ where: eq(schema.services.id, serviceId) })
  if (!service || service.status === 'cancelled') return
  const plan = await db.query.plans.findFirst({ where: eq(schema.plans.id, service.planId) })
  const recurring = plan?.type === 'recurring'
  const base = service.expiresAt && service.expiresAt > new Date() ? service.expiresAt : new Date()
  const expiresAt = recurring ? addPeriod(base, plan!.billingPeriod, plan!.billingUnit) : null

  if (service.status === 'pending') {
    const p = await provisionerFor(service)
    let properties: Record<string, unknown> = { ...service.properties }
    delete properties.provisionError
    if (p) {
      try {
        const result = await p.provisioner.create(await serviceContext(service))
        if (result) properties = { ...properties, ...result }
      } catch (e) {
        // Paid but not provisioned: keep it pending, tell staff, let them retry.
        const message = (e as Error).message
        await setStatus(service.id, { properties: { ...service.properties, provisionError: message } })
        await notifyAdmins(`Service #${service.id} could not be set up`, message, `/admin/services`)
        throw e
      }
    }
    await setStatus(service.id, { status: 'active', expiresAt, properties })
    const product = await db.query.products.findFirst({ where: eq(schema.products.id, service.productId) })
    if (product?.stock != null)
      await db
        .update(schema.products)
        .set({ stock: Math.max(0, product.stock - service.quantity) })
        .where(eq(schema.products.id, product.id))
    await logActivity({
      event: 'billing:service.activated',
      actorId: service.userId,
      subject: { type: 'service', id: service.id },
    })
    await emit('service.created', { serviceId: service.id, userId: service.userId })
    await serviceActivated(service.id)
    return
  }
  if (service.status === 'suspended') await unsuspendService(service.id)
  await setStatus(service.id, { expiresAt })
}

export async function suspendService(serviceId: number, reason = 'overdue') {
  const service = await db.query.services.findFirst({ where: eq(schema.services.id, serviceId) })
  if (service?.status !== 'active') return
  const p = await provisionerFor(service)
  if (p) await p.provisioner.suspend(await serviceContext(service))
  await setStatus(service.id, { status: 'suspended' })
  await logActivity({
    event: 'billing:service.suspended',
    subject: { type: 'service', id: service.id },
    properties: { reason },
  })
  await emit('service.suspended', { serviceId: service.id, userId: service.userId, reason })
  if (reason === 'overdue') await serviceSuspended(service.id)
}

export async function unsuspendService(serviceId: number) {
  const service = await db.query.services.findFirst({ where: eq(schema.services.id, serviceId) })
  if (service?.status !== 'suspended') return
  const p = await provisionerFor(service)
  if (p) await p.provisioner.unsuspend(await serviceContext(service))
  await setStatus(service.id, { status: 'active' })
  await logActivity({ event: 'billing:service.unsuspended', subject: { type: 'service', id: service.id } })
}

export async function terminateService(serviceId: number, reason = 'overdue') {
  const service = await db.query.services.findFirst({ where: eq(schema.services.id, serviceId) })
  if (!service || service.status === 'cancelled') return
  if (service.status !== 'pending') {
    const p = await provisionerFor(service)
    if (p) await p.provisioner.terminate(await serviceContext(service))
  }
  await setStatus(service.id, { status: 'cancelled' })
  // Cancel unpaid invoices that only renew this service.
  const items = await db.query.invoiceItems.findMany({
    where: eq(schema.invoiceItems.referenceId, service.id),
  })
  for (const item of items.filter((i) => i.referenceType === 'service')) {
    const inv = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, item.invoiceId) })
    if (inv?.status === 'pending')
      await db.update(schema.invoices).set({ status: 'cancelled' }).where(eq(schema.invoices.id, inv.id))
  }
  await logActivity({
    event: 'billing:service.terminated',
    subject: { type: 'service', id: service.id },
    properties: { reason },
  })
  await emit('service.terminated', { serviceId: service.id, userId: service.userId, reason })
}
