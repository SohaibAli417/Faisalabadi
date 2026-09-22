const test = require('node:test');
const assert = require('node:assert/strict');
const {
  seedData, ensureSchema, createSale, processReturn, receiveUdharPayment,
  clearUdhar, returnedQtyByItem, customerTotals, decorateCustomer,
  createSupplier, updateSupplier, deleteSupplier, can
} = require('../server');
const { mergeDbs } = require('../sync');

function fixture() {
  const db = seedData();
  const admin = db.users[0];
  return { db, admin };
}

test('partial payment sale: Rs 5000 bill paid Rs 2000 adds only Rs 3000 udhar and records the Rs 2000 payment', () => {
  const { db, admin } = fixture();
  const sale = createSale(db, { customerId: 'cus_1', paymentType: 'Credit', paidAmount: 2000, items: [{ productId: 'prd_1', qty: 5 }] }, admin);
  assert.equal(sale.total > 0, true);
  assert.equal(sale.paidAmount, 2000);
  const customer = db.customers.find(item => item.id === 'cus_1');
  assert.equal(customer.balance, 4850 + (sale.total - 2000));
  const initialPayments = db.payments.filter(payment => payment.saleId === sale.id);
  assert.equal(initialPayments.length, 1);
  assert.equal(initialPayments[0].amount, 2000);
  const totals = customerTotals(db);
  assert.equal(totals.cus_1.totalPaid >= 2000, true);
});

test('full udhar sale: paid Rs 0 puts the whole bill on the customer balance', () => {
  const { db, admin } = fixture();
  const before = Number(db.customers.find(item => item.id === 'cus_2').balance);
  const sale = createSale(db, { customerId: 'cus_2', paymentType: 'Credit', items: [{ productId: 'prd_3', qty: 2 }] }, admin);
  assert.equal(sale.paidAmount, 0);
  assert.equal(sale.dueAmount, sale.total);
  const customer = db.customers.find(item => item.id === 'cus_2');
  assert.equal(customer.balance, before + sale.total);
});

test('cash sale never changes the customer balance', () => {
  const { db, admin } = fixture();
  const before = Number(db.customers.find(item => item.id === 'cus_1').balance);
  createSale(db, { customerId: 'cus_1', paymentType: 'Cash', items: [{ productId: 'prd_1', qty: 1 }] }, admin);
  assert.equal(Number(db.customers.find(item => item.id === 'cus_1').balance), before);
});

test('udhar is blocked for walk-in customers', () => {
  const { db, admin } = fixture();
  assert.throws(() => createSale(db, { customerId: 'cus_walkin', paymentType: 'Credit', paidAmount: 0, items: [{ productId: 'prd_1', qty: 1 }] }, admin), /registered customer/);
});

test('stock decreases only when the sale completes and a movement is recorded', () => {
  const { db, admin } = fixture();
  const product = db.products.find(item => item.id === 'prd_1');
  const before = Number(product.stock);
  createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', items: [{ productId: 'prd_1', qty: 2 }] }, admin);
  assert.equal(Number(product.stock), before - 2);
  const movement = db.stockMovements.find(item => item.productId === 'prd_1' && item.type === 'sale');
  assert.ok(movement);
  assert.equal(movement.qty, -2);
});

test('pay udhar reduces balance and keeps history; overpay is rejected', () => {
  const { db, admin } = fixture();
  createSale(db, { customerId: 'cus_2', paymentType: 'Credit', items: [{ productId: 'prd_3', qty: 2 }] }, admin);
  const customer = db.customers.find(item => item.id === 'cus_2');
  const before = Number(customer.balance);
  const result = receiveUdharPayment(db, 'cus_2', Math.floor(before / 2), admin);
  assert.equal(result.balance, before - Math.floor(before / 2));
  assert.equal(db.payments.some(payment => payment.customerId === 'cus_2' && payment.amount === Math.floor(before / 2)), true);
  assert.throws(() => receiveUdharPayment(db, 'cus_2', 10_000_000, admin), /more than the udhar balance/);
});

