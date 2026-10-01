// Runs the real server over HTTP against a throwaway data directory and checks the one endpoint the
// offline queue relies on. The real database is never opened: POS_DATA_DIR points somewhere else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faislabadi-offline-'));
process.env.POS_DATA_DIR = dataDir;
process.env.POS_MODE = 'local-only';

const { seedData, hashPassword } = require('../server');

const ADMIN_PASS = 'offline-test-pass';
const db = seedData();
db.users[0].passwordHash = hashPassword(ADMIN_PASS);
db.users.push({ id: 'usr_cashier', name: 'Cashier', email: 'cashier@faislabadi.pk', phone: '03001112223', role: 'Cashier', active: true, passwordHash: hashPassword('cashier-test-pass') });
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'pos-data.json'), JSON.stringify(db, null, 2));

let server;
let base;

function api(token) {
  return async (method, urlPath, body) => {
    const response = await fetch(base + urlPath, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

test.before(async () => {
  const { createServer } = require('../server');
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Tokens are cached per user: the login endpoint rate limits by client, and these tests share one
// connection, so re-authenticating for every test would trip the limit rather than test anything.
const tokenCache = new Map();

async function loginAs(who) {
  if (tokenCache.has(who)) return tokenCache.get(who);
  const call = api(null);
  const email = who === 'cashier' ? 'cashier@faislabadi.pk' : 'sohaib@faislabadi.pk';
  const password = who === 'cashier' ? 'cashier-test-pass' : ADMIN_PASS;
  const res = await call('POST', '/api/auth/login', { login: email, password });
  assert.equal(res.status, 200, `login failed for ${who}: ${JSON.stringify(res.body)}`);
  tokenCache.set(who, res.body.token);
  return res.body.token;
}

// A customer of the test's own, so a billing test starts from a known balance and does not lean on
// whatever the earlier tests left behind on the seeded customers.
async function freshCustomer(token, name, udhar = 0) {
  const call = api(token);
  const created = await call('POST', '/api/customers', { name, creditLimit: 0 });
  assert.equal(created.status, 201, `customer create failed: ${JSON.stringify(created.body)}`);
  const id = created.body.id;
  if (udhar > 0) {
    const edit = await call('PUT', `/api/customers/${id}`, { udhaarTotal: udhar, udhaarPaid: 0 });
    assert.equal(edit.status, 200);
  }
  return id;
}

// Gives the customer a known udhar balance to work against.
async function giveCustomerUdhar(call, token, amount) {
  const create = await call('POST', '/api/sales', {
    customerId: 'cus_2',
    paymentType: 'Credit',
    items: [{ productId: 'prd_3', qty: 2 }]
  });
  assert.equal(create.status, 201, `sale failed: ${JSON.stringify(create.body)}`);
  const edit = await call('PUT', '/api/customers/cus_2', { udhaarTotal: amount, udhaarPaid: 0 });
  assert.equal(edit.status, 200);
  return create.body;
}

test('the queued payment is credited once even though the batch is sent again', async () => {
  const token = await loginAs('admin');
  const call = api(token);
  await giveCustomerUdhar(call, token, 2000);

  const body = { payments: [{ customerId: 'cus_2', amount: 500, note: 'Offline payment', clientId: 'offline_pay_http_1' }] };
  const first = await call('POST', '/api/sync', body);
  const second = await call('POST', '/api/sync', body);
  const third = await call('POST', '/api/sync', body);
  assert.equal(first.status, 200);
  assert.equal(first.body.results[0].status, 'created');
  assert.equal(second.body.results[0].status, 'duplicate');
  assert.equal(third.body.results[0].status, 'duplicate');

  const ledger = await call('GET', '/api/customers');
  const customer = ledger.body.find(item => item.id === 'cus_2');
  assert.equal(customer.balance, 1500);
  assert.equal(customer.totalPaid, 500);
});

test('a queued udhar entry is added once, and the balance matches', async () => {
  const token = await loginAs('admin');
  const call = api(token);
  await giveCustomerUdhar(call, token, 500);
  const body = { udharEntries: [{ customerId: 'cus_2', amount: 250, note: 'Saman', clientId: 'offline_udh_http_1' }] };
  await call('POST', '/api/sync', body);
  const again = await call('POST', '/api/sync', body);
  assert.equal(again.body.results[0].status, 'duplicate');
  const ledger = await call('GET', '/api/customers');
  const customer = ledger.body.find(item => item.id === 'cus_2');
  assert.equal(customer.balance, 750);
});

test('a replayed return restocks and refunds only once', async () => {
  const token = await loginAs('admin');
  const call = api(token);
  const sale = await call('POST', '/api/sales', { customerId: 'cus_2', paymentType: 'Cash', items: [{ productId: 'prd_3', qty: 1 }] });
  assert.equal(sale.status, 201);
  const stockBefore = Number((await call('GET', '/api/bootstrap')).body.products.find(p => p.id === 'prd_3').stock);
  const body = { returns: [{ saleId: sale.body.id, complete: true, reason: 'Damaged', clientId: 'offline_ret_http_1' }] };
  const first = await call('POST', '/api/sync', body);
  assert.equal(first.body.results[0].status, 'created');
  const stockAfter = Number((await call('GET', '/api/bootstrap')).body.products.find(p => p.id === 'prd_3').stock);
  const replay = await call('POST', '/api/sync', body);
  assert.equal(replay.body.results[0].status, 'duplicate');
  const stockAfterReplay = Number((await call('GET', '/api/bootstrap')).body.products.find(p => p.id === 'prd_3').stock);
  assert.equal(stockAfterReplay, stockAfter);
  assert.equal(stockAfter > stockBefore, true);
});

test('a queued customer edit saves the new udhar total', async () => {
  const token = await loginAs('admin');
  const call = api(token);
  const body = {
    customers: [{
      customerId: 'cus_2',
      name: 'Ali Bhatti',
      phone: '0300-1234567',
      udhaarTotal: 3000,
      udhaarPaid: 1000,
      products: [{ id: 'prd_3', name: 'stale', qty: 2, unit: 'kg', baseUnit: 'kg', price: 100 }]
    }]
  };
  const first = await call('POST', '/api/sync', body);
  assert.equal(first.body.results[0].status, 'created');
  await call('POST', '/api/sync', body);
  const customer = (await call('GET', '/api/customers')).body.find(item => item.id === 'cus_2');
  assert.equal(customer.name, 'Ali Bhatti');
  assert.equal(customer.balance, 2000);
  assert.equal(customer.products.length, 1);
  assert.equal(customer.products[0].name, db.products.find(p => p.id === 'prd_3').name);
});

test('one refused entry is reported on its own and the rest of the batch still goes through', async () => {
  const token = await loginAs('admin');
  const call = api(token);
  await giveCustomerUdhar(call, token, 1000);
  const res = await call('POST', '/api/sync', {
    payments: [
      { customerId: 'cus_2', amount: 9_999_999, note: 'Too much', clientId: 'offline_bad_1' },
      { customerId: 'cus_2', amount: 100, note: 'Fine', clientId: 'offline_good_1' }
    ]
  });
  assert.equal(res.status, 200);
  const byId = new Map(res.body.results.map(row => [row.clientId, row]));
  assert.equal(byId.get('offline_bad_1').status, 'failed');
  assert.match(byId.get('offline_bad_1').error, /more than the udhar balance/);
  assert.equal(byId.get('offline_good_1').status, 'created');
  const customer = (await call('GET', '/api/customers')).body.find(item => item.id === 'cus_2');
  assert.equal(customer.balance, 900);
});

// The Complete Bill path: one click must produce one invoice, one payment, one khata entry and a
// balance the khata agrees with. These go through the real HTTP endpoint the cashier's button hits.
test('completing a bill returns the saved invoice and the customer row already recalculated', async () => {
  const token = await loginAs('admin');
  const call = api(token);
  // The exact shop scenario: a customer already carrying 10,000 of udhar, then a 5,000 bill of which
// 2,000 is paid. The starting balance is built with a real credit bill so the customer runs off its
// summed ledger - the same way a normal counter customer does - rather than a typed-in total.
const customerId = await freshCustomer(token, 'Khata Speed Test');
  const opening = await call('POST', '/api/sales', {
    clientId: 'opening_balance_1',
    customerId,
    paymentType: 'Credit',
    taxRate: 0,
    items: [{ productId: 'prd_3', qty: 4, price: 2500 }]
  });
  assert.equal(opening.status, 201);
  const before = (await call('GET', '/api/bootstrap')).body.customers.find(item => item.id === customerId);
  assert.equal(before.balance, 10000, 'the customer starts at 10,000 udhar');

  const res = await call('POST', '/api/sales', {
    clientId: 'khata_speed_1',
    customerId,
    paymentType: 'Partial',
    paidAmount: 2000,
    taxRate: 0,
    items: [{ productId: 'prd_3', qty: 2, price: 2500 }]
  });
  assert.equal(res.status, 201);
  const sale = res.body;
  // The invoice comes back saved, not as a request echo.
  assert.ok(sale.id, 'the saved invoice id is returned');
  assert.match(sale.invoiceNo, /^FS-\d+$/);
  assert.equal(sale.customerId, customerId, 'the customer stays attached to the saved invoice');
  assert.equal(sale.total, 5000);
  assert.equal(sale.paidAmount, 2000);
  assert.equal(sale.dueAmount, 3000);

  // 10,000 previous + 3,000 new udhar = 13,000. Previous balance is untouched.
  assert.equal(sale.customer.balance, 13000);
  assert.equal(sale.customer.creditPurchases, 15000);
  assert.equal(sale.customer.totalPaid, 2000);

  // The same numbers, read back from the khata itself - no reload in between.
  const ledger = await call('GET', `/api/customers/${customerId}/ledger`);
  const entry = ledger.body.entries.find(row => row.id === sale.id);
  assert.ok(entry, 'the new bill is in the khata straight away');
  assert.equal(entry.type, 'sale');
  assert.equal(entry.amount, 5000);
  assert.equal(entry.paidAtBilling, 2000);
  assert.equal(ledger.body.balanceAfter[sale.id], 13000);
  assert.equal(before.balance, 10000, 'the previous balance was left alone');
});

test('a second Complete Bill with the same clientId does not bill the customer twice', async () => {
  const token = await loginAs('admin');
  const call = api(token);
  const customerId = await freshCustomer(token, 'Double Tap Test');
  const payload = {
    clientId: 'double_tap_guard_1',
    customerId,
    paymentType: 'Credit',
    taxRate: 0,
    items: [{ productId: 'prd_3', qty: 1, price: 1000 }]
  };
  const first = await call('POST', '/api/sales', payload);
  assert.equal(first.status, 201);
  const second = await call('POST', '/api/sales', payload);
  const third = await call('POST', '/api/sales', payload);

  // The retry is recognised and answered with the bill that already exists.
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.invoiceNo, first.body.invoiceNo);
  assert.equal(third.body.id, first.body.id);

  const after = (await call('GET', '/api/bootstrap')).body;
  const matching = after.sales.filter(row => row.id === first.body.id);
  assert.equal(matching.length, 1, 'exactly one invoice was created');
  const ledger = await call('GET', `/api/customers/${customerId}/ledger`);
  const entries = ledger.body.entries.filter(row => row.id === first.body.id);
  assert.equal(entries.length, 1, 'exactly one khata entry was created');
  assert.equal(ledger.body.balanceAfter[first.body.id], Number(after.customers.find(c => c.id === customerId).balance));
});

test('a payment on the bill and the udhar entry are both recorded in one save', async () => {
  const token = await loginAs('admin');
  const call = api(token);
  const customerId = await freshCustomer(token, 'Part Payment Test');
  const res = await call('POST', '/api/sales', {
    clientId: 'partial_split_1',
    customerId,
    paymentType: 'Partial',
    paidAmount: 750,
    taxRate: 0,
    items: [{ productId: 'prd_3', qty: 1, price: 1000 }]
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.total, 1000);
  assert.equal(res.body.dueAmount, 250);
  const after = (await call('GET', '/api/bootstrap')).body;
  const saved = after.sales.find(row => row.id === res.body.id);
  assert.ok(saved, 'the invoice is on the sale list');
  const ledger = await call('GET', `/api/customers/${customerId}/ledger`);
  const paid = ledger.body.entries.filter(row => row.type === 'payment' && row.note.includes(saved.invoiceNo));
  assert.equal(paid.length, 1, 'the part payment was recorded against this invoice');
  assert.equal(paid[0].amount, 750);
  const customer = after.customers.find(item => item.id === customerId);
  assert.equal(ledger.body.balanceAfter[res.body.id], customer.balance);
});

test('health and sync-status answer without waiting on the store database', async () => {
  const call = api(null);
  const started = Date.now();
  const health = await call('GET', '/api/health');
  const status = await call('GET', '/api/sync-status');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(status.status, 200);
  // Both used to read the whole database and queue behind the same lock a sale takes.
  assert.equal(Date.now() - started < 1500, true, 'status checks return without a full database read');
});

test('a cashier cannot replay udhar amounts through the sync endpoint', async () => {
  const token = await loginAs('cashier');
  const call = api(token);
  // Udhar money is refused outright for the whole batch.
  const money = await call('POST', '/api/sync', {
    payments: [{ customerId: 'cus_2', amount: 50, clientId: 'offline_cashier_1' }]
  });
  assert.equal(money.status, 403);
  const udharEntries = await call('POST', '/api/sync', {
    udharEntries: [{ customerId: 'cus_2', amount: 50, clientId: 'offline_cashier_2' }]
  });
  assert.equal(udharEntries.status, 403);
  // A cashier may edit a customer's details, but the udhar amounts inside that edit are refused on
  // their own, so one blocked field cannot quietly move a balance.
  const edit = await call('POST', '/api/sync', {
    customers: [{ customerId: 'cus_2', name: 'Renamed By Cashier', udhaarTotal: 99_999 }]
  });
  assert.equal(edit.status, 200);
  const row = edit.body.results[0];
  assert.equal(row.status, 'failed');
  assert.match(row.error, /Only Admin or Manager/);
  const customer = (await call('GET', '/api/customers')).body.find(item => item.id === 'cus_2');
  assert.notEqual(customer.name, 'Renamed By Cashier');
});
