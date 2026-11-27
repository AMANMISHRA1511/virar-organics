/** Local-browser reproduction of the 2.1 upgrade scenarios.
 * Creates synthetic fixtures in a local demonstration database. Every external
 * request is blocked; geolocation and reverse-geocoding responses are mocks.
 * Managed authoring environments must use their supported preview browser.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use an isolated local demonstration store.');
if (process.env.SITES_MANAGED_LINUX_CONTAINER) throw new Error('Use the managed preview browser here. This Playwright script is for your own local development machine.');
const out = path.join(root, 'tests/results/upgrade-browser'); await fs.mkdir(out, { recursive: true });
const run = Date.now().toString(36), password = 'UpgradeBrowser123!';
const report = { startedAt: new Date().toISOString(), base, steps: [], pageErrors: [], locationMocked: true, externalRequestsAllowed: false, independentCustomerContexts: 2 };
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
report.browserVersion = browser.version();
const contexts = {}, pages = {}; let active, product, addressId, winningOrder, winningContext;
const lookupCount = { first: 0, second: 0, guest: 0, admin: 0 };
const provider = { locality: 'Synthetic Location Area', city: 'Virar', principalSubdivision: 'Maharashtra', postcode: '401303', countryCode: 'IN', countryName: 'India' };
async function poll(fn, message, timeout = 12000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(message); }
async function api(context, pathname, { method = 'GET', body, expect = [200, 201] } = {}) {
  const headers = {};
  if (method !== 'GET') { const token = await context.request.get(base + '/api/csrf'); headers['X-CSRF-Token'] = (await token.json()).csrfToken; }
  const response = await context.request.fetch(base + '/api' + pathname, { method, headers, data: body });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  if (expect) assert.ok(expect.includes(response.status()), `${method} ${pathname}: ${response.status()} ${text}`);
  return { status: response.status(), body: data };
}
async function pageFor(context) { const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => report.pageErrors.push(error.message)); return page; }
async function open(page, pathname) { active = page; await page.goto(base + pathname, { waitUntil: 'domcontentloaded' }); }
async function step(name, fn) {
  const start = Date.now();
  try { await fn(); report.steps.push({ name, status: 'passed', ms: Date.now() - start }); console.log('PASS ' + name); }
  catch (error) { report.steps.push({ name, status: 'failed', error: error.message, ms: Date.now() - start }); await active?.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2)); }
}
async function fillAddress(page, { label = 'Manual fixture', city = 'Virar' } = {}) {
  if (await page.getByLabel('Address label', { exact: true }).count()) await page.getByLabel('Address label', { exact: true }).fill(label);
  for (const [field, value] of [['Full name', 'Synthetic Browser Customer'], ['Mobile number', '+919000001234'], ['Flat / room number', 'A-17'], ['Building / street', 'Synthetic Browser Building'], ['Landmark (optional)', 'Synthetic landmark'], ['Area / locality', 'Synthetic manual area'], ['City', city], ['State', 'Maharashtra'], ['PIN code', '401303']]) {
    await page.getByLabel(field, { exact: true }).fill(value);
  }
}
async function createAddressModal(page) { await open(page, '/account/addresses'); await page.getByRole('button', { name: 'Add address', exact: true }).click(); await page.getByRole('heading', { name: 'Add delivery address', exact: true }).waitFor(); }
try {
  for (const name of ['guest', 'first', 'second', 'admin']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts[name] = context;
    // Deny external hosts before creating pages. The only matching provider
    // route below fulfills locally and never forwards a fixture coordinate.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort('blockedbyclient'));
    await context.route('https://api.bigdatacloud.net/data/reverse-geocode-client*', async route => { lookupCount[name]++; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(provider) }); });
    await context.addInitScript(() => {
      window.__qaLocationMode = 'allowed';
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success, error) {
        if (window.__qaLocationMode === 'denied') error({ code: 1, message: 'Synthetic permission denial' });
        else if (window.__qaLocationMode === 'unavailable') error({ code: 2, message: 'Synthetic unavailable device location' });
        else success({ coords: { latitude: 19.4559, longitude: 72.8114, accuracy: 20 } });
      } } });
    });
    pages[name] = await pageFor(context);
  }
  const cfg = (await api(contexts.guest, '/config')).body;
  assert.equal(cfg.payment.mode, 'mock'); assert.equal(cfg.notifications.mode, 'simulated');
  await api(contexts.admin, '/login', { method: 'POST', body: { email: process.env.ADMIN_EMAIL || 'admin@mitti.test', password: process.env.ADMIN_PASSWORD || 'DemoOnly123!' } });
  product = (await api(contexts.admin, '/admin/products', { method: 'POST', body: { name: `Upgrade Browser Ten Units ${run}`, description: 'Synthetic isolated inventory race fixture.', price: 150, sale_price: null, unit: 'one pack', stock: 10, category_id: null, images: [], active: true, featured: true } })).body;

  await step('Guest browsing is allowed but basket, enquiry and address saves require an account', async () => {
    await open(pages.guest, '/products/' + product.id); await pages.guest.getByRole('button', { name: /Add to basket/ }).click();
    await pages.guest.getByRole('heading', { name: 'Sign in to start your basket', exact: true }).waitFor();
    assert.deepEqual(await pages.guest.evaluate(() => Object.keys(localStorage).filter(key => /^mm-(cart|checkout|address)/.test(key))), []);
    await open(pages.guest, '/cart'); await pages.guest.getByRole('heading', { name: 'Your basket belongs to your account', exact: true }).waitFor();
    await open(pages.guest, '/bulk'); assert.equal(await pages.guest.getByRole('button', { name: 'Send enquiry', exact: true }).count(), 0);
    await open(pages.guest, '/account/addresses'); await pages.guest.waitForURL(/\/login(?:\?|$)/);
    assert.equal(lookupCount.guest, 0);
  });

  await step('An unknown password sign-in is rejected and does not authenticate', async () => {
    await open(pages.guest, '/login'); await pages.guest.getByLabel('Email address', { exact: true }).fill(`unknown-upgrade-${run}@example.test`);
    await pages.guest.getByLabel(/^Password/).fill(password); await pages.guest.getByRole('button', { name: 'Sign in', exact: true }).click();
    await pages.guest.getByText(/Email or password is incorrect/).waitFor();
    assert.equal((await api(contexts.guest, '/me', { expect: null })).status, 401);
  });

  await step('Two independent browser sessions register distinct customers', async () => {
    for (const name of ['first', 'second']) {
      await api(contexts[name], '/register', { method: 'POST', body: { name: `Upgrade browser ${name}`, email: `upgrade-${name}-${run}@example.test`, password, phone: '+919000001234' } });
      await open(pages[name], '/account'); await pages[name].getByRole('heading', { name: 'Profile details', exact: true }).waitFor();
    }
    assert.notEqual((await api(contexts.first, '/me')).body.id, (await api(contexts.second, '/me')).body.id);
  });

  await step('Explicit mocked geolocation fills suggestions while preserving manual flat/building/city', async () => {
    await createAddressModal(pages.first); assert.equal(lookupCount.first, 0);
    await pages.first.getByLabel('Address label', { exact: true }).fill('Location fixture ' + run);
    await pages.first.getByLabel('Flat / room number', { exact: true }).fill('B-29');
    await pages.first.getByLabel('Building / street', { exact: true }).fill('Manually entered building');
    await pages.first.getByLabel('City', { exact: true }).fill('Manually reviewed city');
    await pages.first.getByRole('button', { name: 'Use my current location', exact: true }).click();
    await pages.first.getByText(/Location found.*accuracy/).waitFor(); assert.equal(lookupCount.first, 1);
    assert.equal(await pages.first.getByLabel('Area / locality', { exact: true }).inputValue(), provider.locality);
    assert.equal(await pages.first.getByLabel('PIN code', { exact: true }).inputValue(), '401303');
    assert.equal(await pages.first.getByLabel('Flat / room number', { exact: true }).inputValue(), 'B-29');
    assert.equal(await pages.first.getByLabel('Building / street', { exact: true }).inputValue(), 'Manually entered building');
    assert.equal(await pages.first.getByLabel('City', { exact: true }).inputValue(), 'Manually reviewed city');
    await pages.first.getByRole('button', { name: 'Save address', exact: true }).click();
    await poll(async () => !(await pages.first.getByRole('dialog').count()), 'Address dialog did not close');
    const saved = (await api(contexts.first, '/account/addresses')).body.items.find(a => a.label === 'Location fixture ' + run);
    assert.ok(saved); addressId = saved.id; assert.equal(saved.flat, 'B-29'); assert.equal(saved.lat, null); assert.equal(saved.lng, null); assert.equal(saved.accuracy, null);
    await pages.first.screenshot({ path: path.join(out, '01-saved-address.png'), fullPage: true });
  });

  await step('Denied geolocation makes no lookup and leaves a complete manual address path', async () => {
    await createAddressModal(pages.first); await pages.first.evaluate(() => { window.__qaLocationMode = 'denied'; });
    const before = lookupCount.first; await pages.first.getByRole('button', { name: 'Use my current location', exact: true }).click();
    await pages.first.getByText(/Location permission was denied/).waitFor(); assert.equal(lookupCount.first, before);
    await fillAddress(pages.first, { label: 'Denied-location manual fixture ' + run });
    await pages.first.getByRole('button', { name: 'Save address', exact: true }).click();
    await poll(async () => !(await pages.first.getByRole('dialog').count()), 'Manual address did not save');
    const saved = (await api(contexts.first, '/account/addresses')).body.items.find(a => a.label === 'Denied-location manual fixture ' + run);
    assert.ok(saved); assert.equal(saved.lat, null); assert.equal(saved.lng, null);
  });

  await step('Unavailable geolocation and missing browser support remain manually editable', async () => {
    await createAddressModal(pages.first); await pages.first.evaluate(() => { window.__qaLocationMode = 'unavailable'; });
    const before = lookupCount.first; await pages.first.getByRole('button', { name: 'Use my current location', exact: true }).click();
    await pages.first.getByText(/current location could not be determined/).waitFor();
    await pages.first.evaluate(() => { Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined }); });
    await pages.first.getByRole('button', { name: 'Use my current location', exact: true }).click();
    await pages.first.getByText(/browser cannot share a location/).waitFor(); assert.equal(lookupCount.first, before);
    await pages.first.getByLabel('Building / street', { exact: true }).fill('Manual fallback building');
    assert.equal(await pages.first.getByLabel('Building / street', { exact: true }).inputValue(), 'Manual fallback building');
    await pages.first.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  await step('Profile and saved address round-trip into the Admin customer directory only', async () => {
    const user = (await api(contexts.first, '/me')).body;
    await api(contexts.first, '/account', { method: 'PATCH', body: { name: `Upgrade Profile ${run}`, phone: '+919000009876' } });
    await open(pages.admin, '/admin/customers/' + user.id);
    await pages.admin.getByText(`Upgrade Profile ${run}`, { exact: true }).first().waitFor();
    await pages.admin.getByText(/Manually entered building/).first().waitFor();
    const detail = (await api(contexts.admin, '/admin/customers/' + user.id)).body;
    assert.ok(detail.addresses.some(a => a.id === addressId && a.flat === 'B-29'));
    assert.equal((await api(contexts.second, '/admin/customers/' + user.id, { expect: null })).status, 403);
    assert.equal((await api(contexts.second, '/account/addresses/' + addressId, { method: 'PATCH', body: { flat: 'Foreign edit' }, expect: null })).status, 404);
    await pages.admin.screenshot({ path: path.join(out, '02-admin-customer.png'), fullPage: true });
  });

  const detailView = await pageFor(contexts.first), shopView = await pageFor(contexts.first), cartView = await pageFor(contexts.first), checkoutView = await pageFor(contexts.first);
  await step('Both browser customers can initially see all ten units and a valid saved basket', async () => {
    for (const name of ['first', 'second']) await api(contexts[name], '/cart', { method: 'PUT', body: { items: [{ id: product.id, quantity: 10 }] } });
    await open(detailView, '/products/' + product.id); await detailView.getByRole('heading', { name: product.name, exact: true }).waitFor();
    await open(shopView, '/shop?q=' + encodeURIComponent(product.name)); await shopView.locator('.product-card').waitFor();
    await open(cartView, '/cart'); await cartView.getByRole('heading', { name: product.name, exact: true }).waitFor();
    await open(checkoutView, '/checkout'); await checkoutView.getByLabel('Full name', { exact: true }).waitFor();
    await open(pages.second, '/products/' + product.id); await pages.second.getByRole('heading', { name: product.name, exact: true }).waitFor();
  });

  await step('Two independent browser sessions request ten units simultaneously; exactly one wins', async () => {
    const manual = { name: 'Synthetic race customer', phone: '+919000001234', line1: 'Synthetic race address', city: 'Virar', pincode: '401303' };
    const results = await Promise.all(['first', 'second'].map(name => api(contexts[name], '/orders', { method: 'POST', body: { items: [{ id: product.id, quantity: 10 }], address: manual, payment_method: 'cod', idempotency_key: crypto.randomUUID() }, expect: null })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const winner = results.findIndex(r => r.status === 201); winningOrder = results[winner].body; winningContext = contexts[['first', 'second'][winner]];
    await poll(async () => await detailView.getByRole('button', { name: /Add to basket|Out of stock/ }).isDisabled(), 'Product detail did not disable after stock depletion');
    await poll(async () => await shopView.locator('.product-card button').last().isDisabled(), 'Shop card did not disable after stock depletion');
    await poll(async () => /Out of stock/.test(await cartView.locator('main').innerText()), 'Basket missed live stock change');
    await poll(async () => await checkoutView.getByRole('button', { name: 'Place order', exact: true }).isDisabled(), 'Checkout remained enabled after stock depletion');
    assert.equal((await api(contexts.first, '/products/' + product.id)).body.stock, 0);
    await cartView.screenshot({ path: path.join(out, '03-live-stock.png'), fullPage: true });
  });

  await step('Cancellation restores availability live and repeated cancellation does not add stock', async () => {
    await Promise.all(Array.from({ length: 4 }, () => api(winningContext, '/orders/' + winningOrder.id + '/cancel', { method: 'POST', body: {} })));
    assert.equal((await api(contexts.first, '/products/' + product.id)).body.stock, 10);
    await poll(async () => !/Out of stock/.test(await cartView.locator('main').innerText()), 'Basket missed live restock');
    await poll(async () => !(await checkoutView.getByRole('button', { name: 'Place order', exact: true }).isDisabled()), 'Checkout did not recover after restock');
  });

  await step('Admin unavailability reaches product, catalogue, basket and checkout without reload', async () => {
    const current = (await api(contexts.admin, '/admin/products/' + product.id)).body;
    await api(contexts.admin, '/admin/products/' + product.id, { method: 'PUT', body: { ...current, expected_stock: current.stock, active: false } });
    await poll(async () => await shopView.locator('.product-card').count() === 0, 'Shop retained an unavailable product');
    await poll(async () => await detailView.getByRole('button', { name: /Add to basket/ }).count() === 0, 'Product detail retained an enabled purchase action');
    await poll(async () => /currently unavailable/.test(await cartView.locator('main').innerText()), 'Basket missed unavailability');
    await poll(async () => await checkoutView.getByRole('button', { name: 'Place order', exact: true }).isDisabled(), 'Checkout remained enabled for unavailable inventory');
  });

  await step('Private notification feeds exclude the other customer’s order', async () => {
    const ownerName = winningContext === contexts.first ? 'first' : 'second', otherName = ownerName === 'first' ? 'second' : 'first';
    const own = (await api(contexts[ownerName], '/account/notifications?limit=100')).body.items;
    const other = (await api(contexts[otherName], '/account/notifications?limit=100')).body.items;
    assert.ok(own.some(n => n.order_id === winningOrder.id)); assert.equal(other.some(n => n.order_id === winningOrder.id), false);
    assert.equal((await api(contexts.guest, '/account/notifications', { expect: null })).status, 401);
    assert.deepEqual(report.pageErrors, []);
  });
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); report.passed = report.steps.filter(s => s.status === 'passed').length; report.failed = report.steps.filter(s => s.status === 'failed').length; report.lookupMocksUsed = lookupCount; await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify({ status: report.status, passed: report.passed, failed: report.failed, result: 'tests/results/upgrade-browser/results.json' })); }
