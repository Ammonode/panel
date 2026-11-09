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

## Install

**One command** (Ubuntu 22.04+ / Debian 12+, sets up PostgreSQL, the panel,
a systemd service and Caddy with automatic HTTPS):

```bash
curl -sSL https://raw.githubusercontent.com/Ammonode/panel/main/install.sh | sudo bash
```

**Docker:**

```bash
curl -O https://raw.githubusercontent.com/Ammonode/panel/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/Ammonode/panel/main/.env.example
# set APP_URL, APP_KEY (openssl rand -base64 32) and DB_PASSWORD in .env
docker compose up -d
docker compose exec panel bun apps/server/src/cli.ts user:make --admin \
  --email you@example.com --username admin --password 'change-me'
```

Then add a node in **Admin → Nodes** and install the
[daemon](https://github.com/Ammonode/daemon) on it.

Full guides (manual install, reverse proxies, payments, backups, extensions):
https://github.com/Ammonode/docs

## Development

```bash
bun install
bun --cwd apps/server dev    # API on :3000
bun --cwd apps/web dev       # UI on :5173 (proxies /api)
```

Database changes: edit `apps/server/src/db/schema/*`, then `bun run db:generate`.

## License

MIT
