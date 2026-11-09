import type { schema } from '../db'

export type User = typeof schema.users.$inferSelect
export type Session = typeof schema.sessions.$inferSelect

export type AppEnv = {
  Variables: {
    user: User | null
    session: Session | null
    permissions: string[]
    apiKey: typeof schema.apiKeys.$inferSelect | null
  }
}
