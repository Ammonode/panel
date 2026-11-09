import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { logActivity } from '../lib/activity'
import { getSetting } from '../lib/settings'
import { addCredits } from './billing/invoices'
import { fromCents, percentOf, toCents } from './billing/money'
import { notify } from './notify'

export const REF_COOKIE = 'ammonode_ref'

/** Links a newly registered user to the affiliate whose code they arrived with. */
export async function attachReferral(userId: number, code: string | undefined) {
  if (!code || !(await getSetting('affiliates.enabled'))) return
  const affiliate = await db.query.affiliates.findFirst({ where: eq(schema.affiliates.code, code) })
  if (!affiliate || affiliate.userId === userId) return
  await db
    .insert(schema.affiliateReferrals)
    .values({ affiliateId: affiliate.id, userId })
    .onConflictDoNothing()
}

/**
 * Pays the affiliate commission for a paid invoice as account credit.
 * Credit top-ups never earn commission.
 */
export async function rewardAffiliate(invoiceId: number) {
  if (!(await getSetting('affiliates.enabled'))) return
  const invoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) })
  if (!invoice) return
  const referral = await db.query.affiliateReferrals.findFirst({
    where: eq(schema.affiliateReferrals.userId, invoice.userId),
  })
  if (!referral) return
  const affiliate = await db.query.affiliates.findFirst({
    where: eq(schema.affiliates.id, referral.affiliateId),
  })
  if (!affiliate) return
  const items = await db.query.invoiceItems.findMany({ where: eq(schema.invoiceItems.invoiceId, invoiceId) })
  if (items.some((i) => i.referenceType === 'credit')) return
  // Commission on what was charged, excluding tax.
  const base = items
    .filter((i) => i.referenceType !== 'tax')
    .reduce((s, i) => s + toCents(i.price) * i.quantity, 0)
  const percent = Number(affiliate.rewardPercent ?? (await getSetting('affiliates.reward_percent')))
  const reward = percentOf(base, percent)
  if (reward <= 0) return
  await addCredits(affiliate.userId, invoice.currencyCode, reward)
  const cur = invoice.currencyCode
  await db.execute(sql`
    update affiliate_referrals set earnings = jsonb_set(earnings, ${`{${cur}}`}::text[],
      to_jsonb(round((coalesce((earnings->>${cur})::numeric, 0) + ${fromCents(reward)}::numeric), 2)::text))
    where id = ${referral.id}`)
  await notify(affiliate.userId, {
    title: `You earned ${fromCents(reward)} ${cur} commission`,
    url: '/affiliate',
  })
  await logActivity({
    event: 'billing:affiliate.reward',
    subject: { type: 'invoice', id: invoiceId },
    properties: { affiliateId: affiliate.id, amount: fromCents(reward), currency: cur },
  })
}