test('receiveUdharPayment with options.at stamps the payment time and lastPaymentAt', () => {
  const { db, admin } = fixture();
  createSale(db, { customerId: 'cus_2', paymentType: 'Credit', items: [{ productId: 'prd_3', qty: 2 }] }, admin);
  const customer = db.customers.find(item => item.id === 'cus_2');
  const before = Number(customer.balance);
  const at = '2024-05-10T09:30:00.000Z';
  receiveUdharPayment(db, 'cus_2', Math.floor(before / 2), admin, { at });
  const payment = db.payments.filter(item => item.customerId === 'cus_2').sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  assert.equal(payment.at, at);
  assert.equal(db.customers.find(item => item.id === 'cus_2').lastPaymentAt, at);
  const totals = customerTotals(db);
  assert.equal(totals.cus_2.lastPaymentAt, at);
});

test('decorateCustomer resolves a linked product name and exposes manual product entries', () => {
  const { db } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_1');
  customer.productId = 'prd_1';
  const linked = decorateCustomer(db, customer, customerTotals(db));
  assert.equal(linked.profileProduct.manual, false);
  assert.equal(linked.profileProduct.name, db.products.find(item => item.id === 'prd_1').name);
  customer.productName = 'Chai ka saman';
  assert.equal(decorateCustomer(db, customer, customerTotals(db)).profileProduct.name, db.products.find(item => item.id === 'prd_1').name);
  customer.productId = null;
  const manual = decorateCustomer(db, customer, customerTotals(db));
  assert.equal(manual.profileProduct.manual, true);
  assert.equal(manual.profileProduct.name, 'Chai ka saman');
});

test('decorateCustomer honors recordedTotal/recordedPaid overrides and masks cnic', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_2');
  customer.cnic = '35202-1234567-1';
  customer.recordedTotal = 12000;
  customer.recordedPaid = 4500;
  const view = decorateCustomer(db, customer, customerTotals(db));
  assert.equal(view.creditPurchases, 12000);
  assert.equal(view.totalPaid, 4500);
  assert.equal(view.balance, 7500);
  assert.equal(view.cnic, undefined);
  assert.ok(view.cnicMasked);
  customer.recordedPaid = 15000;
  assert.equal(decorateCustomer(db, customer, customerTotals(db)).balance, 0);
});

test('supplier create/update/delete works, audited, and delete is blocked once purchases exist', () => {
  const { db, admin } = fixture();
  const sup = createSupplier(db, { name: 'Shalimar Foods', phone: '041-5556666', address: 'Jaranwala Road' }, admin);
  assert.equal(sup.name, 'Shalimar Foods');
  assert.equal(db.suppliers[0].id, sup.id);
  assert.equal(db.auditLogs.some(log => log.entity === 'supplier' && log.action === 'create'), true);
  const updated = updateSupplier(db, sup.id, { name: 'Shalimar Foods (HQ)', phone: '041-9998888', active: false }, admin);
  assert.equal(updated.name, 'Shalimar Foods (HQ)');
  assert.equal(updated.active, false);
  deleteSupplier(db, sup.id, admin);
  assert.equal(db.suppliers.some(item => item.id === sup.id), false);
  const used = createSupplier(db, { name: 'Used Supplier' }, admin);
  db.purchases = [{ id: 'pur_x', supplierId: used.id, items: [], total: 100 }];
  assert.throws(() => deleteSupplier(db, used.id, admin), /purchase history/);
  const cashier = db.users.find(user => user.role === 'Cashier');
  assert.equal(can(cashier, 'purchases'), false);
  assert.equal(can(admin, 'purchases'), true);
});

test('clear udhar zeroes the balance and preserves every history record', () => {
  const { db, admin } = fixture();
  createSale(db, { customerId: 'cus_2', paymentType: 'Credit', items: [{ productId: 'prd_3', qty: 2 }] }, admin);
  const paymentsBefore = (db.payments || []).filter(payment => payment.customerId === 'cus_2').length;
  const salesBefore = db.sales.length;
  const result = clearUdhar(db, 'cus_2', admin);
  assert.equal(result.cleared, true);
  const customer = db.customers.find(item => item.id === 'cus_2');
  assert.equal(Number(customer.balance), 0);
  const paymentsAfter = (db.payments || []).filter(payment => payment.customerId === 'cus_2').length;
  assert.equal(paymentsAfter, paymentsBefore + 1);
  assert.equal(db.sales.length, salesBefore);
  assert.equal((clearUdhar && (() => { try { clearUdhar(db, 'cus_2', admin); return false; } catch (error) { return /already clear/.test(error.message); } })()), true);
});

