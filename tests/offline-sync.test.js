const test = require('node:test');
const assert = require('node:assert/strict');
const {
  seedData, ensureSchema, createSale, processReturn, receiveUdharPayment,
  addUdharEntry, updateCustomer, can
} = require('../server');

function fixture() {
  const db = seedData();
  ensureSchema(db);
  const admin = db.users[0];
  return { db, admin };
}

function creditCustomer(db, amount) {
  createSale(db, { customerId: 'cus_2', paymentType: 'Credit', items: [{ productId: 'prd_3', qty: 2 }] }, db.users[0]);
  const customer = db.customers.find(item => item.id === 'cus_2');
  customer.balance = amount;
  return customer;
}

test('the same queued payment clientId is only ever credited once', () => {
  const { db, admin } = fixture();
  const customer = creditCustomer(db, 2000);
  const clientId = 'offline_pay_1';
  const first = receiveUdharPayment(db, 'cus_2', 500, admin, { clientId, note: 'Offline payment' });
  assert.equal(first.duplicate, undefined);
  assert.equal(db.payments.filter(p => p.clientId === clientId).length, 1);
  // The queue is retried on every reconnect until it is acknowledged, so the same entry arrives again.
  const second = receiveUdharPayment(db, 'cus_2', 500, admin, { clientId, note: 'Offline payment' });
  const third = receiveUdharPayment(db, 'cus_2', 500, admin, { clientId, note: 'Offline payment' });
  assert.equal(second.duplicate, true);
  assert.equal(third.duplicate, true);
  assert.equal(db.payments.filter(p => p.clientId === clientId).length, 1);
  assert.equal(db.payments.filter(p => p.customerId === 'cus_2').length, 1);
  assert.equal(db.customers.find(item => item.id === 'cus_2').balance, 1500);
  assert.equal(customer.balance, 1500);
});

test('two genuinely separate offline payments of the same amount are both kept', () => {
  const { db, admin } = fixture();
  creditCustomer(db, 2000);
  receiveUdharPayment(db, 'cus_2', 500, admin, { clientId: 'offline_pay_a' });
  receiveUdharPayment(db, 'cus_2', 500, admin, { clientId: 'offline_pay_b' });
  assert.equal(db.payments.filter(p => p.customerId === 'cus_2').length, 2);
  assert.equal(db.customers.find(item => item.id === 'cus_2').balance, 1000);
});

test('a queued udhar entry adds to the balance once, however often it is replayed', () => {
  const { db, admin } = fixture();
  creditCustomer(db, 500);
  const first = addUdharEntry(db, 'cus_2', { amount: 250, note: 'Saman', clientId: 'offline_udh_1' }, admin);
  assert.equal(first.duplicate, undefined);
  const second = addUdharEntry(db, 'cus_2', { amount: 250, note: 'Saman', clientId: 'offline_udh_1' }, admin);
  assert.equal(second.duplicate, true);
  assert.equal(db.udharEntries.filter(e => e.clientId === 'offline_udh_1').length, 1);
  assert.equal(db.customers.find(item => item.id === 'cus_2').balance, 750);
});

test('a replayed return restocks the goods and moves the money back only once', () => {
  const { db, admin } = fixture();
  const sale = createSale(db, { customerId: 'cus_2', paymentType: 'Cash', items: [{ productId: 'prd_3', qty: 2 }] }, admin);
  const product = db.products.find(item => item.id === 'prd_3');
  const stockAfterSale = Number(product.stock);
  const clientId = 'offline_ret_1';
  const first = processReturn(db, { saleId: sale.id, complete: true, reason: 'Damaged', clientId }, admin);
  assert.equal(first.duplicate, undefined);
  const restocked = Number(db.products.find(item => item.id === 'prd_3').stock);
  assert.equal(restocked > stockAfterSale, true);
  const replay = processReturn(db, { saleId: sale.id, complete: true, reason: 'Damaged', clientId }, admin);
  assert.equal(replay.duplicate, true);
  assert.equal(db.returns.filter(r => r.clientId === clientId).length, 1);
  assert.equal(Number(db.products.find(item => item.id === 'prd_3').stock), restocked);
});

