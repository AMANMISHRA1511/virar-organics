# Virar Organics

Repository: [AMANMISHRA1511/virar-organics](https://github.com/AMANMISHRA1511/virar-organics).

A connected organic grocery storefront, Admin studio and customer CRM built with React, Vite, Express, MySQL, Redis and Socket.IO. Customers can browse products, maintain an account basket, save delivery addresses and place orders. Administrators manage the same catalogue, stock, orders, website content and employee accounts.

The source includes local setup helpers, deployment configuration and repeatable tests. A hosted installation requires the frontend, backend, database, Redis and persistent media storage; publishing static files alone does not run the complete store.

## Run locally in VS Code

Install [Node.js 24 LTS](https://nodejs.org/en/download), [VS Code](https://code.visualstudio.com/docs/setup/windows) and [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/). Select Node 24 in the download version selector. On Windows, use Docker's Linux-container/WSL 2 backend and wait for its engine to start. Reopen VS Code after installing Node.

1. Clone the repository or download its ZIP and use **Extract All**.
2. In VS Code select **File → Open Folder**. Open the folder containing `setup.ps1`, `compose.yaml`, `backend` and `frontend`.
3. Select **Terminal → New Terminal**, then choose **PowerShell**.
4. Run setup and wait for it to finish before starting:

```powershell
.\setup.ps1
.\start.ps1
```

Setup starts local MySQL/Redis, installs locked dependencies, creates missing backend configuration with a random authentication secret, runs migrations and seeds demonstration data. It preserves existing configuration. First-time downloads need internet access and can take several minutes.

If PowerShell blocks scripts, use these alternatives:

```powershell
node scripts/setup.mjs
npm start
```

Keep the startup terminal open. Use **Ctrl+C** or `npm stop` to stop the application. `docker compose stop` stops the database services without deleting their volumes. Do not use volume-deletion commands unless you intend to erase local data.

| Destination | URL |
| --- | --- |
| Store | http://localhost:5173 |
| Customer registration | http://localhost:5173/register |
| Customer sign-in | http://localhost:5173/login |
| Employee sign-in | http://localhost:5173/admin/login |
| Admin studio | http://localhost:5173/admin |
| API health / readiness | http://localhost:4000/api/health · http://localhost:4000/api/ready |

Local demonstration accounts share the password `DemoOnly123!`:

| Account | Email |
| --- | --- |
| Administrator | `admin@mitti.test` |
| Sales Executive | `sales@mitti.test` |
| Customer | `customer@mitti.test` |

These fixtures are for local use. Production setup uses the first-Admin procedure below, not the demo seed. If startup fails, check the current folder, `node --version`, `docker info`, occupied ports and the first terminal error.

## Accounts and store management

| Role | Permissions |
| --- | --- |
| Visitor | Browse public pages; register a customer account |
| Customer | Own basket, addresses, orders, enquiries and notifications |
| Sales Executive | CRM leads, notes and follow-ups |
| Administrator | Catalogue, orders, customer directory, CRM, staff, settings and audit history |

Public registration always creates a Customer. An unknown email/password login does not create an account. Employees cannot self-register: an Admin opens **Team & access → Add staff member**, enters their details and selects Sales Executive or Administrator. The backend enforces these permissions. Access/password changes revoke existing sessions, and the last active Admin is protected.

To add products, create a category under **Categories**, then open **Products → Add product**. Enter the name, description, category, pack size, INR price and whole-number pack stock. Upload JPG, PNG or WebP images: up to eight per product, at most 5 MiB each. Wait for previews, choose the cover and save. Stock `0` means sold out; disabling **Active product** removes it from sale. The category must also be active. A stale stock edit requires reviewing the current quantity before saving.

**Website & settings** controls branding, banners, content, contact details, delivery fees and PIN zones. **Orders** provides fulfilment updates, timelines, tracking references and notification records. **Customers** shows account-linked addresses, orders and enquiries to Admins only.

Bundled sample photographs are illustrative and may be shared across related demonstration products. Replace them with photographs that accurately represent the products you sell.

## Stock, addresses and live updates

Adding to a basket does not reserve stock. Checkout locks inventory and commits the order, stock deduction and event records in one MySQL transaction. If two customers each request all ten remaining packs, only one order succeeds. Retrying the same checkout key/details returns the existing order; cancellation restores stock once.

Catalogue changes refresh connected screens, with reconnect, focus and periodic reconciliation. Network updates can arrive late; the database stock check remains authoritative. Pending online orders retain their reservation until eligible cancellation; automatic reservation expiry is not included.

Customers explicitly save reusable addresses to their account. Checkout retains its own shipping snapshot. Optional **Use my current location** asks permission and sends current device coordinates directly to BigDataCloud for editable area/city/state/PIN suggestions. Flat, building and landmark remain manual; denied permission or missing suggestions have a manual-entry fallback.

Private **Your updates** feeds are separate from Admin **Notifications**, which lists the email/SMS outbox. A manual delivery marker is not continuous courier GPS tracking.

## Provider configuration

Keep private values in backend environment settings. Never commit filled-in secrets or put them in `VITE_*` variables. Restart backend services after configuration changes.

| Feature | Configuration and limits |
| --- | --- |
| Google customer sign-in | Set `GOOGLE_CLIENT_ID` and authorize the exact frontend origin in Google. Existing password customers explicitly **Link Google** from Account. Staff remain password-only. |
| Phone OTP | `PHONE_OTP_MODE=simulated` is local practice, sends no SMS and does not verify ownership. Real delivery uses `twilio` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`; `disabled` turns it off. |
| Payments | `PAYMENT_MODE=mock` is a labelled local simulator. `razorpay` requires `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; only TEST keys are supported. `disabled` retains Cash on Delivery. |
| Email/SMS | `NOTIFICATION_MODE=simulated`, `disabled` or `configured`. Configured delivery needs SMTP settings and/or the Twilio variables above. OTP mode is independent. |
| Maps/location | `MAP_ENABLED`, `MAP_TILE_URL` and `LOCATION_PROVIDER=bigdatacloud` or `disabled`. Manual addresses work without these services. |

SMTP settings are `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM`. Outbox `sent`/`accepted` means provider acceptance, not confirmed inbox/handset delivery. Simulated records send nothing externally. In-app notices work without messaging credentials.

Razorpay's publicly reachable HTTPS webhook is `/api/payments/webhook`; configure `payment.captured`, `payment.failed` and `order.paid`. The backend validates signatures, order identity, amount, currency and replay. Refunds are manual. External Google login, payment completion and actual message receipt require independent verification with your own provider accounts. Provider services may charge fees.

## GitHub → Render backend → Netlify frontend

Push reviewed source to **GitHub's `main` branch first**, excluding secrets, dependencies, generated builds and local data. Connect both hosting services through their GitHub integration. These instructions prepare a deployment; they do not establish that a repository push or hosted deployment has completed.

### Backend services and Render settings

Use **one API instance**, MySQL 8.4 on a genuinely private network, persistent Redis with `noeviction`, and persistent uploads. **The MySQL connector has no TLS/CA configuration option.** Do not send database credentials across the public internet; a TLS-required external database needs separately implemented and verified connector support. Redis accepts `rediss://` where required.

Render persistent disks require a paid service. The API, MySQL, Redis, backups and provider usage are not promised to be free; select an approved budget before provisioning. Keep related services on a compatible private network. [Render service setup](https://render.com/docs/web-services) · [Persistent disks](https://render.com/docs/disks).

| Render Web Service setting | Value |
| --- | --- |
| Source | Connected GitHub repository; branch `main` |
| Root directory / runtime | `backend` / Node.js 24 |
| Build command | `npm ci --omit=dev` |
| Pre-deploy command, where available | `npm run migrate` |
| Start command | `npm start` |
| Health check | `/api/ready` |
| Disk mount | `/var/data` |
| Auto-Deploy | **On Commit** |

Use the connected Git provider, not Render's unauthenticated public-repository-URL option, which does not enable automatic deploys. **After CI Checks Pass** is an alternative only after CI exists. [Render automatic deploys](https://render.com/docs/deploys).

Use `backend/deployment.env.example` as the configuration template. Set:

```dotenv
NODE_ENV=production
NODE_VERSION=24.22.3
HOST=0.0.0.0
UPLOAD_DIR=/var/data/uploads
EMBEDDED_WORKER=true
SOCKET_PING_INTERVAL_MS=10000
SOCKET_PING_TIMEOUT_MS=10000
PAYMENT_MODE=disabled
PHONE_OTP_MODE=disabled
NOTIFICATION_MODE=disabled
MAP_ENABLED=false
LOCATION_PROVIDER=disabled
```

Render supplies `PORT`. Configure a strong `JWT_SECRET`, private `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `REDIS_URL`, an isolated `REDIS_PREFIX`, and exact frontend HTTPS `ALLOWED_ORIGINS`. Verify `TRUST_PROXY` against the actual forwarded-IP chain; never increase it blindly. Keep HTTP-only Secure cookies, CSRF and role checks enabled.

Before startup, migrate the intended database. If a pre-deploy step is unavailable, a controlled single-instance start command `npm run migrate && npm start` works but requires migration privileges. Never run local setup or the demonstration seed on a business database.

### One-time first Administrator

After migrations, supply protected `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` and `BOOTSTRAP_ADMIN_PASSWORD` values. Use a unique password of at least 16 characters, at most 72 UTF-8 bytes, with three character classes. From the backend deployment shell:

```sh
npm run bootstrap:admin
```

Alternatively pass the password from a protected source using `-- --password-stdin`. Never put it in command arguments or shell history. Remove bootstrap secrets afterward. Bootstrap refuses any existing Admin, never promotes a customer, and runs only when explicitly invoked. Create subsequent employees through **Team & access**.

### Netlify settings

Import the same connected GitHub repository, select **production branch `main`**, enable continuous deployment and leave automatic publishing unlocked.

| Setting | Value |
| --- | --- |
| Base directory | `frontend` |
| Build command | `node ../scripts/netlify-build.mjs` |
| Publish directory | `dist`, relative to base |
| Build environment | `BACKEND_ORIGIN=https://YOUR-ACTUAL-BACKEND-HOST` |

`netlify.toml` sets Node 24 and overrides conflicting dashboard settings. `BACKEND_ORIGIN` is non-secret but required: only a valid HTTPS origin, without credentials/path/query, is accepted. The generator places `/api`, `/uploads` and `/socket.io` proxies before the SPA fallback. Add the exact Netlify/custom frontend origin to the backend allowlist. Use separate staging backends for previews. [Netlify deploy configuration](https://docs.netlify.com/deploy/deploy-overview/).

Netlify builds use same-origin Socket.IO **HTTP polling**, preserving cookies and CSRF. Its external proxy has a **26-second timeout**; the 10-second interval plus 10-second timeout profile fits below it. Slow uploads or backend cold starts can still fail. Multiple APIs require polling-session affinity and shared media; Redis alone is insufficient. [Proxy limits](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/).

After connection, pushes/merges to `main` trigger each platform's configured deployment independently. Keep frontend/API changes compatible during rollout. Verify proxied readiness, sign-in, Admin-only staff creation, uploads after restart, private updates and a controlled order before relying on the hosted store.

## Repository checks

Enable the local commit hook once in each clone:

```sh
git config core.hooksPath .githooks
```

Before committing, stage the intended files and check the staged content:

```sh
git add .
node scripts/check-repository.mjs --github
```

To inspect every file currently in the Git index, run `node scripts/check-repository.mjs --tracked --github`. The guard checks common credential patterns and the repository's source-only file policy. It reports filenames and categories without printing secret values. Run its focused checks with `node --test tests/repository-guard.test.mjs`. A passing local check does not replace reviewing a diff or securing hosting credentials.

## Tests and maintenance

After local setup, run from the repository root:

```powershell
npm run check
npm run build
npm run test:unit
npm run test:frontend-logic
node --test tests/netlify-deployment.test.mjs
npm run test:integration
npm run test:branding
```

Integration tests use isolated Docker MySQL/Redis services and test databases. Keep ports 3310, 6381, 4100 and 4101 available. Never point destructive fixtures at business data. Browser checks require the running local demonstration store:

```powershell
npm ci
npx playwright install chromium
npm run test:browser
```

Browser tests create synthetic records. Test output distinguishes failures and skips; local checks do not prove hosted performance or external provider delivery. Back up MySQL and uploaded files together, test restoration separately, monitor readiness/queue failures, and review pending-payment reservations manually.
