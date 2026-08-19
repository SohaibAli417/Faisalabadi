const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const root = path.join(__dirname, 'frontend');
const dbDir = path.join(__dirname, 'database');
const backupDir = path.join(dbDir, 'backups');
const dbFile = path.join(dbDir, 'pos-data.json');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

const sessions = new Map();
const loginAttempts = new Map();
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 8;
const permissions = {
  Admin: ['*'],
  Manager: ['dashboard', 'pos', 'products', 'inventory', 'purchases', 'customers', 'reports', 'settings', 'returns', 'backups'],
  Cashier: ['dashboard', 'pos', 'customers', 'reports:own', 'returns:create']
};

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
};

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function seedData() {
  return {
    meta: { createdAt: now(), updatedAt: now(), invoiceSeq: 1048 },
    settings: {
      storeName: 'Faislabadi General Store',
      phone: '0300-0000000',
      address: 'Main Bazaar, Faisalabad',
      taxRate: 0.18,
      currency: 'Rs',
      backupOnStartup: true
    },
    users: [
      { id: 'usr_admin', name: 'Ahmed Hassan', email: 'admin@faislabadi.pk', phone: '0300-1111111', role: 'Admin', active: true, passwordHash: hashPassword('admin123') },
      { id: 'usr_manager', name: 'Mariam Noor', email: 'manager@faislabadi.pk', phone: '0300-2222222', role: 'Manager', active: true, passwordHash: hashPassword('manager123') },
      { id: 'usr_cashier', name: 'Sana Khan', email: 'cashier@faislabadi.pk', phone: '0300-3333333', role: 'Cashier', active: true, passwordHash: hashPassword('cashier123') }
    ],
    products: [
      { id: 'prd_1', name: 'Surf Excel 1kg', sku: '8961000100123', category: 'Household', price: 890, cost: 760, stock: 18, reorderLevel: 8, unit: 'pack', active: true },
      { id: 'prd_2', name: 'Dawn Bread Large', sku: '8964000765432', category: 'Bakery', price: 150, cost: 116, stock: 8, reorderLevel: 10, unit: 'pcs', active: true },
      { id: 'prd_3', name: 'Coca-Cola 1.5L', sku: '5449000000996', category: 'Beverages', price: 180, cost: 142, stock: 24, reorderLevel: 12, unit: 'bottle', active: true },
      { id: 'prd_4', name: 'National Salt 800g', sku: '8961014000352', category: 'Grocery', price: 95, cost: 73, stock: 4, reorderLevel: 15, unit: 'pack', active: true },
      { id: 'prd_5', name: 'Tapal Danedar 190g', sku: '8961008600725', category: 'Grocery', price: 385, cost: 316, stock: 11, reorderLevel: 8, unit: 'pack', active: true },
      { id: 'prd_6', name: "Olper's Milk 1L", sku: '8961008613992', category: 'Dairy', price: 310, cost: 276, stock: 6, reorderLevel: 10, unit: 'pack', active: true },
      { id: 'prd_7', name: 'Lays Masala 82g', sku: '8964001746256', category: 'Snacks', price: 85, cost: 61, stock: 31, reorderLevel: 20, unit: 'pcs', active: true },
      { id: 'prd_8', name: 'Lux Soap 125g', sku: '8901030895201', category: 'Personal Care', price: 145, cost: 112, stock: 3, reorderLevel: 10, unit: 'pcs', active: true }
    ],
    customers: [
      { id: 'cus_walkin', name: 'Walk-in Customer', phone: '', cnic: '', creditLimit: 0, balance: 0, active: true },
      { id: 'cus_1', name: 'Ali Raza', phone: '0301-2345678', cnic: '35202-1234567-1', creditLimit: 10000, balance: 4850, active: true },
      { id: 'cus_2', name: 'Ayesha Khan', phone: '0321-9087654', cnic: '', creditLimit: 8000, balance: 0, active: true },
      { id: 'cus_3', name: 'Usman Traders', phone: '0300-1122334', cnic: '35202-9876543-2', creditLimit: 25000, balance: 12600, active: true }
    ],
    suppliers: [
      { id: 'sup_1', name: 'Metro Wholesale', phone: '041-1111111', address: 'Faisalabad', active: true },
      { id: 'sup_2', name: 'Local Distributor', phone: '041-2222222', address: 'Main Market', active: true }
    ],
    purchases: [],
    sales: [],
    returns: [],
    stockMovements: [],
    auditLogs: []
  };
}

function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

function readDb() {
  ensureDir(dbDir);
  if (!fs.existsSync(dbFile)) {
    const data = seedData();
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
    return data;
  }
  return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}

