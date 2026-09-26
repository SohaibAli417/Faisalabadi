const test = require('node:test');
const assert = require('node:assert/strict');
const { seedData, hashPassword, verifyPassword, validatePassword, calculateReport, dashboardStats, convertPackQty, maskCnic, resolveProductPricing } = require('../server');

test('password hashes verify only the original password', () => {
  const stored = hashPassword('admin123');
  assert.equal(verifyPassword('admin123', stored), true);
  assert.equal(verifyPassword('wrong-password', stored), false);
});

test('password validation requires length plus letters and numbers', () => {
  assert.equal(validatePassword('secure123'), '');
  assert.equal(validatePassword('short1'), 'Password must be at least 8 characters.');
  assert.equal(validatePassword('onlyletters'), 'Password must include letters and numbers.');
});

test('CNIC is masked before customer data is returned to the UI', () => {
  assert.equal(maskCnic('35202-1234567-1'), '352********71');
  assert.equal(maskCnic(''), '');
});

test('profit and loss report calculates sales, tax, profit, credit and refunds', () => {
  const db = seedData();
  db.sales.push({
    id: 'sale_cash',
    createdAt: new Date().toISOString(),
    paymentType: 'Cash',
    subtotal: 1000,
    discount: 100,
    tax: 162,
    total: 1062,
    voided: false,
    items: [
      { name: 'Test Item', qty: 2, price: 500, cost: 300 }
    ]
  });
  db.sales.push({
    id: 'sale_credit',
    createdAt: new Date().toISOString(),
    paymentType: 'Credit',
    subtotal: 500,
    discount: 0,
    tax: 0,
    total: 500,
    dueAmount: 500,
    voided: false,
    items: [
      { name: 'Credit Item', qty: 1, price: 500, cost: 300 }
    ]
  });
  db.returns.push({
    id: 'return_test',
    createdAt: new Date().toISOString(),
    total: 200
  });
  const report = calculateReport(db, 'day');
  assert.equal(report.salesCount, 1);
  assert.equal(report.revenue, 1000);
  assert.equal(report.discounts, 100);
  assert.equal(report.tax, 162);
  assert.equal(report.grossProfit, 300);
  assert.equal(report.refunds, 200);
  assert.equal(report.netSales, 862);
});

test('udhar credit bills stay out of the daily sale total but are reported separately', () => {
  const db = seedData();
  db.sales.push({
    id: 'sale_credit_only',
    createdAt: new Date().toISOString(),
    paymentType: 'Credit',
    subtotal: 800,
    discount: 0,
    tax: 0,
    total: 800,
    dueAmount: 800,
    voided: false,
    items: [{ name: 'Credit Item', qty: 1, price: 800, cost: 500 }]
  });
  const report = calculateReport(db, 'day');
  assert.equal(report.salesCount, 0);
  assert.equal(report.revenue, 0);
  assert.equal(report.netSales, 0);
  assert.equal(report.creditCount, 1);
  assert.equal(report.creditSales, 800);
  assert.equal(report.creditOutstanding, 800);
});

test('partial payment counts as a credit bill for the daily sale total', () => {
  const db = seedData();
  db.sales.push({
    id: 'sale_partial',
    createdAt: new Date().toISOString(),
    paymentType: 'Partial',
    subtotal: 900,
    discount: 0,
    tax: 0,
    total: 900,
    paidAmount: 400,
    dueAmount: 500,
    voided: false,
    items: [{ name: 'Item', qty: 1, price: 900, cost: 600 }]
  });
  const report = calculateReport(db, 'day');
  assert.equal(report.salesCount, 0);
  assert.equal(report.creditCount, 1);
  assert.equal(report.creditOutstanding, 500);
});

test('refunds larger than the daily sale never push net sales below zero', () => {
  const db = seedData();
  db.sales.push({
    id: 'sale_small',
    createdAt: new Date().toISOString(),
    paymentType: 'Cash',
    subtotal: 100,
    discount: 0,
    tax: 0,
    total: 100,
    voided: false,
    items: [{ name: 'Item', qty: 1, price: 100, cost: 60 }]
  });
  db.returns.push({ id: 'return_big', createdAt: new Date().toISOString(), total: 400 });
  assert.equal(calculateReport(db, 'day').netSales, 0);
});

test('convertPackQty turns boree and carton packs into sellable units', () => {
  const source = { name: 'Rice', kgPerBoree: 50, pcsPerCarton: 12 };
  assert.equal(convertPackQty(3, 'boree', source).qty, 150);
  assert.equal(convertPackQty(3, 'boree', source).factor, 50);
  assert.equal(convertPackQty(3, 'boree', source).label, 'boree');
  assert.equal(convertPackQty(2, 'carton', source).qty, 24);
  assert.equal(convertPackQty(4, 'none', source).qty, 4);
  assert.equal(convertPackQty(2, 'boree', { name: 'No spec' }).factor, 0);
  assert.equal(convertPackQty(0, 'boree', source).qty, 0);
  assert.equal(convertPackQty(-5, 'boree', source).qty, 0);
});

test('dashboardStats reports products, low stock, udhar and today bills', () => {
  const db = seedData();
  db.warehouses = [{ id: 'wh_1', name: 'Main', stock: 5, unit: 'boree' }];
  db.sales.push({
    id: 'sale_today',
    createdAt: new Date().toISOString(),
    paymentType: 'Credit',
    subtotal: 400,
    discount: 0,
    tax: 0,
    total: 400,
    dueAmount: 400,
    voided: false,
    items: [{ name: 'Item', qty: 1, price: 400, cost: 200 }]
  });
  const stats = dashboardStats(db);
  assert.equal(stats.totalProducts, db.products.length);
  assert.equal(stats.warehouseItems, 1);
  assert.equal(stats.totalCustomers, 3);
  assert.equal(stats.udharCustomers, 2);
  assert.equal(stats.totalUdhar, 4850 + 12600);
  assert.equal(stats.todayBills, 0);
  assert.equal(stats.todayCreditBills, 1);
  assert.equal(stats.lowStockCount, db.products.filter(p => p.stock <= p.reorderLevel).length);
});

test('voided sales are excluded from reporting', () => {
  const db = seedData();
  db.sales.push({
    id: 'sale_voided',
    createdAt: new Date().toISOString(),
    paymentType: 'Cash',
    subtotal: 500,
    discount: 0,
    tax: 90,
    total: 590,
    voided: true,
    items: [{ qty: 1, price: 500, cost: 300 }]
  });
  assert.equal(calculateReport(db, 'day').salesCount, 0);
});

test('owner profit amount is added to cost to set the sale price', () => {
  const pricing = resolveProductPricing({ cost: 300, profitType: 'amount', profitValue: 100 });
  assert.equal(pricing.cost, 300);
  assert.equal(pricing.price, 400);
});

test('owner profit percent is calculated from cost', () => {
  const pricing = resolveProductPricing({ cost: 300, profitType: 'percent', profitValue: 25 });
  assert.equal(pricing.price, 375);
});

test('explicit sale price overrides the owner profit calculation', () => {
  const pricing = resolveProductPricing({ cost: 300, price: '450', profitType: 'amount', profitValue: 100 });
  assert.equal(pricing.price, 450);
});

test('missing profit values fall back to price equal to cost', () => {
  const pricing = resolveProductPricing({ cost: 300 });
  assert.equal(pricing.price, 300);
});