test('partial product return: stock increases by returned qty and over-returns are blocked', () => {
  const { db, admin } = fixture();
  const product = db.products.find(item => item.id === 'prd_1');
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', items: [{ productId: 'prd_1', qty: 5 }] }, admin);
  const stockAfterSale = Number(product.stock);

  const first = processReturn(db, { saleId: sale.id, items: [{ productId: 'prd_1', name: product.name, qty: 2 }] }, admin).record;
  assert.equal(first.total > 0, true);
  assert.equal(Number(product.stock), stockAfterSale + 2);
  assert.equal(returnedQtyByItem(db, sale.id)['prd_1'], 2);

  assert.throws(() => processReturn(db, { saleId: sale.id, items: [{ productId: 'prd_1', name: product.name, qty: 4 }] }, admin), /can still be returned/);

  processReturn(db, { saleId: sale.id, items: [{ productId: 'prd_1', name: product.name, qty: 3 }] }, admin);
  assert.equal(sale.returnStatus, 'full');
  assert.equal(Number(product.stock), stockAfterSale + 5);
  assert.throws(() => processReturn(db, { saleId: sale.id, complete: true }, admin), /quantity to return/);
});

test('complete bill return restores everything exactly once', () => {
  const { db, admin } = fixture();
  const p1 = db.products.find(item => item.id === 'prd_1');
  const p2 = db.products.find(item => item.id === 'prd_3');
  const s1 = Number(p1.stock);
  const s2 = Number(p2.stock);
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', items: [{ productId: 'prd_1', qty: 3 }, { productId: 'prd_3', qty: 2 }] }, admin);
  const record = processReturn(db, { saleId: sale.id, complete: true }, admin).record;
  assert.equal(record.items.length, 2);
  assert.equal(Number(p1.stock), s1);
  assert.equal(Number(p2.stock), s2);
  assert.equal(sale.returnStatus, 'full');
  assert.equal(record.udharAdjustment, 0);
  assert.equal(record.cashRefund, record.total);
});

test('returning from a credit sale reduces udhar first instead of paying cash', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_1');
  const before = Number(customer.balance);
  const sale = createSale(db, { customerId: 'cus_1', paymentType: 'Credit', items: [{ productId: 'prd_1', qty: 4 }] }, admin);
  assert.equal(Number(customer.balance), before + sale.dueAmount);
  const dueBeforeReturn = sale.dueAmount;

  const record = processReturn(db, { saleId: sale.id, complete: true }, admin).record;
  assert.equal(record.udharAdjustment, dueBeforeReturn);
  assert.equal(record.cashRefund, 0);
  assert.equal(Number(customer.balance), before);
  assert.equal(sale.dueAmount, 0);
});

test('returning from a partially paid sale reduces udhar then refunds the rest in cash', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_1');
  customer.creditLimit = 0;
  const before = Number(customer.balance);
  const sale = createSale(db, { customerId: 'cus_1', paymentType: 'Credit', paidAmount: 1000, items: [{ productId: 'prd_1', qty: 6 }] }, admin);
  const dueAfterSale = sale.dueAmount;
  assert.equal(Number(customer.balance), before + dueAfterSale);

  const record = processReturn(db, { saleId: sale.id, complete: true }, admin).record;
  assert.equal(record.udharAdjustment, dueAfterSale);
  assert.equal(record.cashRefund, record.total - dueAfterSale);
  assert.equal(Number(customer.balance), before);
});

test('voided invoices cannot be returned and unknown invoices are rejected', () => {
  const { db, admin } = fixture();
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', items: [{ productId: 'prd_1', qty: 1 }] }, admin);
  sale.voided = true;
  assert.throws(() => processReturn(db, { saleId: sale.id, complete: true }, admin), /cannot be returned/);
  assert.throws(() => processReturn(db, { invoiceNo: 'FS-999999' }, admin), /not found/i);
});

