import { defineConfig } from 'drizzle-kit'

// Migrations go through the session pooler (5432): the transaction pooler keeps neither
// prepared statements or a DDL session. Runtime uses a separate string, see client.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/*.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATE ?? '' },
  strict: true,
  verbose: true,
})