test('a replayed return is ignored even when the full bill is returned twice', () => {
  const { db, admin } = fixture();
  const sale = createSale(db, { customerId: 'cus_2', paymentType: 'Credit', items: [{ productId: 'prd_3', qty: 2 }] }, admin);
  const clientId = 'offline_ret_2';
  processReturn(db, { saleId: sale.id, complete: true, clientId }, admin);
  const afterFirst = Number(db.customers.find(item => item.id === 'cus_2').balance);
  processReturn(db, { saleId: sale.id, complete: true, clientId }, admin);
  assert.equal(Number(db.customers.find(item => item.id === 'cus_2').balance), afterFirst);
  assert.equal(db.returns.filter(r => r.clientId === clientId).length, 1);
});

test('a queued customer edit lands the same way however often it is replayed', () => {
  const { db, admin } = fixture();
  const payload = {
    name: 'Ali Bhatti',
    phone: '0300-1234567',
    products: [{ id: 'prd_3', name: 'stale', qty: 2, unit: 'kg', baseUnit: 'kg', price: 100 }],
    udhaarTotal: 3000,
    udhaarPaid: 1000
  };
  updateCustomer(db, 'cus_2', payload, admin);
  const afterFirst = Number(db.customers.find(item => item.id === 'cus_2').balance);
  assert.equal(afterFirst, 2000);
  updateCustomer(db, 'cus_2', payload, admin);
  updateCustomer(db, 'cus_2', payload, admin);
  const customer = db.customers.find(item => item.id === 'cus_2');
  assert.equal(Number(customer.balance), afterFirst);
  assert.equal(Number(customer.recordedTotal), 3000);
  assert.equal(Number(customer.recordedPaid), 1000);
  assert.equal(customer.products.length, 1);
  assert.equal(customer.products[0].name, db.products.find(item => item.id === 'prd_3').name);
});

test('adding a priced product to a customer edit raises the udhar total it saves', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_2');
  customer.recordedTotal = 1000;
  customer.recordedPaid = 0;
  customer.balance = 1000;
  // Rs 100/kg billed by the gram: a 500 g line is Rs 50, so the total must move by 50, not by 500.
  updateCustomer(db, 'cus_2', { udhaarTotal: 1050, udhaarPaid: 0 }, admin);
  const saved = db.customers.find(item => item.id === 'cus_2');
  assert.equal(Number(saved.recordedTotal), 1050);
  assert.equal(Number(saved.balance), 1050);
});

test('a cashier without udhar permission cannot replay udhar amounts through the queue', () => {
  const { db } = fixture();
  const cashier = db.users.find(user => /cashier/i.test(user.role));
  assert.equal(can(cashier, 'udhar'), false);
  assert.throws(() => updateCustomer(db, 'cus_2', { udhaarTotal: 5000 }, cashier), /Only Admin or Manager/);
  // A product added in the same edit is udhar too, so it has to be refused by the same rule.
  assert.throws(() => updateCustomer(db, 'cus_2', { products: [], productUdhar: { amount: 500 } }, cashier), /Only Admin or Manager/);
});

test('a priced product added on the customer form lands in the khata on the date it was picked', () => {
  const { db, admin } = fixture();
  const before = db.udharEntries.length;
  const result = updateCustomer(db, 'cus_2', {
    products: [{ id: 'prd_3', name: 'stale', qty: 2, unit: 'kg', baseUnit: 'kg', price: 100 }],
    productUdhar: { amount: 200, note: 'Atta - Rs 200', atDate: '2026-09-14', atTime: '18:30', clientId: 'prod_1' }
  }, admin);
  assert.equal(db.udharEntries.length, before + 1);
  const entry = result.productUdharEntry;
  assert.equal(entry.amount, 200);
  assert.equal(entry.note, 'Atta - Rs 200');
  // The date and time the cashier picked have to survive into the stored entry, not the moment it
  // happened to sync.
  const stored = new Date(entry.at);
  assert.equal(stored.getFullYear(), 2026);
  assert.equal(stored.getMonth(), 8);
  assert.equal(stored.getDate(), 14);
  assert.equal(stored.getHours(), 18);
  assert.equal(stored.getMinutes(), 30);
  assert.equal(Number(db.customers.find(item => item.id === 'cus_2').balance), 200);
});

