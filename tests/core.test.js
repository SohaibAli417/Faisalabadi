const test = require('node:test');
const assert = require('node:assert/strict');
const {
  seedData, hashPassword, verifyPassword, validatePassword, calculateReport, dashboardStats,
  convertPackQty, maskCnic, resolveProductPricing, isProtectedPath,
  unitToBase, qtyToBase, priceToUnit, stockQtyFor, createSale, ensureSchema, unitsCompatible
} = require('../server');

test('unit conversion moves qty and rate in opposite directions so the value never changes', () => {
  // 1 kg == 1000 gram, so 500 gram is 0.5 kg.
  assert.equal(unitToBase('gram', 'kg'), 0.001);
  assert.equal(unitToBase('kg', 'gram'), 1000);
  assert.equal(qtyToBase(500, 'gram', 'kg'), 0.5);
  assert.equal(qtyToBase(2, 'kg', 'gram'), 2000);
  // A rate per kg becomes a rate per gram, and back again.
  assert.equal(priceToUnit(100, 'gram', 'kg'), 0.1);
  assert.equal(priceToUnit(0.1, 'kg', 'gram'), 100);
  // The pair must round-trip: qty x rate is the same money in either unit.
  assert.equal(qtyToBase(500, 'gram', 'kg') * 100, priceToUnit(100, 'gram', 'kg') * 500);
  assert.equal(qtyToBase(2, 'kg', 'gram') * priceToUnit(100, 'gram', 'kg'), 2 * 100);
  // Same-unit and unknown-unit cases stay 1:1 rather than collapsing to zero.
  assert.equal(unitToBase('kg', 'kg'), 1);
  assert.equal(unitToBase('pcs', 'pcs'), 1);
  assert.equal(unitToBase('mystery', 'kg'), 1);
  assert.equal(qtyToBase(3, 'mystery', 'kg'), 3);
});

test('units of different kinds are refused instead of being treated as 1:1', () => {
  const db = seedData();
  ensureSchema(db);
  const admin = db.users[0];
  const product = db.products[0];
  product.unit = 'litre';
  product.stock = 10;
  // 5 gram of a litre product would silently take 5 litre of stock at a 1:1 factor.
  assert.throws(
    () => createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', taxRate: 0, items: [{ productId: product.id, qty: 5, unit: 'gram', price: 1 }] }, admin),
    /cannot be billed in gram/
  );
  assert.equal(Number(product.stock), 10);
  // Same dimension still converts, and a custom unit the app does not know stays 1:1.
  const kgProduct = db.products[1];
  kgProduct.unit = 'kg';
  kgProduct.stock = 5;
  const sameDimension = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', taxRate: 0, items: [{ productId: kgProduct.id, qty: 1000, unit: 'gram', price: 0.1 }] }, admin);
  assert.equal(sameDimension.items[0].baseQty, 1);
  assert.equal(Number(kgProduct.stock), 4);
  assert.equal(unitsCompatible('kg', 'kg'), true);
  assert.equal(unitsCompatible('gram', 'litre'), false);
  assert.equal(unitsCompatible('customUnit', 'kg'), true);
});

test('billing a kg product in grams checks and reduces stock in kg, not grams', () => {
  const db = seedData();
  ensureSchema(db);
  const admin = db.users[0];
  const product = db.products[0];
  product.unit = 'kg';
  product.stock = 10;
  product.price = 100;
  // 2000 gram of a product that only has 10 kg in stock must succeed and take 2 kg.
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', taxRate: 0, items: [{ productId: product.id, qty: 2000, unit: 'gram', price: 0.1 }] }, admin);
  assert.equal(sale.items[0].unit, 'gram');
  assert.equal(sale.items[0].qty, 2000);
  assert.equal(sale.items[0].baseQty, 2);
  assert.equal(Number(product.stock), 8);
  assert.equal(sale.total, 200);
});

test('a sub-rupee per-gram rate is kept, not rounded away to zero', () => {
  const db = seedData();
  ensureSchema(db);
  const admin = db.users[0];
  const product = db.products[0];
  product.unit = 'kg';
  product.stock = 10;
  product.price = 7;
  // Rs 7/kg is Rs 0.007/gram. Rounding the rate to whole rupees would make the line free.
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', taxRate: 0, items: [{ productId: product.id, qty: 1000, unit: 'gram', price: 0.007 }] }, admin);
  assert.equal(sale.items[0].price, 0.007);
  assert.equal(sale.total, 7);
});

test('a gram quantity larger than the kg stock is rejected', () => {
  const db = seedData();
  ensureSchema(db);
  const admin = db.users[0];
  const product = db.products[0];
  product.unit = 'kg';
  product.stock = 1;
  // 20 kg worth of grams against 1 kg of stock must fail, not pass as "20 > 1".
  assert.throws(
    () => createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', items: [{ productId: product.id, qty: 20000, unit: 'gram', price: 0.1 }] }, admin),
    /insufficient stock/
  );
  assert.equal(Number(product.stock), 1);
});

test('voiding a gram-billed sale restocks the same kg amount it took', () => {
  const db = seedData();
  ensureSchema(db);
  const admin = db.users[0];
  const product = db.products[0];
  product.unit = 'kg';
  product.stock = 10;
  const sale = createSale(db, { customerId: 'cus_walkin', paymentType: 'Cash', items: [{ productId: product.id, qty: 2000, unit: 'gram', price: 0.1 }] }, admin);
  assert.equal(Number(product.stock), 8);
  require('../server').voidSale(db, sale, admin);
  // Must go back to 10, not to 10010.
  assert.equal(Number(product.stock), 10);
});

