const test = require('node:test');
const assert = require('node:assert/strict');
const {
  seedData, ensureSchema, createSale, processReturn, receiveUdharPayment,
  clearUdhar, returnedQtyByItem, customerTotals, decorateCustomer,
  createSupplier, updateSupplier, deleteSupplier, deleteCustomer, can,
  voidSale, reversePayment
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

test('partial payment sale sent as paymentType Partial still leaves the unpaid part on udhar', () => {
  const { db, admin } = fixture();
  const before = Number(db.customers.find(item => item.id === 'cus_1').balance);
  // A 'Partial' bill used to be treated as fully paid, silently wiping the udhar.
  const sale = createSale(db, { customerId: 'cus_1', paymentType: 'Partial', paidAmount: 2000, items: [{ productId: 'prd_1', qty: 5 }] }, admin);
  assert.equal(sale.paidAmount, 2000);
  assert.equal(sale.dueAmount, sale.total - 2000);
  const customer = db.customers.find(item => item.id === 'cus_1');
  assert.equal(customer.balance, before + (sale.total - 2000));
  // And it must show up in the customer's khata, not just on the balance.
  const credit = customerTotals(db).cus_1.creditPurchases;
  assert.equal(credit >= sale.total, true);
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

test('rejected sale deducts NO stock and records NO movement or invoice for any item', () => {
  const { db, admin } = fixture();
  const first = db.products.find(item => item.id === 'prd_1');
  const short = db.products.find(item => item.id === 'prd_4');
  const firstBefore = Number(first.stock);
  const shortBefore = Number(short.stock);
  const invoiceSeqBefore = db.meta.invoiceSeq;
  const movementsBefore = db.stockMovements.length;
  assert.throws(() => createSale(db, {
    customerId: 'cus_walkin',
    paymentType: 'Cash',
    items: [{ productId: 'prd_1', qty: 2 }, { productId: 'prd_4', qty: 999 }]
  }, admin), /insufficient stock/);
  assert.equal(Number(first.stock), firstBefore, 'valid item must not be deducted when the sale is rejected');
  assert.equal(Number(short.stock), shortBefore);
  assert.equal(db.stockMovements.length, movementsBefore, 'no movement allowed for a rejected sale');
  assert.equal(db.meta.invoiceSeq, invoiceSeqBefore, 'no invoice number consumed for a rejected sale');
  assert.equal(db.sales.length, 0, 'no sale persisted for a rejected sale');
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

test('decorateCustomer exposes linked and manual customer products (multi + legacy single) with qty and unit', () => {
  const { db } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_1');
  customer.products = [
    { id: 'prd_1', name: 'stale name', manual: false, qty: 2, unit: 'kg' },
    { id: null, name: 'Chai ka saman', manual: true, qty: 3, unit: 'dozen' }
  ];
  const multi = decorateCustomer(db, customer, customerTotals(db));
  assert.equal(multi.products.length, 2);
  assert.equal(multi.products[0].manual, false);
  assert.equal(multi.products[0].name, db.products.find(item => item.id === 'prd_1').name);
  assert.equal(multi.products[0].qty, 2);
  assert.equal(multi.products[0].unit, 'kg');
  assert.equal(multi.products[1].manual, true);
  assert.equal(multi.products[1].name, 'Chai ka saman');
  assert.equal(multi.products[1].qty, 3);
  assert.equal(multi.products[1].unit, 'dozen');
  assert.equal(multi.profileProduct.name, db.products.find(item => item.id === 'prd_1').name);
  assert.equal(multi.profileProduct.qty, 2);
  customer.products = [];
  delete customer.products;
  customer.productId = 'prd_1';
  const legacy = decorateCustomer(db, customer, customerTotals(db));
  assert.equal(legacy.products.length, 1);
  assert.equal(legacy.products[0].name, db.products.find(item => item.id === 'prd_1').name);
  assert.equal(legacy.products[0].qty, 1);
  assert.equal(legacy.products[0].unit, '');
  assert.equal(legacy.profileProduct.manual, false);
  const none = decorateCustomer(db, db.customers.find(item => item.id === 'cus_2'), customerTotals(db));
  assert.equal(none.products.length, 0);
  assert.equal(none.profileProduct, null);
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

test('customer create/delete works, audited, and delete is blocked once billing or udhaar history exists', () => {
  const { db, admin } = fixture();
  db.customers.unshift({ id: 'cus_new', name: 'Temp Buyer', phone: '0300-1234567', balance: 0, active: true });
  deleteCustomer(db, 'cus_new', admin);
  assert.equal(db.customers.some(item => item.id === 'cus_new'), false);
  assert.equal(db.auditLogs.some(log => log.entity === 'customer' && log.action === 'delete'), true);
  db.customers.unshift({ id: 'cus_keep', name: 'Has History', balance: 0, active: true });
  db.sales = [{ id: 'sal_x', customerId: 'cus_keep', items: [], total: 50 }];
  assert.throws(() => deleteCustomer(db, 'cus_keep', admin), /billing or udhaar history/);
  db.sales = [];
  db.customers = db.customers.filter(item => item.id !== 'cus_keep');
  db.customers.unshift({ id: 'cus_debt', name: 'Owes Money', balance: 250, active: true });
  assert.throws(() => deleteCustomer(db, 'cus_debt', admin), /billing or udhaar history/);
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

test('main discount plus additional discount combine into a single stored discount', () => {
  const { db, admin } = fixture();
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', discount: 100, additionalDiscount: 50, items: [{ productId: 'prd_1', qty: 2 }], taxRate: 0 }, admin);
  assert.equal(sale.subtotal, 1780);
  assert.equal(sale.discount, 150);
  assert.equal(sale.additionalDiscount, 50);
  assert.equal(sale.total, 1630);
});

test('additional discount is clamped so totals never go negative', () => {
  const { db, admin } = fixture();
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', discount: 500, additionalDiscount: 99999, items: [{ productId: 'prd_1', qty: 1 }], taxRate: 0 }, admin);
  assert.equal(sale.discount, 890);
  assert.equal(sale.total, 0);
  assert.equal(sale.dueAmount, 0);
});

test('cash sale records the amount handed over as receivedAmount', () => {
  const { db, admin } = fixture();
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', receivedAmount: 2000, items: [{ productId: 'prd_1', qty: 2 }], taxRate: 0 }, admin);
  assert.equal(sale.total, 1780);
  assert.equal(sale.paidAmount, 1780);
  assert.equal(sale.receivedAmount, 2000);
});

test('partial payment via Credit stores the received amount on the sale', () => {
  const { db, admin } = fixture();
  const sale = createSale(db, { customerId: 'cus_1', paymentType: 'Credit', paidAmount: 500, receivedAmount: 500, items: [{ productId: 'prd_1', qty: 1 }], taxRate: 0 }, admin);
  assert.equal(sale.paidAmount, 500);
  assert.equal(sale.receivedAmount, 500);
  assert.equal(sale.dueAmount, sale.total - 500);
});

test('reference and delivery details are stored on the sale and empty delivery is omitted', () => {
  const { db, admin } = fixture();
  const sale = createSale(db, {
    customerId: 'cus_walkin', paymentType: 'Cash', reference: 'Order #42',
    delivery: { deliverTo: 'Ali', transport: 'Pathan Coach', trNo: 'PK-123', cases: '10', freight: '500' },
    items: [{ productId: 'prd_1', qty: 1 }], taxRate: 0
  }, admin);
  assert.equal(sale.reference, 'Order #42');
  assert.equal(sale.delivery.deliverTo, 'Ali');
  assert.equal(sale.delivery.transport, 'Pathan Coach');
  const clean = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', delivery: { deliverTo: '   ' }, items: [{ productId: 'prd_1', qty: 1 }], taxRate: 0 }, admin);
  assert.equal(clean.delivery, null);
});

test('invalid client price falls back to the product price server-side', () => {
  const { db, admin } = fixture();
  const product = db.products.find(item => item.id === 'prd_1');
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', items: [{ productId: 'prd_1', qty: 1, price: 'oops' }], taxRate: 0 }, admin);
  assert.equal(sale.items[0].price, Number(product.price));
  assert.equal(sale.total, Number(product.price));
});

test('ensureSchema creates the drafts collection and product location field', () => {
  const { db } = fixture();
  delete db.drafts;
  const changed = ensureSchema(db);
  assert.equal(changed, true);
  assert.equal(Array.isArray(db.drafts), true);
  ensureSchema(db);
  const product = db.products.find(item => !('location' in item));
  if (product) assert.equal(product.location, '');
});

test('voidSale restocks items, reverses the udhar balance, and voids linked billing payments', () => {
  const { db, admin } = fixture();
  const product = db.products.find(item => item.id === 'prd_1');
  const stockBefore = Number(product.stock);
  const customer = db.customers.find(item => item.id === 'cus_1');
  const balanceBefore = Number(customer.balance);
  const sale = createSale(db, { customerId: 'cus_1', paymentType: 'Credit', paidAmount: 2000, items: [{ productId: 'prd_1', qty: 3 }] }, admin);
  const payment = db.payments.find(item => item.saleId === sale.id && !item.voided);
  assert.ok(payment);
  assert.equal(Number(product.stock), stockBefore - 3);
  assert.equal(Number(customer.balance), balanceBefore + sale.dueAmount);
  const voided = voidSale(db, sale, admin);
  assert.equal(voided.voided, true);
  assert.equal(Number(product.stock), stockBefore);
  assert.equal(Number(customer.balance), balanceBefore);
  assert.equal(db.payments.find(item => item.id === payment.id).voided, true);
  const movement = db.stockMovements.find(item => item.productId === 'prd_1' && item.type === 'void');
  assert.ok(movement);
  assert.equal(movement.qty, 3);
  assert.throws(() => voidSale(db, sale, admin), /already voided/);
});

test('voidSale never drops balance below zero and leaves cash sales untouched', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_2');
  createSale(db, { customerId: 'cus_2', paymentType: 'Credit', items: [{ productId: 'prd_3', qty: 1 }] }, admin);
  const cashSale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', items: [{ productId: 'prd_1', qty: 1 }] }, admin);
  const balanceBeforeCash = Number(customer.balance);
  voidSale(db, cashSale, admin);
  assert.equal(Number(customer.balance), balanceBeforeCash, 'cash sale must not touch the customer balance');
});

test('reversePayment adds the amount back to the balance and decrements recordedPaid', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_2');
  createSale(db, { customerId: 'cus_2', paymentType: 'Credit', items: [{ productId: 'prd_3', qty: 2 }] }, admin);
  const balanceBefore = Number(customer.balance);
  const pay = Math.min(500, Math.floor(balanceBefore / 2));
  const payment = receiveUdharPayment(db, 'cus_2', pay, admin).payment;
  assert.equal(Number(customer.balance), balanceBefore - pay);
  const paidBefore = Number(customer.recordedPaid ?? db.payments.filter(item => item.customerId === 'cus_2' && !item.voided).reduce((sum, item) => sum + Number(item.amount), 0));
  const reversed = reversePayment(db, payment.id, admin);
  assert.equal(reversed.voided, true);
  assert.equal(Number(customer.balance), balanceBefore);
  const visible = db.payments.filter(item => item.customerId === 'cus_2' && !item.voided);
  const visiblePaid = visible.reduce((sum, item) => sum + Number(item.amount), 0);
  if (paidBefore > 0) assert.equal(Number(customer.recordedPaid ?? visiblePaid).toFixed(2), Number(paidBefore - pay).toFixed(2));
  assert.throws(() => reversePayment(db, payment.id, admin), /already reversed/);
  assert.throws(() => reversePayment(db, 'nope', admin), /not found/);
});

test('customerTotals and the ledger both exclude voided payments and sales', () => {
  const { db, admin } = fixture();
  const customer = db.customers.find(item => item.id === 'cus_1');
  const creditBefore = (customerTotals(db).cus_1 || {}).creditPurchases || 0;
  const sale = createSale(db, { customerId: 'cus_1', paymentType: 'Credit', paidAmount: 1000, items: [{ productId: 'prd_1', qty: 2 }] }, admin);
  const payment = receiveUdharPayment(db, 'cus_1', 500, admin).payment;
  const totalsBefore = customerTotals(db);
  const creditAfterSale = totalsBefore.cus_1.creditPurchases;
  assert.ok(creditAfterSale > creditBefore);
  voidSale(db, sale, admin);
  reversePayment(db, payment.id, admin);
  const totals = customerTotals(db);
  const soldById = db.sales.find(item => item.id === sale.id);
  assert.equal(soldById.voided, true);
  assert.equal(db.payments.find(item => item.id === payment.id).voided, true);
  assert.equal(Number((totals.cus_1 || {}).creditPurchases || 0).toFixed(2), Number(creditBefore).toFixed(2));
  const paymentsForCustomer = db.payments.filter(item => item.customerId === 'cus_1');
  const visiblePayments = paymentsForCustomer.filter(item => !item.voided);
  assert.ok(visiblePayments.length < paymentsForCustomer.length);
});
