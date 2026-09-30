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

async function loginAs(who) {
  const call = api(null);
  const email = who === 'cashier' ? 'cashier@faislabadi.pk' : 'sohaib@faislabadi.pk';
  const password = who === 'cashier' ? 'cashier-test-pass' : ADMIN_PASS;
  const res = await call('POST', '/api/auth/login', { login: email, password });
  assert.equal(res.status, 200, `login failed for ${who}: ${JSON.stringify(res.body)}`);
  return res.body.token;
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