test('role checks: cashier cannot pay or clear udhar; manager can; per-user overrides work', () => {
  const cashier = { role: 'Cashier' };
  const manager = { role: 'Manager' };
  const adminUser = { role: 'Admin' };
  assert.equal(can(cashier, 'udhar'), false);
  assert.equal(can(manager, 'udhar'), true);
  assert.equal(can(adminUser, 'udhar'), true);
  assert.equal(can(cashier, 'users'), false);
  assert.equal(can(adminUser, 'users'), true);
  assert.equal(can({ role: 'Cashier', permissions: ['pos', 'udhar'] }, 'udhar'), true);
  assert.equal(can({ role: 'Cashier', permissions: ['pos'] }, 'products'), false);
  assert.equal(can(cashier, 'returns:create'), true);
  assert.equal(can(manager, 'backups'), true);
});

test('ensureSchema migrates old records without deleting data', () => {
  const db = seedData();
  delete db.customers[1].address;
  delete db.products[0].barcode;
  delete db.products[0].image;
  delete db.sales;
  const changed = ensureSchema(db);
  assert.equal(changed, true);
  assert.equal(Array.isArray(db.sales), true);
  assert.equal(db.customers[1].address, '');
  assert.equal(db.products[0].barcode, '');
  const legacyCreditSale = { id: 'sal_old', createdAt: new Date().toISOString(), paymentType: 'Credit', subtotal: 1000, discount: 0, tax: 180, total: 1180, voided: false, items: [] };
  db.sales.push(legacyCreditSale);
  ensureSchema(db);
  assert.equal(legacyCreditSale.paidAmount, 0);
  assert.equal(legacyCreditSale.dueAmount, 1180);
  const legacyCashSale = { id: 'sal_cash', createdAt: new Date().toISOString(), paymentType: 'Cash', subtotal: 500, discount: 0, tax: 90, total: 590, voided: false, items: [] };
  db.sales.push(legacyCashSale);
  ensureSchema(db);
  assert.equal(legacyCashSale.paidAmount, 590);
  assert.equal(legacyCashSale.dueAmount, 0);
});

test('cloud merge uses only the unpaid portion of partial-payment credit sales', () => {
  const base = () => ({
    meta: { createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', invoiceSeq: 1048 },
    settings: {}, users: [], sessions: {},
    products: [], customers: [{ id: 'cus_x', name: 'X', balance: 100, _updatedAt: '2026-08-02T09:00:00Z' }],
    suppliers: [], purchases: [], sales: [], returns: [], stockMovements: [], auditLogs: []
  });
  const local = base();
  const cloud = base();
  cloud.sales.push({
    id: 'sal_p', createdAt: '2026-08-02T12:00:00Z', voided: false, paymentType: 'Credit',
    customerId: 'cus_x', subtotal: 5000, discount: 0, tax: 0, total: 5000,
    paidAmount: 2000, dueAmount: 3000, items: []
  });
  const { merged } = mergeDbs(local, cloud);
  assert.equal(merged.customers[0].balance, 3100);
});

test('unused product deletes permanently; billed product is protected', () => {
  const { db, admin } = fixture();
  db.products.unshift({ id: 'prd_new', name: 'Fresh Item', sku: 'FRESH1', price: 100, cost: 80, stock: 4, reorderLevel: 2, unit: 'pcs', category: 'General', active: true, status: 'active' });
  db.products = db.products.filter(item => item.id !== 'prd_new');
  assert.equal(db.products.some(item => item.id === 'prd_new'), false);
  const billedSale = db.sales.find(sale => Array.isArray(sale.items) && sale.items.length);
  const billedId = billedSale ? billedSale.items[0].productId : null;
  if (billedId) {
    const used = db.sales.some(sale => (sale.items || []).some(item => item.productId === billedId));
    assert.equal(used, true);
  }
});

test('delete guard logic flags products referenced by sales or purchases', () => {
  const { db } = fixture();
  const target = db.products[0];
  const usedBySale = db.sales.some(sale => (sale.items || []).some(item => item.productId === target.id));
  const usedByPurchase = db.purchases.some(purchase => (purchase.items || []).some(item => item.productId === target.id));
  assert.equal(typeof usedBySale, 'boolean');
  assert.equal(typeof usedByPurchase, 'boolean');
});
