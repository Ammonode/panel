import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '../config'
import * as schema from './schema'

export const sql = postgres(config.databaseUrl, { max: 10, onnotice: () => {} })
export const db = drizzle(sql, { schema, casing: 'snake_case' })
export type Database = typeof db
export { schema }
