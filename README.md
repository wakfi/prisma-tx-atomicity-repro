# Prisma `$transaction` is not atomic on timeout

A `$transaction` that hits its `timeout` can **partially commit**: a statement whose dispatch
is delayed past the timeout lands on the connection *after* the `ROLLBACK` the timeout
triggers, so it autocommits — while an earlier statement in the same transaction is correctly
rolled back.

The repro starts with an **empty table** and runs a transaction that times out and reports
itself rolled back (`P2028`). An atomic implementation must leave the table empty. Instead, one
row survives — a leaked write.

## Mechanism

Server-side statement order on the transaction's connection, captured from the MySQL general log:

```
BEGIN
INSERT INTO Item VALUES (1)     -- inside the transaction
ROLLBACK                        -- timeout fires -> row 1 undone
INSERT INTO Item VALUES (2)     -- dispatched late -> lands after ROLLBACK -> AUTOCOMMITS
```

The transaction timeout issues `ROLLBACK` on the connection but does **not** serialize it
against statement dispatch. When the event loop delays a statement's dispatch past the instant
the timer fires — which happens naturally under load — `ROLLBACK` wins the race to the wire and
the late statement executes with no active transaction.

The `sleep(50)` in `repro.ts` only makes the race **deterministic**. With no injected delay, a
concurrency harness reproduced the same corruption in ~10–15% of timed-out transactions.

## Run it

Requires Docker and Node.

```bash
./setup.sh
```

That starts a throwaway MySQL 8.0 on `:3399`, installs deps, generates the client, and runs the
repro once. Expected output:

```
transaction FAILED and reported itself rolled back: P2028 (P2028 = timeout)

Item table after the rolled-back transaction: [{"id":2}]
=> LEAK: 1 row(s) survived a transaction that rolled back
```

To re-run on its own afterwards: `npm run repro`.

## Inspect the leaked state

The container is left running. Open Prisma Studio:

```bash
DATABASE_URL="mysql://root:root@127.0.0.1:3399/repro" npm run studio   # http://localhost:5555
```

The **Item** table started empty; it now contains one row, left behind by a transaction that
rolled back.

## Versions affected

Reproduces deterministically on **7.8.0**, **7.9.0** (latest stable), and **7.10.0-dev.23**
(latest dev) — i.e. not fixed in any released or pre-release version at time of writing. Uses
`@prisma/adapter-mariadb`; the defect is in the `@prisma/client` transaction manager and is
independent of the MySQL server (PlanetScale/Vitess behaves identically).

## Tear down

```bash
docker rm -f prisma-repro
```
