const test = require('node:test');
const assert = require('node:assert/strict');
const { seedData, hashPassword, verifyPassword, validatePassword, calculateReport, maskCnic } = require('../server');

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
    id: 'sale_test',
    createdAt: new Date().toISOString(),
    paymentType: 'Credit',
    subtotal: 1000,
    discount: 100,
    tax: 162,
    total: 1062,
    voided: false,
    items: [
      { name: 'Test Item', qty: 2, price: 500, cost: 300 }
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
  assert.equal(report.creditSales, 1062);
  assert.equal(report.refunds, 200);
  assert.equal(report.netSales, 862);
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
