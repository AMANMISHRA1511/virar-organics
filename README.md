# Virar Organics

Repository: [AMANMISHRA1511/virar-organics](https://github.com/AMANMISHRA1511/virar-organics).

A connected organic grocery storefront, Admin studio and customer CRM built with React, Vite, Express, PostgreSQL/MySQL, Redis and Socket.IO. Customers can browse products, maintain an account basket, save delivery addresses and place orders. Administrators manage the same catalogue, stock, orders, website content and employee accounts.

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

Adding to a basket does not reserve stock. Checkout locks inventory and commits the order, stock deduction and event records in one SQL transaction. If two customers each request all ten remaining packs, only one order succeeds. Retrying the same checkout key/details returns the existing order; cancellation restores stock once.

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

### Free Render deployment

The included `render.yaml` uses **only Free plans** in Singapore: one public Node API, one PostgreSQL database and one private Key Value instance. There are no paid disks, private MySQL services, background workers or cron jobs. Render generates the authentication secret and supplies internal database/Redis connection strings. Secrets stay in the hosting environment.

**This is a temporary free testing deployment, not permanent production hosting.** [Render's Free limits](https://render.com/docs/free):

| Resource | Free limit and effect |
| --- | --- |
| API | Sleeps after 15 idle minutes; waking can take about a minute. 750 free instance hours per workspace per month. |
| PostgreSQL | 1 GB; expires 30 days after creation. Export before expiry. No managed backups are included. |
| Key Value | 25 MB and 50 connections; data is lost on restart. SQL remains authoritative for users, stock, orders, event outboxes and private notices. |
| Media | WebP bytes are stored in PostgreSQL, so API restarts do not delete uploads. They still share the database's capacity and expiry. |
| Email | Free web services block SMTP ports 25, 465 and 587. The default deployment does not send email/SMS. |
| Quotas | Free plans do not remove bandwidth/build quotas. Without a payment method, exhausted quotas can suspend service. Do not add paid plans or automatic upgrades unintentionally. |

Create the Blueprint from this repository's connected GitHub `main` branch, review that **all three resource plans are Free**, and apply it. Enable automatic syncing. Review future `render.yaml` changes because they can change infrastructure as well as code. Use the Git provider integration; a public repository URL alone does not enable continuous deployment. [Render deployments](https://render.com/docs/deploys).

| Render Web Service setting | Value |
| --- | --- |
| Root directory / runtime | `backend` / Node.js 24 |
| Build command | `npm ci --omit=dev` |
| Start command | `node scripts/start-free.mjs` |
| Health check | `/api/ready` |
| Auto-Deploy | **On Commit** |
| Database / uploads | `DB_CLIENT=postgres`, `UPLOAD_STORAGE=database` |
| Pool size | `DB_POOL_SIZE=4` |
| Disk / pre-deploy command | None; Free services do not support these |

The start script runs non-destructive migrations, optionally imports the bundled catalogue and then starts the API. The first import adds 12 categories, 72 products and 20 illustrative images. **All initial stock is 0**: an Administrator must confirm actual quantities, prices, delivery fees/zones, contact details and product photographs before selling. Import creates no people, demo orders, leads or outbound messages. It never overwrites an existing catalogue or reimports a previously initialized catalogue after its products are removed.

Use `backend/deployment.env.example` for environment names. Set the exact public frontend origin in `ALLOWED_ORIGINS` (`https://virar-organics.netlify.app` for this installation). `DATABASE_URL` must be Render's internal PostgreSQL URL; use TLS and certificate verification when configuring an external database. The existing MySQL mode remains available locally and on a separately configured private host. Do not transmit its credentials over a public plaintext connection.

Default external providers are disabled: Cash on Delivery, customer password accounts and SQL-backed private in-app updates work without provider credentials. Browser **Use current location** asks permission before requesting an address suggestion; flat/room details and manual correction remain available. Google, real SMS OTP and Razorpay TEST payments require their own configuration and verification. Free Render does not provide free SMS or payment processing.

### First Administrator on a Free service

A new deployment deliberately has **no default Admin password**. Free web services have no SSH/deployment shell. In **Render → virar-organics-api → Environment**, temporarily set:

| Variable | Value |
| --- | --- |
| `BOOTSTRAP_ADMIN_ON_START` | `true` |
| `BOOTSTRAP_ADMIN_NAME` | Your name |
| `BOOTSTRAP_ADMIN_EMAIL` | Your email address |
| `BOOTSTRAP_ADMIN_PASSWORD` | A unique protected password, at least 16 characters and at most 72 UTF-8 bytes, using three character classes |

Choose **Save, rebuild and deploy**. Wait for the successful `admin-bootstrap` log entry, then remove all four bootstrap variables and redeploy. Sign in at the frontend's `/admin/login`. The password is hashed; bootstrap never prints it, changes an existing Admin or promotes an existing customer email. If that email already belongs to a customer, choose a different staff email. Create later employees through **Team & access**.

On a host with a shell, the explicit `npm run bootstrap:admin` command remains available with the same three account variables or `-- --password-stdin`. Never place passwords in command arguments, README, source files or GitHub. No public bootstrap HTTP endpoint exists.

### VS Code और Admin: छोटा हिंदी गाइड

1. ZIP extract करें या repository clone करें। VS Code में वह folder खोलें जिसमें `frontend`, `backend` और `package.json` हैं।
2. Node.js 24 और Docker Desktop install करके Docker चालू करें। VS Code terminal में `node scripts/setup.mjs`, फिर `npm start` चलाएँ।
3. Local store `http://localhost:5173` पर और Admin `http://localhost:5173/admin/login` पर खुलेगा। ऊपर दिए demo accounts केवल local अभ्यास के लिए हैं।
4. Hosted site के पहले Admin के लिए ऊपर दिए Render Environment steps पूरे करें। किसी customer को अपने आप employee role नहीं मिलता।
5. **Categories → Add category**, फिर **Products → Add product** खोलें। नाम, INR price, pack size, सही stock और images डालकर Save करें। Stock 0 या inactive product customer खरीद नहीं सकता।
6. दूसरे browser/account से product देखें। Admin में stock बदलने और order बनने पर availability update होती है; checkout का database lock आखिरी stock को दो orders में बिकने से रोकता है।
7. Customer **Create account** से अपना account बनाए। Address में **Use current location** चुनें, permission दें, area/PIN जाँचें और room/flat/building भरें। Saved addresses उसी customer के account और authorized CRM view में मिलते हैं।
8. **Team & access** से Admin ही कर्मचारी बनाए। **Orders**, **Customers**, **CRM**, **Notifications** और **Website & settings** संबंधित काम के लिए हैं। In-app updates और provider email/SMS अलग हैं।
9. Changes GitHub की `main` branch में push करें। Connected Render और Netlify अपने deployments बनाएँगे। Secrets केवल hosting Environment में डालें। Video और अतिरिक्त guide files repository में शामिल नहीं हैं।
10. Free PostgreSQL की 30-दिन expiry से पहले data export करें। Free API सोने के बाद पहली request पर लगभग एक मिनट लग सकता है।

### Netlify settings

Import the same connected GitHub repository, select **production branch `main`**, enable continuous deployment and leave automatic publishing unlocked.

| Setting | Value |
| --- | --- |
| Base directory | `frontend` |
| Build command | `node ../scripts/netlify-build.mjs` |
| Publish directory | `dist`, relative to base |
| Build environment | `BACKEND_ORIGIN=https://YOUR-ACTUAL-BACKEND-HOST` |

`netlify.toml` sets Node 24 and overrides conflicting dashboard settings. `BACKEND_ORIGIN` is non-secret but required: only a valid HTTPS origin, without credentials/path/query, is accepted. The generator places `/api`, `/uploads` and `/socket.io` proxies before the SPA fallback. Add the exact Netlify/custom frontend origin to the backend allowlist. Use separate staging backends for previews. [Netlify deploy configuration](https://docs.netlify.com/deploy/deploy-overview/).

Netlify builds use same-origin Socket.IO **HTTP polling**, preserving cookies and CSRF. Its external proxy has a **26-second timeout**; the 10-second interval plus 10-second timeout profile fits below it. Safe GET/HEAD reads retry transient 502/503/504 and network failures up to four attempts while the API wakes; writes and uploads are never replayed automatically. Slow uploads or exhausted retries can still fail. Multiple APIs require polling-session affinity and shared media; Redis alone is insufficient. [Proxy limits](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/).

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

Integration tests use isolated Docker MySQL/Redis services and test databases. For PostgreSQL, set `DB_CLIENT=postgres`, an isolated `DATABASE_URL` whose database ends in `_test`, `REDIS_URL`/`TEST_REDIS_URL`, and run `node scripts/test-system.mjs --existing-services`. PostgreSQL media checks use `UPLOAD_STORAGE=database`. Keep ports 3310, 6381, 4100 and 4101 available. Never point destructive fixtures at business data. Browser checks require the running local demonstration store:

```powershell
npm ci
npx playwright install chromium
npm run test:browser
```

Browser tests create synthetic records. Test output distinguishes failures and skips; local checks do not prove hosted performance or external provider delivery. Back up the chosen SQL database and any filesystem uploads together, test restoration separately, monitor readiness/queue failures, and review pending-payment reservations manually.


### Local verification, 28 November 2026

The Free deployment changes were checked against real PostgreSQL 18.6 and Oracle MySQL 8.4.11. Each engine completed all 13 system-test phases with no skipped phases: catalogue/account/RBAC flows, simultaneous checkout and idempotency, saved addresses, private events, bounded load, image persistence across API restarts, Redis outage/recovery, shared rate limits, a separate worker and notification retry/recovery.

There were 55 passing backend unit checks, 5 additional real-PostgreSQL adapter/constraint/concurrency checks, 22 deployment/secret-guard/wake-request checks, and 9 production-mode bootstrap/import/startup checks. The backend unit command skips the 5 real-PostgreSQL cases unless their explicit integration-test environment is configured; those 5 were executed separately and passed. Each engine's system run also passed 93 named integration/frontend-logic checks. Syntax checks, frontend lint and production build passed.

The first-Admin checks used disposable local databases. Payment webhooks used signed fixtures; phone OTP used explicit simulation; Google linking policy used trusted service-layer fixtures. A local SMTP fixture tested 4 failed attempts followed by a successful manual fifth attempt without forwarding anything externally. These results do not claim real Google authorization, SMS receipt, payment collection, external email delivery, or that a hosting deployment is currently healthy.


## Google login, OTP, Razorpay and password recovery (free demo setup)

- **Google OAuth**: supported for customers, including account linking. Create a **Web application** OAuth client in Google Cloud, add `https://virar-organics.netlify.app` to Authorized JavaScript origins and set `GOOGLE_CLIENT_ID` only in Render environment variables. This is generally available without a fee at normal usage, but requires Google configuration. Staff sign in with their Admin-created credentials.
- **Phone OTP**: real SMS verification requires Twilio or another authorized SMS provider, which can incur per-message fees. The locally simulated code is not a real verification and is deliberately blocked in production. Production `PHONE_OTP_MODE=disabled` stays safe until a provider is configured.
- **Razorpay**: checkout is implemented for **Razorpay TEST mode**. Configure `PAYMENT_MODE=razorpay`, `RAZORPAY_KEY_ID` (starts `rzp_test_`), `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in Render, and add the webhook endpoint `/api/payments/webhook` in Razorpay. Never commit keys or collect live payment until provider onboarding and production validation. The Razorpay plugin can inspect payments; it does not furnish checkout API credentials. Live transactions can incur fees.
- **Forgot Password**: the login page now links to `/forgot-password`. After you configure a real email provider, an unknown-or-existing account gets the same response. Reset links expire after 15 minutes, are single-use, and revoke previous sessions. Configure `SMTP_HOST`, `SMTP_PORT` (typically `587`), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `PASSWORD_RESET_PUBLIC_ORIGIN=https://virar-organics.netlify.app` as **Render environment variables only**. The email provider may have a free quota, but SMTP delivery must be configured and tested before the feature works online. With no SMTP provider configured the page explicitly says email recovery is unavailable.
- You may use a reputable provider's free email quota where offered. No unlimited free SMS, unlimited free email, or zero-fee real card-processing is promised.
- **Important**: Render Free PostgreSQL expires after 30 days. Back up or migrate the database before expiry.


## Checkout, location and service-area notes

- Razorpay TEST checkout is hosted by Razorpay. UPI Intent/QR availability is determined by Razorpay and merchant activation, not by this website. A missing UPI tab cannot be enabled by rendering a fake button. Card/netbanking test transactions can be used where available. Real-money live payments are not enabled.
- Indian state and country fields are dropdowns. Serviced PIN codes are selectable; manual PIN entry remains available for other addresses, but server-side delivery-zone checks still apply. Admin controls allowed areas in **Settings > Delivery & maps**. A one-time v8 migration adds **Naigaon East (401208)** and enables maps without removing existing delivery zones or historical orders.
- Geolocation uses the browser's user-approved position and a same-origin backend reverse-geocode proxy, with direct-provider fallback. It never assumes a flat or room number, and if the lookup is unavailable the customer can enter the address manually. The free public maps and lookup services may have outages or usage limits.
