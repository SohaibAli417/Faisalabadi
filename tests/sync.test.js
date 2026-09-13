const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeDbs, productStockDelta, customerCreditDelta } = require('../sync');

function baseDb(overrides = {}) {
  return {
    meta: { createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', invoiceSeq: 1048 },
    settings: { storeName: 'Akmal Store', taxRate: 0.18, currency: 'Rs' },
    users: [{ id: 'usr_sohaib', name: 'Sohaib Ali', role: 'Admin' }],
    sessions: {},
    products: [],
    customers: [],
    suppliers: [],
    purchases: [],
    sales: [],
    returns: [],
    stockMovements: [],
    auditLogs: [],
    ...overrides
  };
}

test('union: a sale that only exists on the local side is pushed to the merged result', () => {
  const product = { id: 'prd_1', name: 'Soap', stock: 10, _updatedAt: '2026-08-01T01:00:00Z' };
  const local = baseDb({ products: [product] });
  const cloud = baseDb({ products: [{ ...product }] });
  const saleTime = '2026-08-02T10:00:00Z';
  local.sales.push({
    id: 'sal_1', clientId: 'client_1', createdAt: saleTime, voided: false,
    paymentType: 'Cash', total: 100,
    items: [{ productId: 'prd_1', qty: 3 }]
  });
  local.products[0].stock = 7;
  local.products[0]._updatedAt = saleTime;

  const { merged } = mergeDbs(local, cloud);
  assert.equal(merged.sales.length, 1);
  assert.equal(merged.sales[0].id, 'sal_1');
});

test('stock reconciliation: cloud-only sale reduces the winning local stock', () => {
  const product = { id: 'prd_1', name: 'Soap', stock: 7, _updatedAt: '2026-08-02T09:00:00Z' };
  const local = baseDb({ products: [{ ...product }] });
  const cloudSaleTime = '2026-08-02T11:00:00Z';
  const cloud = baseDb({
    products: [{ ...product }],
    sales: [{
      id: 'sal_cloud_1', createdAt: cloudSaleTime, voided: false, paymentType: 'Cash', total: 50,
      items: [{ productId: 'prd_1', qty: 2 }]
    }]
  });

  const { merged } = mergeDbs(local, cloud);
  assert.equal(merged.products.length, 1);
  assert.equal(merged.products[0].stock, 5);
  assert.equal(merged.sales.length, 1);
});

test('last-writer-wins: newer product edit wins regardless of side', () => {
  const oldProduct = { id: 'prd_1', name: 'Soap', price: 100, _updatedAt: '2026-08-01T01:00:00Z' };
  const local = baseDb({ products: [oldProduct] });
  const cloud = baseDb({ products: [{ ...oldProduct, name: 'Soap Deluxe', _updatedAt: '2026-08-03T01:00:00Z' }] });

  const { merged } = mergeDbs(local, cloud);
  assert.equal(merged.products[0].name, 'Soap Deluxe');

  const localNewer = baseDb({ products: [{ ...oldProduct, name: 'Local Name', _updatedAt: '2026-08-04T01:00:00Z' }] });
  const { merged: merged2 } = mergeDbs(localNewer, cloud);
  assert.equal(merged2.products[0].name, 'Local Name');
});

test('offline queue duplicates are removed when the same clientId exists on both sides', () => {
  const local = baseDb();
  const cloud = baseDb();
  const sale = { id: 'sal_cloud_copy', clientId: 'client_x', createdAt: '2026-08-02T08:00:00Z', voided: false, items: [], total: 10 };
  const offlineCopy = { id: 'sal_local_copy', clientId: 'client_x', createdAt: '2026-08-02T08:00:00Z', voided: false, items: [], total: 10 };
  cloud.sales.push(sale);
  local.sales.push(offlineCopy);

  const { merged } = mergeDbs(local, cloud);
  assert.equal(merged.sales.length, 1);
});

test('customer udhar balance includes credit sales unique to the other side', () => {
  const customer = { id: 'cus_1', name: 'Ali', balance: 500, _updatedAt: '2026-08-02T09:00:00Z' };
  const local = baseDb({ customers: [{ ...customer }] });
  const cloud = baseDb({
    customers: [{ ...customer }],
    sales: [{
      id: 'sal_credit', createdAt: '2026-08-02T12:00:00Z', voided: false, paymentType: 'Credit',
      customerId: 'cus_1', total: 250, items: []
    }]
  });

  const { merged } = mergeDbs(local, cloud);
  assert.equal(merged.customers[0].balance, 750);
});

test('voided sales never affect stock or balance reconciliation', () => {
  const delta = productStockDelta([
    { voided: true, items: [{ productId: 'p1', qty: 5 }] },
    { voided: false, items: [{ productId: 'p1', qty: 2 }] }
  ], [], []);
  assert.equal(delta.p1, -2);

  const credit = customerCreditDelta([{ voided: true, paymentType: 'Credit', customerId: 'c1', total: 99 }]);
  assert.deepEqual(credit, {});
});

test('invoice sequence moves forward to the highest known value', () => {
  const local = baseDb();
  local.meta.invoiceSeq = 1050;
  const cloud = baseDb();
  cloud.meta.invoiceSeq = 1060;
  const { merged } = mergeDbs(local, cloud);
  assert.ok(merged.meta.invoiceSeq >= 1060);
});

test('users and settings stay under local control during merge', () => {
  const local = baseDb();
  local.settings.storeName = 'Akmal Store Local';
  const cloud = baseDb();
  cloud.users = [{ id: 'usr_ghost', name: 'Ghost' }];
  cloud.settings.storeName = 'Cloud Name';

  const { merged } = mergeDbs(local, cloud);
  assert.equal(merged.settings.storeName, 'Akmal Store Local');
  assert.equal(merged.users.length, 1);
  assert.equal(merged.users[0].id, 'usr_sohaib');
});

test('union: a payment recorded on one side merges into the result', () => {
  const local = baseDb({ payments: [{ id: 'pay_1', customerId: 'cus_1', amount: 500, at: '2026-08-02T09:00:00Z' }] });
  const cloud = baseDb({ payments: [{ id: 'pay_2', customerId: 'cus_1', amount: 300, at: '2026-08-02T10:00:00Z' }] });
  const { merged, localChanged, cloudChanged } = mergeDbs(local, cloud);
  assert.equal(merged.payments.length, 2);
  assert.equal(merged.payments[0].id, 'pay_2');
  assert.ok(localChanged && cloudChanged);
});

test('returns and purchases are deduped by id and never duplicated by the merge', () => {
  const returnRecord = {
    id: 'ret_1', saleId: 'sal_1', createdAt: '2026-08-02T10:00:00Z',
    items: [{ productId: 'prd_1', qty: 1 }], total: 100
  };
  const purchaseRecord = {
    id: 'pur_1', createdAt: '2026-08-02T10:00:00Z',
    items: [{ productId: 'prd_1', qty: 5 }], total: 500
  };
  const local = baseDb({ returns: [{ ...returnRecord, _updatedAt: '2026-08-03T00:00:00Z' }], purchases: [{ ...purchaseRecord }] });
  const cloud = baseDb({ returns: [{ ...returnRecord, _updatedAt: '2026-08-01T00:00:00Z' }], purchases: [{ ...purchaseRecord }] });

  const first = mergeDbs(local, cloud);
  assert.equal(first.merged.returns.length, 1);
  assert.equal(first.merged.purchases.length, 1);

  const second = mergeDbs(first.merged, first.merged);
  assert.equal(second.merged.returns.length, 1);
  assert.equal(second.merged.purchases.length, 1);
  assert.equal(second.localChanged, false);
  assert.equal(second.cloudChanged, false);
});
