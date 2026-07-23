import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // generate doesn't need a live URL; runtime uses the driver adapter, not this.
    url: process.env.DATABASE_URL ?? 'mysql://root:root@127.0.0.1:3399/repro',
  },
})
