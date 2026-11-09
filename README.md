# Ammonode Panel

Billing and game server management in one panel. Sell plans, take payments and
run game servers from the same place — no bridge modules, no second login.

- **Game panel** — nodes, allocations, nests & eggs, console, file manager,
  schedules, backups, databases and subusers. Works with the official
  [Pterodactyl eggs](https://eggs.pterodactyl.io/): browse and import them in one click.
- **Billing** — products, plans, configurable options, coupons, invoices, credits,
  taxes, tickets, affiliates. Stripe and PayPal out of the box.
- **Extensions & themes** — gateways, provisioners, addons and themes are all
  extensions built on the same public SDK.

Servers run on [Ammonode Daemon](https://github.com/Ammonode/daemon).

## Requirements

- [Bun](https://bun.sh) 1.4+
- PostgreSQL 15+

## Quick start

```bash
git clone https://github.com/Ammonode/panel.git /var/www/ammonode
cd /var/www/ammonode
bun install
cp .env.example .env
bun apps/server/src/cli.ts key:generate   # paste into APP_KEY
# set DATABASE_URL in .env
bun run build
bun apps/server/src/cli.ts setup          # migrate, seed, create the first admin
bun start
```

Full installation guide, webserver and daemon setup: https://github.com/Ammonode/docs

## Development

```bash
bun install
bun --cwd apps/server dev    # API on :3000
bun --cwd apps/web dev       # UI on :5173 (proxies /api)
```

Database changes: edit `apps/server/src/db/schema/*`, then `bun run db:generate`.

## License

MIT