test('a product udhar does not create a stored total, so later credit bills still count', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_2');
  assert.equal(customer.recordedTotal, undefined);
  updateCustomer(db, 'cus_2', { products: [], productUdhar: { amount: 200, clientId: 'prod_2' } }, admin);
  // A stored total would freeze the balance here and quietly drop this credit bill out of it.
  assert.equal(db.customers.find(item => item.id === 'cus_2').recordedTotal, undefined);
  createSale(db, { customerId: 'cus_2', paymentType: 'Credit', items: [{ productId: 'prd_3', qty: 1 }] }, admin);
  const sale = db.sales[db.sales.length - 1];
  assert.equal(Number(db.customers.find(item => item.id === 'cus_2').balance), 200 + Number(sale.total));
});

test('a replayed product udhar is recorded once, not twice', () => {
  const { db, admin } = fixture();
  const payload = {
    products: [{ id: 'prd_3', name: 'stale', qty: 2, unit: 'kg', baseUnit: 'kg', price: 100 }],
    productUdhar: { amount: 200, note: 'Atta', clientId: 'prod_replay' }
  };
  updateCustomer(db, 'cus_2', payload, admin);
  const afterFirst = Number(db.customers.find(item => item.id === 'cus_2').balance);
  updateCustomer(db, 'cus_2', payload, admin);
  updateCustomer(db, 'cus_2', payload, admin);
  assert.equal(db.udharEntries.filter(e => e.clientId === 'prod_replay').length, 1);
  assert.equal(Number(db.customers.find(item => item.id === 'cus_2').balance), afterFirst);
});

test('a product udhar on a customer with a stored total keeps the two balances in step', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_2');
  customer.recordedTotal = 1000;
  customer.recordedPaid = 0;
  customer.balance = 1000;
  updateCustomer(db, 'cus_2', { products: [], productUdhar: { amount: 250, clientId: 'prod_legacy' } }, admin);
  // This customer runs off the stored total, so it has to move as well or the khata would show the
  // entry but the balance would stay at the old number.
  assert.equal(Number(db.customers.find(item => item.id === 'cus_2').recordedTotal), 1250);
  assert.equal(Number(db.customers.find(item => item.id === 'cus_2').balance), 1250);
});

test('a product udhar refused on the credit limit leaves the rest of the edit unwritten', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_2');
  customer.name = 'Original Name';
  customer.creditLimit = 500;
  customer.balance = 400;
  assert.throws(() => updateCustomer(db, 'cus_2', {
    name: 'Renamed Despite Refusal',
    products: [{ id: 'prd_3', name: 'stale', qty: 1, unit: 'kg', baseUnit: 'kg', price: 100 }],
    productUdhar: { amount: 300, clientId: 'prod_over_limit' }
  }, admin), /Credit limit exceeded/);
  const saved = db.customers.find(item => item.id === 'cus_2');
  assert.equal(saved.name, 'Original Name');
  assert.equal(db.udharEntries.filter(e => e.clientId === 'prod_over_limit').length, 0);
  assert.equal(Number(saved.balance), 400);
});

test('a product udhar and a typed total in one save add up instead of overwriting each other', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_2');
  customer.recordedTotal = 1000;
  customer.recordedPaid = 0;
  customer.balance = 1000;
  updateCustomer(db, 'cus_2', {
    udhaarTotal: 1500,
    udhaarPaid: 0,
    productUdhar: { amount: 200, clientId: 'prod_stacked' }
  }, admin);
  const saved = db.customers.find(item => item.id === 'cus_2');
  assert.equal(Number(saved.recordedTotal), 1700);
  assert.equal(Number(saved.balance), 1700);
});

test('a walk-in customer cannot be given udhar through a product', () => {
  const { db, admin } = fixture();
  assert.throws(() => updateCustomer(db, 'cus_walkin', { products: [], productUdhar: { amount: 100 } }, admin), /Walk-in/);
});