function writeDb(db) {
  db.meta.updatedAt = now();
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function createBackup(reason = 'manual') {
  ensureDir(backupDir);
  const db = readDb();
  const stamp = now().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `pos-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ reason, backedUpAt: now(), data: db }, null, 2));
  return { file: path.basename(file), createdAt: now(), reason };
}

function restoreBackup(fileName, actor) {
  const safeName = path.basename(String(fileName || ''));
  if (!/^pos-backup-[\w.-]+\.json$/.test(safeName)) throw new Error('Invalid backup file name');
  const file = path.join(backupDir, safeName);
  if (!fs.existsSync(file)) throw new Error('Backup not found');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed.data || !parsed.data.meta || !Array.isArray(parsed.data.products) || !Array.isArray(parsed.data.users)) {
    throw new Error('Backup file is not a valid POS backup');
  }
  createBackup('before-restore');
  const restored = parsed.data;
  audit(restored, actor, 'restore', 'backup', safeName);
  writeDb(restored);
  return { file: safeName, restoredAt: now() };
}

function audit(db, actor, action, entity, entityId, details = {}) {
  db.auditLogs.unshift({
    id: uid('aud'),
    at: now(),
    actorId: actor?.id || 'system',
    actorName: actor?.name || 'System',
    action,
    entity,
    entityId,
    details
  });
  db.auditLogs = db.auditLogs.slice(0, 5000);
}

function json(response, status, payload, headers = {}) {
  response.writeHead(status, { ...securityHeaders, 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(payload));
}

function loginAllowed(key) {
  const at = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter(time => at - time < LOGIN_WINDOW_MS);
  if (attempts.length >= LOGIN_LIMIT) {
    loginAttempts.set(key, attempts);
    return false;
  }
  attempts.push(at);
  loginAttempts.set(key, attempts);
  return true;
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
  });
}

function getActor(request, db) {
  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - new Date(session.createdAt).getTime() > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  const user = db.users.find(item => item.id === session.userId && item.active);
  return user || null;
}

function can(actor, permission) {
  if (!actor) return false;
  const allowed = permissions[actor.role] || [];
  return allowed.includes('*') || allowed.includes(permission);
}

function requireActor(request, response, db, permission) {
  const actor = getActor(request, db);
  if (!actor) {
    json(response, 401, { error: 'Authentication required' });
    return null;
  }
  if (permission && !can(actor, permission)) {
    json(response, 403, { error: 'Permission denied' });
    return null;
  }
  return actor;
}

function money(value) {
  return Math.round(Number(value || 0));
}

function periodStart(period) {
  const date = new Date();
  if (period === 'year') return new Date(date.getFullYear(), 0, 1);
  if (period === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function calculateReport(db, period = 'day') {
  const start = periodStart(period).getTime();
  const sales = db.sales.filter(sale => !sale.voided && new Date(sale.createdAt).getTime() >= start);
  const returns = db.returns.filter(item => new Date(item.createdAt).getTime() >= start);
  const totals = sales.reduce((acc, sale) => {
    acc.revenue += sale.subtotal;
    acc.discount += sale.discount;
    acc.tax += sale.tax;
    acc.total += sale.total;
    acc.cost += sale.items.reduce((sum, item) => sum + money(item.cost) * Number(item.qty || 0), 0);
    if (sale.paymentType === 'Credit') acc.credit += sale.total;
    return acc;
  }, { revenue: 0, discount: 0, tax: 0, total: 0, cost: 0, credit: 0 });
  const refundTotal = returns.reduce((sum, item) => sum + item.total, 0);
  return {
    period,
    salesCount: sales.length,
    revenue: money(totals.revenue),
    discounts: money(totals.discount),
    tax: money(totals.tax),
    grossProfit: money(totals.revenue - totals.cost - totals.discount),
    netSales: money(totals.total - refundTotal),
    creditSales: money(totals.credit),
    refunds: money(refundTotal)
  };
}

function lowStock(db) {
  return db.products.filter(product => product.active && Number(product.stock) <= Number(product.reorderLevel || 0));
}

function maskCnic(cnic) {
  if (!cnic) return '';
  const digits = String(cnic).replace(/\D/g, '');
  if (digits.length < 5) return '*****';
  return `${digits.slice(0, 3)}********${digits.slice(-2)}`;
}

function nextInvoice(db) {
  db.meta.invoiceSeq += 1;
  return `FS-${db.meta.invoiceSeq}`;
}

function createSale(db, payload, actor, source = 'online') {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('Sale must include at least one item');
  const saleItems = items.map(item => {
    if (item.productId) {
      const product = db.products.find(row => row.id === item.productId && row.active);
      if (!product) throw new Error(`Product not found: ${item.productId}`);
      const qty = Number(item.qty || 1);
      if (qty <= 0) throw new Error('Quantity must be positive');
      if (Number(product.stock) < qty) throw new Error(`${product.name} has insufficient stock`);
      product.stock = Number(product.stock) - qty;
      db.stockMovements.unshift({ id: uid('stm'), at: now(), productId: product.id, type: 'sale', qty: -qty, note: 'POS sale' });
      return { productId: product.id, name: product.name, sku: product.sku, unit: product.unit, qty, price: money(item.price ?? product.price), cost: money(product.cost), manual: false };
    }
    const qty = Number(item.qty || 1);
    const price = money(item.price);
    if (!item.name || qty <= 0 || price <= 0) throw new Error('Manual items require name, price, and quantity');
    return { productId: null, name: String(item.name).trim(), sku: '', unit: item.unit || 'pcs', qty, price, cost: money(item.cost), manual: true };
  });
  const subtotal = money(saleItems.reduce((sum, item) => sum + item.price * item.qty, 0));
  const discount = Math.min(money(payload.discount), subtotal);
  const taxable = Math.max(0, subtotal - discount);
  const taxRate = Number(payload.taxRate ?? db.settings.taxRate);
  const tax = money(taxable * taxRate);
  const total = taxable + tax;
  const customerId = payload.customerId || 'cus_walkin';
  const paymentType = payload.paymentType || 'Cash';
  if (paymentType === 'Credit' && customerId !== 'cus_walkin') {
    const customer = db.customers.find(item => item.id === customerId);
    if (customer) customer.balance = money(customer.balance + total);
  }
  const sale = {
    id: uid('sal'),
    clientId: payload.clientId || null,
    invoiceNo: nextInvoice(db),
    createdAt: now(),
    createdBy: actor.id,
    customerId,
    paymentType,
    source,
    items: saleItems,
    subtotal,
    discount,
    taxRate,
    tax,
    total,
    paidAmount: money(payload.paidAmount ?? total),
    voided: false
  };
  db.sales.unshift(sale);
  audit(db, actor, 'create', 'sale', sale.id, { invoiceNo: sale.invoiceNo, total });
  return sale;
}

function csv(rows) {
  return rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

async function handleApi(request, response) {
  const db = readDb();
  const url = new URL(request.url, `http://${request.headers.host}`);
  const method = request.method;

  try {
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      const rateKey = `${request.socket.remoteAddress || 'local'}:${String(request.headers['user-agent'] || '').slice(0, 80)}`;
      if (!loginAllowed(rateKey)) return json(response, 429, { error: 'Too many login attempts. Try again later.' });
      const body = await parseBody(request);
      const login = String(body.login || '').toLowerCase();
      const user = db.users.find(item => item.active && [item.email.toLowerCase(), item.phone].includes(login));
      if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
        return json(response, 401, { error: 'Invalid login credentials' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { userId: user.id, createdAt: now() });
      audit(db, user, 'login', 'user', user.id);
      writeDb(db);
      return json(response, 200, { token, user: sanitizeUser(user), permissions: permissions[user.role] || [] });
    }

    if (method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true, at: now() });

    const actor = requireActor(request, response, db);
    if (!actor) return;

    if (method === 'GET' && url.pathname === '/api/bootstrap') {
      return json(response, 200, {
        user: sanitizeUser(actor),
        settings: db.settings,
        products: db.products,
        customers: db.customers.map(item => ({ ...item, cnicMasked: maskCnic(item.cnic), cnic: undefined })),
        suppliers: db.suppliers,
        sales: db.sales.slice(0, 50),
        returns: db.returns.slice(0, 50),
        lowStock: lowStock(db),
        reports: { day: calculateReport(db, 'day'), month: calculateReport(db, 'month'), year: calculateReport(db, 'year') }
      });
    }

    if (method === 'GET' && url.pathname === '/api/dashboard') {
      return json(response, 200, {
        day: calculateReport(db, 'day'),
        month: calculateReport(db, 'month'),
        year: calculateReport(db, 'year'),
        lowStock: lowStock(db),
        recentSales: db.sales.slice(0, 10),
        creditCustomers: db.customers.filter(item => item.balance > 0).map(item => ({ ...item, cnicMasked: maskCnic(item.cnic), cnic: undefined }))
      });
    }

    if (method === 'GET' && url.pathname === '/api/products') {
      const q = String(url.searchParams.get('q') || '').toLowerCase();
      const products = db.products.filter(item => !q || `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(q));
      return json(response, 200, products);
    }

    if (method === 'POST' && url.pathname === '/api/products') {
      if (!can(actor, 'products')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const product = { id: uid('prd'), active: true, stock: 0, reorderLevel: 5, unit: 'pcs', category: 'General', ...body };
      product.price = money(product.price);
      product.cost = money(product.cost);
      product.stock = Number(product.stock || 0);
      db.products.unshift(product);
      audit(db, actor, 'create', 'product', product.id, { name: product.name });
      writeDb(db);
      return json(response, 201, product);
    }

    if (method === 'PUT' && url.pathname.startsWith('/api/products/')) {
      if (!can(actor, 'products')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/').pop();
      const product = db.products.find(item => item.id === id);
      if (!product) return json(response, 404, { error: 'Product not found' });
      Object.assign(product, await parseBody(request));
      product.price = money(product.price);
      product.cost = money(product.cost);
      product.stock = Number(product.stock || 0);
      audit(db, actor, 'update', 'product', product.id, { name: product.name });
      writeDb(db);
      return json(response, 200, product);
    }

    if (method === 'GET' && url.pathname === '/api/customers') {
      return json(response, 200, db.customers.map(item => ({ ...item, cnicMasked: maskCnic(item.cnic), cnic: undefined })));
    }

    if (method === 'POST' && url.pathname === '/api/customers') {
      if (!can(actor, 'customers')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const customer = { id: uid('cus'), name: body.name, phone: body.phone || '', cnic: body.cnic || '', creditLimit: money(body.creditLimit), balance: money(body.balance), active: true };
      db.customers.unshift(customer);
      audit(db, actor, 'create', 'customer', customer.id, { name: customer.name });
      writeDb(db);
      return json(response, 201, { ...customer, cnicMasked: maskCnic(customer.cnic), cnic: undefined });
    }

    if (method === 'POST' && url.pathname === '/api/sales') {
      if (!can(actor, 'pos')) return json(response, 403, { error: 'Permission denied' });
      const sale = createSale(db, await parseBody(request), actor, 'online');
      writeDb(db);
      return json(response, 201, sale);
    }

    if (method === 'POST' && url.pathname === '/api/sync') {
      if (!can(actor, 'pos')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const queuedSales = Array.isArray(body.sales) ? body.sales : [];
      const results = [];
      for (const queued of queuedSales) {
        const existing = db.sales.find(sale => sale.clientId && sale.clientId === queued.clientId);
        if (existing) results.push({ clientId: queued.clientId, status: 'duplicate', sale: existing });
        else results.push({ clientId: queued.clientId, status: 'created', sale: createSale(db, queued, actor, 'offline-sync') });
      }
      writeDb(db);
      return json(response, 200, { results });
    }

    if (method === 'POST' && url.pathname.match(/^\/api\/sales\/[^/]+\/void$/)) {
      if (!can(actor, 'returns')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/')[3];
      const sale = db.sales.find(item => item.id === id || item.invoiceNo === id);
      if (!sale) return json(response, 404, { error: 'Sale not found' });
      if (sale.voided) return json(response, 409, { error: 'Sale already voided' });
      sale.voided = true;
      sale.voidedAt = now();
      sale.voidedBy = actor.id;
      for (const item of sale.items) {
        if (!item.productId) continue;
        const product = db.products.find(row => row.id === item.productId);
        if (product) product.stock = Number(product.stock) + Number(item.qty);
      }
      audit(db, actor, 'void', 'sale', sale.id, { invoiceNo: sale.invoiceNo });
      writeDb(db);
      return json(response, 200, sale);
    }

    if (method === 'POST' && url.pathname === '/api/returns') {
      if (!can(actor, 'returns:create') && !can(actor, 'returns')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const sale = db.sales.find(item => item.id === body.saleId || item.invoiceNo === body.invoiceNo);
      if (!sale) return json(response, 404, { error: 'Sale not found' });
      const refundItems = Array.isArray(body.items) && body.items.length ? body.items : sale.items;
      const total = money(refundItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0));
      for (const item of refundItems) {
        if (!item.productId) continue;
        const product = db.products.find(row => row.id === item.productId);
        if (product) product.stock = Number(product.stock) + Number(item.qty || 0);
      }
      const refund = { id: uid('ret'), saleId: sale.id, invoiceNo: sale.invoiceNo, createdAt: now(), createdBy: actor.id, items: refundItems, total, reason: body.reason || 'Customer return' };
      db.returns.unshift(refund);
      audit(db, actor, 'create', 'return', refund.id, { invoiceNo: sale.invoiceNo, total });
      writeDb(db);
      return json(response, 201, refund);
    }

    if (method === 'GET' && url.pathname === '/api/reports') {
      const period = url.searchParams.get('period') || 'day';
      return json(response, 200, calculateReport(db, period));
    }

    if (method === 'GET' && url.pathname === '/api/reports/export.csv') {
      const rows = [['Invoice', 'Date', 'Customer', 'Payment', 'Subtotal', 'Discount', 'Tax', 'Total']];
      for (const sale of db.sales) {
        const customer = db.customers.find(item => item.id === sale.customerId);
        rows.push([sale.invoiceNo, sale.createdAt, customer?.name || 'Walk-in Customer', sale.paymentType, sale.subtotal, sale.discount, sale.tax, sale.total]);
      }
      response.writeHead(200, { 'Content-Type': types['.csv'], 'Content-Disposition': 'attachment; filename="sales-report.csv"' });
      return response.end(csv(rows));
    }

    if (method === 'GET' && url.pathname === '/api/purchases') return json(response, 200, db.purchases);

    if (method === 'POST' && url.pathname === '/api/purchases') {
      if (!can(actor, 'purchases')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const items = Array.isArray(body.items) ? body.items : [];
      const purchase = { id: uid('pur'), supplierId: body.supplierId, createdAt: now(), createdBy: actor.id, items, total: 0 };
      for (const item of items) {
        const product = db.products.find(row => row.id === item.productId);
        if (!product) continue;
        const qty = Number(item.qty || 0);
        const cost = money(item.cost ?? product.cost);
        product.stock = Number(product.stock) + qty;
        product.cost = cost;
        purchase.total += qty * cost;
        db.stockMovements.unshift({ id: uid('stm'), at: now(), productId: product.id, type: 'purchase', qty, note: 'Supplier purchase' });
      }
      db.purchases.unshift(purchase);
      audit(db, actor, 'create', 'purchase', purchase.id, { total: purchase.total });
      writeDb(db);
      return json(response, 201, purchase);
    }

    if (method === 'GET' && url.pathname === '/api/suppliers') return json(response, 200, db.suppliers);

    if (method === 'GET' && url.pathname === '/api/audit-logs') {
      if (!can(actor, 'settings')) return json(response, 403, { error: 'Permission denied' });
      return json(response, 200, db.auditLogs.slice(0, 200));
    }

    if (method === 'GET' && url.pathname === '/api/backups') {
      if (!can(actor, 'backups')) return json(response, 403, { error: 'Permission denied' });
      ensureDir(backupDir);
      const backups = fs.readdirSync(backupDir).filter(name => name.endsWith('.json')).sort().reverse();
      return json(response, 200, backups.map(file => ({ file })));
    }

    if (method === 'POST' && url.pathname === '/api/backups') {
      if (!can(actor, 'backups')) return json(response, 403, { error: 'Permission denied' });
      const backup = createBackup('manual');
      audit(db, actor, 'create', 'backup', backup.file);
      writeDb(db);
      return json(response, 201, backup);
    }

    if (method === 'POST' && url.pathname.match(/^\/api\/backups\/[^/]+\/restore$/)) {
      if (!can(actor, 'backups')) return json(response, 403, { error: 'Permission denied' });
      const file = decodeURIComponent(url.pathname.split('/')[3]);
      const restored = restoreBackup(file, actor);
      return json(response, 200, restored);
    }

    json(response, 404, { error: 'API route not found' });
  } catch (error) {
    json(response, 400, { error: error.message || 'Request failed' });
  }
}

function serveStatic(request, response) {
  const requested = request.url === '/' ? 'index.html' : decodeURIComponent(request.url).replace(/^\/+/, '');
  const file = path.resolve(root, requested);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return response.writeHead(403, securityHeaders).end('Forbidden');
  fs.readFile(file, (error, content) => {
    if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500, securityHeaders).end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
    response.writeHead(200, { ...securityHeaders, 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(content);
  });
}

function requestHandler(request, response) {
  if (request.url.startsWith('/api/')) return handleApi(request, response);
  return serveStatic(request, response);
}

function createServer() {
  ensureDir(dbDir);
  ensureDir(backupDir);
  if (!fs.existsSync(dbFile)) writeDb(seedData());
  createBackup('startup');
  return http.createServer(requestHandler);
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`Faislabadi POS is running on http://localhost:${PORT}`));
}

module.exports = requestHandler;
module.exports.createServer = createServer;
module.exports.readDb = readDb;
module.exports.writeDb = writeDb;
module.exports.seedData = seedData;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.calculateReport = calculateReport;
module.exports.maskCnic = maskCnic;
module.exports.restoreBackup = restoreBackup;
