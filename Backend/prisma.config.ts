// prisma.config.ts — read by the Prisma CLI (generate, migrate, studio). Prisma 7 does not load .env
// itself, so dotenv does it here; on Render DATABASE_URL comes from the service environment.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