test('stockQtyFor converts older sale rows that predate unit conversion', () => {
  // Rows saved before this change have no baseQty; they must still restock correctly.
  assert.equal(stockQtyFor({ qty: 2000, unit: 'gram' }, { unit: 'kg' }), 2);
  assert.equal(stockQtyFor({ qty: 2, unit: 'kg' }, { unit: 'kg' }), 2);
  assert.equal(stockQtyFor({ qty: 500, unit: 'gram' }, { unit: 'kg' }), 0.5);
  // A stored baseQty always wins, so the original conversion is never recalculated.
  assert.equal(stockQtyFor({ qty: 2000, unit: 'gram', baseQty: 2 }, { unit: 'kg' }), 2);
  assert.equal(stockQtyFor({ qty: 3, unit: 'pcs' }, { unit: 'pcs' }), 3);
});

test('static file serving blocks the database, secrets and backups', () => {
  // A data file in a deployed build must never be downloadable, even if an ignore file is wrong.
  for (const file of [
    'database/pos-data.json',
    'database/cloud-cache.json',
    'database/pos-data-backup-pre-password-change.json',
    'database/backups/pos-data.json',
    'database/setup-supabase.sql',
    '.env',
    '.env.local',
    '.git/config'
  ]) {
    assert.equal(isProtectedPath(file), true, `${file} must not be served`);
  }
  // Traversal and encoded attempts must not slip past the check either.
  assert.equal(isProtectedPath('../database/pos-data.json'), true);
  assert.equal(isProtectedPath('database\\pos-data.json'), true);
  assert.equal(isProtectedPath('/database/pos-data.json'), true);
});

test('static file serving still allows the real app files', () => {
  for (const file of [
    '',
    'index.html',
    'app.js',
    'styles.css',
    'logo.png',
    'manifest.json',
    'vendor/react.production.min.js',
    'sw.js',
    'api/health'
  ]) {
    assert.equal(isProtectedPath(file), false, `${file} must stay reachable`);
  }
});

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
  // Both the cash bill and the udhar bill are sales for the day.
  assert.equal(report.salesCount, 2);
  assert.equal(report.revenue, 1500);
  assert.equal(report.discounts, 100);
  assert.equal(report.tax, 162);
  assert.equal(report.grossProfit, 300 + 200);
  assert.equal(report.refunds, 200);
  // The headline figure is what was actually sold in the day. Returns are reported on their own so
  // they can never quietly hide the day's takings.
  assert.equal(report.netSales, 1062 + 500);
  assert.equal(report.netAfterReturns, 1062 + 500 - 200);
  // Only the cash bill counts as money actually in the drawer.
  assert.equal(report.cashSales, 1062);
  assert.equal(report.cashCount, 1);
  assert.equal(report.creditOutstanding, 500);
});

test('udhar bills count in the daily sale total and are also broken out separately', () => {
  const db = seedData();
  db.sales.push({
    id: 'sale_credit_only',
    createdAt: new Date().toISOString(),
    paymentType: 'Credit',
    subtotal: 800,
    discount: 0,
    tax: 0,
    total: 800,
    paidAmount: 0,
    dueAmount: 800,
    voided: false,
    items: [{ name: 'Credit Item', qty: 1, price: 800, cost: 500 }]
  });
  const report = calculateReport(db, 'day');
  // The goods left the shop, so the bill is a sale and shows in the daily total.
  assert.equal(report.salesCount, 1);
  assert.equal(report.revenue, 800);
  assert.equal(report.netSales, 800);
  // ...but it must never be counted as cash in the drawer.
  assert.equal(report.cashSales, 0);
  assert.equal(report.cashCount, 0);
  assert.equal(report.collected, 0);
  assert.equal(report.creditCount, 1);
  assert.equal(report.creditSales, 800);
  assert.equal(report.creditOutstanding, 800);
});

test('partial payment counts as a sale, with only the unpaid part left on udhar', () => {
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
  assert.equal(report.salesCount, 1);
  assert.equal(report.netSales, 900);
  // Cash/card collected only counts the part that was actually received.
  assert.equal(report.cashSales, 400);
  assert.equal(report.creditCount, 1);
  assert.equal(report.creditOutstanding, 500);
});

test('a cash bill and an udhar bill both show in the daily sale, cash split correctly', () => {
  const db = seedData();
  const at = new Date().toISOString();
  db.sales.push({
    id: 'sale_cash', createdAt: at, paymentType: 'Cash', subtotal: 500, discount: 0, tax: 0,
    total: 500, paidAmount: 500, dueAmount: 0, voided: false,
    items: [{ name: 'Cash Item', qty: 1, price: 500, cost: 300 }]
  });
  db.sales.push({
    id: 'sale_udhar', createdAt: at, paymentType: 'Credit', subtotal: 700, discount: 0, tax: 0,
    total: 700, paidAmount: 0, dueAmount: 700, voided: false,
    items: [{ name: 'Udhar Item', qty: 1, price: 700, cost: 400 }]
  });
  const report = calculateReport(db, 'day');
  assert.equal(report.salesCount, 2);
  assert.equal(report.netSales, 1200);
  assert.equal(report.cashSales, 500);
  assert.equal(report.cashCount, 1);
  assert.equal(report.collected, 500);
  assert.equal(report.creditOutstanding, 700);
});

test('a day with more returns than sales still shows the day\'s takings', () => {
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
  const report = calculateReport(db, 'day');
  // Reporting zero sales here is what made the dashboard look empty on a day when the counter had
  // in fact sold, so the sale total stands on its own and the shortfall is reported next to it.
  assert.equal(report.netSales, 100);
  assert.equal(report.refunds, 400);
  assert.equal(report.netAfterReturns, -300);
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
  // A completed udhar bill is still a bill made today.
  assert.equal(stats.todayBills, 1);
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
