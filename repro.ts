// Standalone repro: Prisma `$transaction([...])` (batch form) is NOT atomic when it times out.
//
// A statement whose dispatch is delayed past the interactive-transaction timeout lands on the
// connection AFTER the ROLLBACK the timeout triggers, so it autocommits — while its sibling in
// the same transaction is correctly rolled back. Net: a partial commit of a "rolled back" tx.
//
// The table starts empty and the transaction is rolled back, so an atomic implementation must
// leave the table empty. Any surviving row is a leaked write.
//
// Run ./setup.sh (or see README.md).
import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// pass-through Proxy with a few overridden methods
const proxy = (o: any, over: any) =>
  new Proxy(o, { get: (t, k) => (k in over ? over[k] : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) })

// Delay dispatch of the 2nd statement in the batch past the timeout. The sleep only makes the
// race deterministic; under real load the same delay happens naturally (event-loop scheduling
// pushing a statement's dispatch past the moment the timeout timer fires).
function wrapTx(tx: any) {
  let n = 0
  return proxy(tx, { executeRaw: async (q: any) => (++n === 2 && (await sleep(50)), tx.executeRaw(q)) })
}
const factory = new PrismaMariaDb({ host: '127.0.0.1', port: 3399, user: 'root', password: 'root', database: 'repro' })
const adapter = proxy(factory, {
  connect: async () => {
    const a = await factory.connect()
    return proxy(a, { startTransaction: async (i: any) => wrapTx(await a.startTransaction(i)) })
  },
})
const prisma = new PrismaClient({ adapter } as any) as any

async function main() {
  // Empty table. A rolled-back transaction must leave it empty.
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS Item')
  await prisma.$executeRawUnsafe('CREATE TABLE Item (id INT NOT NULL PRIMARY KEY)')

  try {
    await prisma.$transaction(
      [prisma.$executeRawUnsafe('INSERT INTO Item VALUES (1)'), prisma.$executeRawUnsafe('INSERT INTO Item VALUES (2)')],
      { timeout: 10 },
    )
    console.log('transaction committed')
  } catch (e: any) {
    console.log('transaction FAILED and reported itself rolled back:', e.code, '(P2028 = timeout)')
  }

  const rows = (await prisma.$queryRawUnsafe('SELECT id FROM Item ORDER BY id')) as any[]
  console.log(`\nItem table after the rolled-back transaction: ${JSON.stringify(rows)}`)
  console.log(
    rows.length === 0
      ? '=> atomic: table empty, as it must be for a rolled-back transaction'
      : `=> LEAK: ${rows.length} row(s) survived a transaction that rolled back`,
  )
  await prisma.$disconnect()
}
main()
