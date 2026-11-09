import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodType } from 'zod'
import { badRequest } from '../lib/errors'

/** zod validator that throws a uniform 422 error body. */
export const validate = <T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const errors: Record<string, string> = {}
      for (const issue of result.error.issues) errors[issue.path.join('.') || '_'] ??= issue.message
      throw badRequest('The given data was invalid.', errors)
    }
  })
