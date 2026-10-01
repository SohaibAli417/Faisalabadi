const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readDb, writeDb: saveDb, readLocalDb, writeLocalDb, readCloudDb, writeCloudDb, readAuthData, recallLastGoodAuth, useSupabase, MODE, withDbLock, listCloudBackups, saveCloudBackup, loadCloudBackup } = require('./database');
const { mergeDbs } = require('./sync');

const PORT = Number(process.env.PORT || 3000);
const root = path.join(__dirname, 'frontend');
const backupDir = process.env.VERCEL ? path.join('/tmp', 'faislabadi-pos', 'backups') : path.join(__dirname, 'database', 'backups');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const loginAttempts = new Map();
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 8;
const permissions = {
  Admin: ['*'],
  Manager: ['dashboard', 'pos', 'products', 'inventory', 'warehouse', 'purchases', 'customers', 'udhar', 'returns', 'reports', 'settings', 'backups'],
  Cashier: ['dashboard', 'pos', 'customers', 'reports:own', 'returns:create']
};

const isVercel = !!process.env.VERCEL;

const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 15000);
const cloudSync = {
  enabled: useSupabase && MODE === 'local-first',
  running: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null
};

async function syncWithCloud() {
  if (!cloudSync.enabled || cloudSync.running) return;
  cloudSync.running = true;
  cloudSync.lastAttemptAt = now();
  try {
    let cloud = null;
    try {
      cloud = await Promise.race([
        readCloudDb(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 6000))
      ]);
    } catch (error) {
      cloudSync.lastError = `Cloud unreachable, will retry (${error.message})`;
      return;
    }
    await withDbLock(async () => {
      const local = await readLocalDb();
      if (!local) return;
      if (!cloud) {
        await writeCloudDb(local);
        cloudSync.lastSuccessAt = now();
        cloudSync.lastError = null;
        return;
      }
      const { merged, localChanged, cloudChanged } = mergeDbs(local, cloud, { sessionTtlMs: SESSION_TTL_MS });
      if (localChanged) await writeLocalDb(merged);
      if (localChanged || cloudChanged) await writeCloudDb(merged);
      cloudSync.lastSuccessAt = now();
      cloudSync.lastError = null;
    });
  } catch (error) {
    cloudSync.lastError = error.message;
  } finally {
    cloudSync.running = false;
  }
}
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; connect-src 'self'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
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

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// Stock moves in a product's base unit, so quantities need a decimal place finer than money:
// 500 gram is 0.5 kg and 1 kg split into three bills must not drift to 0.33 + 0.33 + 0.33.
function round3(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Password must include letters and numbers.';
  return '';
}

function seedData() {
  const adminPw = generateInitialPassword();
  const managerPw = generateInitialPassword();
  console.log('=== FRESH DATABASE - generated initial passwords ===');
  console.log(`Admin:   Sohaib Ali  / ${adminPw}`);
  console.log(`Manager: Akmal       / ${managerPw}`);
  console.log('CHANGE THESE PASSWORDS after first login!');
  console.log('====================================================');
  return {
    meta: { createdAt: now(), updatedAt: now(), invoiceSeq: 1048 },
    settings: {
      storeName: 'Faislabadi General Store',
      phone: '03024503010',
      address: 'Fazlia Colony, Opposite Ali Internet Service',
      taxRate: 0.18,
      currency: 'Rs',
      backupOnStartup: true
    },
    users: [
      { id: 'usr_sohaib', name: 'Sohaib Ali', email: 'sohaib@faislabadi.pk', phone: '03074224449', role: 'Admin', active: true, passwordHash: hashPassword(adminPw) },
      { id: 'usr_akmal', name: 'Akmal', email: 'akmal@faislabadi.pk', phone: '03024503010', role: 'Manager', active: true, passwordHash: hashPassword(managerPw) }
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

function ensureSchema(db) {
  let changed = false;
  if (!Array.isArray(db.customers)) { db.customers = []; changed = true; }
  if (!Array.isArray(db.products)) { db.products = []; changed = true; }
  if (!Array.isArray(db.warehouses)) { db.warehouses = []; changed = true; }
  if (!Array.isArray(db.sales)) { db.sales = []; changed = true; }
  if (!Array.isArray(db.returns)) { db.returns = []; changed = true; }
  if (!Array.isArray(db.payments)) { db.payments = []; changed = true; }
  // udharEntries holds manually entered udhar rows. Existing customers have none, so this only
  // adds an empty list - no existing record, balance or history is touched.
  if (!Array.isArray(db.udharEntries)) { db.udharEntries = []; changed = true; }
  if (!Array.isArray(db.stockMovements)) { db.stockMovements = []; changed = true; }
  if (!Array.isArray(db.drafts)) { db.drafts = []; changed = true; }
  if (!db.meta || typeof db.meta !== 'object') { db.meta = { createdAt: now(), updatedAt: now(), invoiceSeq: 0 }; changed = true; }
  for (const customer of db.customers) {
    if (!('address' in customer)) { customer.address = ''; changed = true; }
    if (!('active' in customer)) { customer.active = true; changed = true; }
  }
  for (const product of db.products) {
    if (!('barcode' in product)) { product.barcode = ''; changed = true; }
    if (!('image' in product)) { product.image = ''; changed = true; }
    if (!('category' in product) || !product.category) { product.category = 'General'; changed = true; }
    if (!('reorderLevel' in product)) { product.reorderLevel = 5; changed = true; }
    if (!('location' in product)) { product.location = ''; changed = true; }
    if (!('active' in product)) { product.active = true; changed = true; }
    if (!('status' in product)) { product.status = product.active === false ? 'inactive' : 'active'; changed = true; }
    if (!('kgPerBoree' in product)) { product.kgPerBoree = 0; changed = true; }
    if (!('pcsPerCarton' in product)) { product.pcsPerCarton = 0; changed = true; }
  }
  for (const sale of db.sales) {
    if (!('paidAmount' in sale)) { sale.paidAmount = (sale.paymentType === 'Credit' || sale.paymentType === 'Partial') ? 0 : money(sale.total); changed = true; }
    if (!('dueAmount' in sale)) { sale.dueAmount = Math.max(0, money(sale.total) - money(sale.paidAmount)); changed = true; }
    if (!('returnStatus' in sale)) { sale.returnStatus = 'none'; changed = true; }
  }
  for (const wh of db.warehouses) {
    if (!('location' in wh)) { wh.location = ''; changed = true; }
    if (!('active' in wh)) { wh.active = true; changed = true; }
    if (!('status' in wh)) { wh.status = 'active'; changed = true; }
    if (!('supplier' in wh)) { wh.supplier = ''; changed = true; }
    if (!('kgPerBoree' in wh)) { wh.kgPerBoree = 0; changed = true; }
    if (!('pcsPerCarton' in wh)) { wh.pcsPerCarton = 0; changed = true; }
  }
  return changed;
}

function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

const coreSettings = { storeName: 'Faislabadi General Store', phone: '03024503010', address: 'Fazlia Colony, Opposite Ali Internet Service' };

function generateInitialPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pw = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

function ensureCoreAccounts(db) {
  let changed = false;
  if (!Array.isArray(db.users)) db.users = [];
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (db.users.length === 0) {
    const adminPw = generateInitialPassword();
    const managerPw = generateInitialPassword();
    db.users = [
      { id: 'usr_admin', name: 'Admin', email: 'admin@faislabadi.pk', phone: '', role: 'Admin', active: true, passwordHash: hashPassword(adminPw) },
      { id: 'usr_manager', name: 'Manager', email: 'manager@faislabadi.pk', phone: '', role: 'Manager', active: true, passwordHash: hashPassword(managerPw) }
    ];
    db.sessions = {};
    console.log('=== FIRST RUN - Initial accounts created ===');
    console.log(`Admin:    admin@faislabadi.pk / ${adminPw}`);
    console.log(`Manager:  manager@faislabadi.pk / ${managerPw}`);
    console.log('CHANGE THESE PASSWORDS IMMEDIATELY after first login!');
    console.log('===============================================');
    changed = true;
  }
  for (const [key, value] of Object.entries(coreSettings)) {
    if (db.settings[key] !== value) {
      db.settings[key] = value;
      changed = true;
    }
  }
  return changed;
}

const { readDbSync, writeDbSync, backupDir: configuredBackupDir } = require('./database');
const resolvedBackupDir = configuredBackupDir || backupDir;

async function createBackup(reason = 'manual') {
  const db = await readDb();
  const stamp = now().replace(/[:.]/g, '_');
  const file = `pos-backup-${stamp}.json`;
  if (isVercel && useSupabase) {
    await saveCloudBackup(file, reason, db);
  } else {
    ensureDir(backupDir);
    const localFile = path.join(backupDir, file);
    fs.writeFileSync(localFile, JSON.stringify({ reason, backedUpAt: now(), data: db }, null, 2));
  }
  return { file, createdAt: now(), reason };
}

async function restoreBackup(fileName, actor) {
  const safeName = path.basename(String(fileName || ''));
  if (!/^pos-backup-[\w.-]+\.json$/.test(safeName)) throw new Error('Invalid backup file name');
  let parsed;
  if (isVercel && useSupabase) {
    const data = await loadCloudBackup(safeName);
    parsed = { data };
  } else {
    const file = path.join(backupDir, safeName);
    if (!fs.existsSync(file)) throw new Error('Backup not found');
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  if (!parsed.data || !parsed.data.meta || !Array.isArray(parsed.data.products) || !Array.isArray(parsed.data.users)) {
    throw new Error('Backup file is not a valid POS backup');
  }
  await createBackup('before-restore');
  const restored = parsed.data;
  restored.sessions = {};
  audit(restored, actor, 'restore', 'backup', safeName);
  await saveDb(restored);
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

function getSessions(db) {
  if (!db.sessions || typeof db.sessions !== 'object' || Array.isArray(db.sessions)) db.sessions = {};
  return db.sessions;
}

function pruneSessions(db) {
  const store = getSessions(db);
  for (const token of Object.keys(store)) {
    const session = store[token];
    if (!session || Date.now() - new Date(session.createdAt).getTime() > SESSION_TTL_MS) delete store[token];
  }
  return store;
}

function getActor(request, db) {
  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const store = getSessions(db);
  let session = store[hashToken(token)];
  if (!session && store[token]) {
    session = store[token];
    delete store[token];
    store[hashToken(token)] = session;
  }
  if (!session) return null;
  if (Date.now() - new Date(session.createdAt).getTime() > SESSION_TTL_MS) {
    delete getSessions(db)[hashToken(token)];
    return null;
  }
  const user = db.users.find(item => item.id === session.userId && item.active);
  return user || null;
}

function can(actor, permission) {
  if (!actor) return false;
  if (Array.isArray(actor.permissions)) {
    return actor.permissions.includes('*') || actor.permissions.includes(permission);
  }
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

function safeMoney(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

// A rate can be a fraction of a rupee: billing a Rs 100/kg product per gram means Rs 0.1/gram, and
// a cheap product can be well under one paisa per gram. Rounding a rate to whole rupees (as
// money() does) would turn those into 0, so rates keep four decimals while totals stay in rupees.
function safeRate(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : fallback;
}

function resolveProductPricing(input) {
  const cost = money(input.cost);
  const explicitPrice = input.price !== undefined && input.price !== null && String(input.price).trim() !== '';
  if (explicitPrice) return { cost, price: money(input.price) };
  const profitType = input.profitType === 'percent' ? 'percent' : 'amount';
  const profitValue = Number(input.profitValue || 0);
  const price = profitType === 'percent' ? cost * (1 + profitValue / 100) : cost + profitValue;
  return { cost, price: money(price) };
}

function periodStart(period) {
  const date = new Date();
  if (period === 'year') return new Date(date.getFullYear(), 0, 1);
  if (period === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isCreditSale(sale) {
   if (!sale) return false;
   if (sale.paymentType === 'Credit') return true;
   // A partial payment leaves the rest on udhar, so it is not a cash/card sale either.
   if (sale.paymentType === 'Partial') return Number(sale.dueAmount || 0) > 0;
   return false;
}

function salePaidAmount(sale) {
  if (sale.paidAmount === undefined || sale.paidAmount === null || sale.paidAmount === '') {
    // Older records may predate paidAmount - a credit bill paid nothing, anything else was settled in full.
    return isCreditSale(sale) ? 0 : money(sale.total);
  }
  return money(sale.paidAmount);
}

function calculateReport(db, period = 'day') {
  const start = periodStart(period).getTime();
  const periodSales = db.sales.filter(sale => !sale.voided && new Date(sale.createdAt).getTime() >= start);
  // Every completed bill counts as a sale for the period, including udhar bills - the goods left
  // the shop, so the sale happened. Udhar is broken out separately into creditSales/cashSales so the
  // cash-in-drawer figure is never inflated by money that has not actually been received yet.
  const totals = periodSales.reduce((acc, sale) => {
    acc.revenue += sale.subtotal;
    acc.discount += sale.discount;
    acc.tax += sale.tax;
    acc.total += sale.total;
    acc.cost += sale.items.reduce((sum, item) => sum + money(item.cost) * Number(item.qty || 0), 0);
    acc.collected += Math.max(0, salePaidAmount(sale) - money(sale.refunded || 0));
    if (isCreditSale(sale)) acc.udharDue += Math.max(0, money(sale.dueAmount));
    return acc;
  }, { revenue: 0, discount: 0, tax: 0, total: 0, cost: 0, collected: 0, udharDue: 0 });
  const creditBills = periodSales.filter(isCreditSale);
  const returns = db.returns.filter(item => new Date(item.createdAt).getTime() >= start);
  const refundTotal = returns.reduce((sum, item) => sum + item.total, 0);
  return {
    period,
    salesCount: periodSales.length,
    revenue: money(totals.revenue),
    discounts: money(totals.discount),
    tax: money(totals.tax),
    grossProfit: money(totals.revenue - totals.cost - totals.discount),
    netSales: Math.max(0, money(totals.total - refundTotal)),
    cashSales: money(totals.collected),
    cashCount: periodSales.length - creditBills.length,
    collected: money(totals.collected),
    creditSales: money(creditBills.reduce((sum, sale) => sum + money(sale.total), 0)),
    creditCount: creditBills.length,
    creditOutstanding: money(totals.udharDue),
    refunds: money(refundTotal)
  };
}

function dashboardStats(db) {
  const customers = db.customers.filter(item => item.id !== 'cus_walkin');
  const udharRows = customers.filter(item => money(item.balance) > 0);
  const day = calculateReport(db, 'day');
  return {
    totalProducts: db.products.filter(item => item.active !== false && item.status !== 'inactive').length,
    totalStockItems: db.products.length,
    totalUnits: Math.round(db.products.reduce((sum, item) => sum + Number(item.stock || 0), 0)),
    lowStockCount: lowStock(db).length,
    warehouseItems: (db.warehouses || []).length,
    totalCustomers: customers.length,
    udharCustomers: udharRows.length,
    totalUdhar: money(udharRows.reduce((sum, item) => sum + Math.max(0, money(item.balance)), 0)),
    todayBills: day.salesCount,
    todayCreditBills: day.creditCount
  };
}

function lowStock(db) {
  return db.products.filter(product => product.active && Number(product.stock) <= Number(product.reorderLevel || 0));
}

// Converts a warehouse pack count (boree / carton) into the product's sellable unit.
function convertPackQty(qty, mode, source) {
   const amount = Number(qty);
   if (!Number.isFinite(amount) || amount <= 0) return { qty: 0, factor: 0, label: '' };
   if (mode === 'boree') {
   const factor = Number((source && source.kgPerBoree) || 0);
   // A missing pack spec must not silently fall back to 1:1 - callers reject factor 0.
   return factor > 0 ? { qty: round2(amount * factor), factor, label: 'boree' } : { qty: 0, factor: 0, label: 'boree' };
   }
   if (mode === 'carton') {
   const factor = Number((source && source.pcsPerCarton) || 0);
   return factor > 0 ? { qty: round2(amount * factor), factor, label: 'carton' } : { qty: 0, factor: 0, label: 'carton' };
   }
   return { qty: round2(amount), factor: 1, label: '' };
}

// Units that share one dimension, with how many base units each one is worth.
// Stock is always stored in the product's own base unit (product.unit), so anything the cashier
// enters in another unit has to be converted before it touches stock, and the rate has to move the
// opposite way. Without this, 500 gram priced per kg silently bills 500 x the kg rate.
const UNIT_FACTORS = {
  kg: 1,
  gram: 0.001,
  litre: 1,
  meter: 1,
  pcs: 1,
  pack: 1,
  box: 1,
  dozen: 1,
  boree: 1
};
// Which kind of thing a unit measures. Only units of the same dimension have a known conversion, so
// billing a litre product in gram is refused rather than treated as 1:1 - a silent 1:1 would take
// 1 litre of stock for a line that claims to be 1 gram.
const UNIT_DIMENSIONS = {
  kg: 'weight',
  gram: 'weight',
  litre: 'volume',
  meter: 'length',
  pcs: 'count',
  pack: 'count',
  box: 'count',
  dozen: 'count',
  boree: 'count'
};
const unitFactor = unit => {
  const key = String(unit == null ? '' : unit).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UNIT_FACTORS, key) ? UNIT_FACTORS[key] : null;
};
const unitDimension = unit => {
  const key = String(unit == null ? '' : unit).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UNIT_DIMENSIONS, key) ? UNIT_DIMENSIONS[key] : null;
};
// True when the two units can be converted, or when either side is a custom unit the app has never
// heard of (those stay 1:1, exactly as before this change).
const unitsCompatible = (unit, baseUnit) => {
  const from = unitDimension(unit);
  const to = unitDimension(baseUnit);
  if (!from || !to) return true;
  return from === to;
};
// How many base units one `unit` represents. Unknown units are treated as 1:1 rather than 0, so a
// custom unit never turns a sale into zero.
const unitToBase = (unit, baseUnit) => {
  const from = unitFactor(unit);
  const to = unitFactor(baseUnit);
  if (!from || !to) return 1;
  return from / to;
};
// Quantity expressed in the product's base unit. `round3` keeps 500 gram as 0.5 kg, not 0.
const qtyToBase = (qty, unit, baseUnit) => round3(Number(qty || 0) * unitToBase(unit, baseUnit));
// The stock movement size for a stored sale line. New rows carry baseQty; rows saved before unit
// conversion are recomputed from the billed unit, so old bills still restock the right amount.
const stockQtyFor = (item, product) => {
  if (item && item.baseQty !== undefined && item.baseQty !== null) return round3(Number(item.baseQty));
  return qtyToBase(item && item.qty, item && item.unit, product && product.unit);
};
// Rate expressed per `unit`. One unit is `unitToBase(unit, baseUnit)` base units, so the rate scales
// the same way the quantity does: Rs 100/kg is Rs 0.1/gram. Rates keep decimals here instead of
// going through money(), which rounds to whole rupees.
const priceToUnit = (price, unit, baseUnit) => {
  return safeRate(Number(price || 0) * unitToBase(unit, baseUnit));
};

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
      // The cashier may bill in a different unit than the one stock is kept in (gram on a kg
      // product). Stock lives in the product's base unit, so the check and the decrement both use
      // the converted quantity - otherwise 500 gram would look like 500 kg of stock.
      const unit = String(item.unit || product.unit || 'pcs').trim() || product.unit || 'pcs';
      if (!unitsCompatible(unit, product.unit)) {
        throw new Error(`${product.name} is stocked in ${product.unit}, so it cannot be billed in ${unit}`);
      }
      const baseQty = qtyToBase(qty, unit, product.unit);
      if (baseQty <= 0) throw new Error('Quantity must be positive');
      if (Number(product.stock) < baseQty) {
        throw new Error(`${product.name} has insufficient stock (available: ${round3(product.stock)} ${product.unit})`);
      }
      return { productId: product.id, name: product.name, sku: product.sku, unit, qty, baseQty, price: safeRate(item.price, product.price), cost: money(product.cost), manual: false };
    }
    const qty = Number(item.qty || 1);
    const price = safeRate(item.price);
    if (!item.name || qty <= 0 || price <= 0) throw new Error('Manual items require name, price, and quantity');
    return { productId: null, name: String(item.name).trim(), sku: item.sku || '', unit: item.unit || 'pcs', qty, price, cost: money(item.cost), manual: true };
  });
  const subtotal = money(saleItems.reduce((sum, item) => sum + item.price * item.qty, 0));
  const discountMain = Math.min(safeMoney(payload.discount), subtotal);
  const additionalDiscount = Math.min(safeMoney(payload.additionalDiscount), Math.max(0, subtotal - discountMain));
  const discount = money(discountMain + additionalDiscount);
  const taxable = Math.max(0, subtotal - discount);
  const taxRate = Number(payload.taxRate ?? db.settings.taxRate);
  const tax = money(taxable * taxRate);
  const total = taxable + tax;
  const customerId = payload.customerId || 'cus_walkin';
  const customer = db.customers.find(item => item.id === customerId);
  const paymentType = payload.paymentType || 'Cash';

  let paidAmount;
  // 'Partial' also leaves a due behind, so it must be able to carry a part payment.
  if (paymentType === 'Credit' || paymentType === 'Partial') {
    paidAmount = payload.paidAmount === undefined || payload.paidAmount === null || payload.paidAmount === ''
      ? 0 : money(payload.paidAmount);
  } else {
    paidAmount = total;
  }
  if (!(paidAmount > 0)) paidAmount = 0;
  if (paidAmount > total) paidAmount = total;
  const dueAmount = money(total - paidAmount);
  let receivedAmount = paidAmount;
  if (payload.receivedAmount !== undefined && payload.receivedAmount !== null && payload.receivedAmount !== '') {
    receivedAmount = Math.max(paidAmount, safeMoney(payload.receivedAmount, paidAmount));
  }

  if (dueAmount > 0) {
    if (!customer || customerId === 'cus_walkin') {
      throw new Error('Select a registered customer before leaving any amount as udhar');
    }
    const limit = Number(customer.creditLimit || 0);
    if (limit > 0 && money(customer.balance) + dueAmount > limit) {
      throw new Error(`Credit limit exceeded. ${customer.name} can take Rs ${money(limit - money(customer.balance))} more udhar.`);
    }
  }

  const delivery = (payload.delivery && typeof payload.delivery === 'object' && !Array.isArray(payload.delivery))
    ? Object.fromEntries(Object.entries(payload.delivery).filter(([, value]) => String(value ?? '').trim() !== ''))
    : null;

  const sale = {
    id: uid('sal'),
    clientId: payload.clientId || null,
    invoiceNo: nextInvoice(db),
    createdAt: now(),
    createdBy: actor.id,
    createdByName: actor.name || '',
    customerId,
    paymentType,
    source,
    items: saleItems,
    subtotal,
    discount,
    additionalDiscount,
    taxRate,
    tax,
    total,
    paidAmount,
    receivedAmount,
    dueAmount,
    reference: String(payload.reference ?? '').trim(),
    delivery: delivery && Object.keys(delivery).length ? delivery : null,
    returnStatus: 'none',
    voided: false
  };
  const changedAt = now();
  for (const item of saleItems) {
    if (item.productId) {
      const product = db.products.find(row => row.id === item.productId);
      if (product) {
        // Decrement by the base-unit quantity, not the number the cashier typed.
        const baseQty = item.baseQty !== undefined ? item.baseQty : item.qty;
        product.stock = round3(Number(product.stock) - baseQty);
        product._updatedAt = changedAt;
        db.stockMovements.unshift({ id: uid('stm'), at: changedAt, productId: product.id, type: 'sale', qty: -baseQty, unit: product.unit, note: 'POS sale' });
      }
    }
  }
  if (dueAmount > 0) {
    customer.balance = money(Number(customer.balance) + dueAmount);
    if (customer.recordedTotal !== undefined && customer.recordedTotal !== null && customer.recordedTotal !== '') {
      customer.recordedTotal = money(Number(customer.recordedTotal) + dueAmount);
    }
    customer._updatedAt = changedAt;
  }
  db.sales.unshift(sale);
  if (paidAmount > 0) {
    db.payments = [{ id: uid('pay'), customerId, amount: paidAmount, at: sale.createdAt, createdBy: actor.name || '', createdById: actor.id, saleId: sale.id, note: `Paid at billing (${sale.invoiceNo})`, _updatedAt: now() }, ...(db.payments || [])];
  }
  audit(db, actor, 'create', 'sale', sale.id, { invoiceNo: sale.invoiceNo, total, paid: paidAmount, due: dueAmount });
  return sale;
}

function itemKey(item) {
  return item.productId || `manual:${String(item.name || '').toLowerCase()}`;
}

function customerTotals(db) {
  const totals = {};
  const entry = id => totals[id] || (totals[id] = { creditPurchases: 0, totalPaid: 0, lastPaymentAt: null });
  for (const sale of db.sales) {
   if (sale.voided || sale.customerId === 'cus_walkin') continue;
   // Any bill that leaves a due behind is an udhar purchase - not just paymentType === 'Credit'.
   if (!isCreditSale(sale)) continue;
   entry(sale.customerId).creditPurchases += money(sale.total);
  }
  for (const payment of db.payments || []) {
    if (!payment.customerId || payment.customerId === 'cus_walkin' || payment.voided) continue;
    const totals = entry(payment.customerId);
    totals.totalPaid += money(payment.amount);
    const atMs = new Date(payment.at || 0).getTime();
    const prevMs = totals.lastPaymentAt ? new Date(totals.lastPaymentAt).getTime() : 0;
    if (atMs && atMs >= prevMs) totals.lastPaymentAt = payment.at;
  }
  // Manually entered udhar counts as a credit purchase too, otherwise the customer totals would
  // drift away from the balance the very same entries produce.
  for (const udhar of db.udharEntries || []) {
    if (udhar.voided || !udhar.customerId || udhar.customerId === 'cus_walkin') continue;
    entry(udhar.customerId).creditPurchases += money(udhar.amount);
  }
  return totals;
}

// Normalises a stored customer-profile product line. Keeps the unit it was entered in plus the
// per-unit rate and the product's own base unit, so the UI can re-price a line (2 kg -> 2000 gram)
// instead of showing a kilo rate against a gram quantity.
function productQtyUnit(item) {
  const qty = Number((item && item.qty) || 1);
  const unit = item && typeof item.unit === 'string' ? item.unit.trim().slice(0, 20) : '';
  const baseUnit = item && typeof item.baseUnit === 'string' ? item.baseUnit.trim().slice(0, 20) : '';
  const price = Number((item && item.price) || 0);
  return {
    qty: qty > 0 ? Math.round(qty * 1000) / 1000 : 1,
    unit,
    baseUnit,
    // A line with no stored price is linked to a real product, so take its current rate.
    price: price > 0 ? money(price) : 0
  };
}

function decorateCustomer(db, customer, totalsMap) {
  const totals = totalsMap[customer.id] || { creditPurchases: 0, totalPaid: 0, lastPaymentAt: null };
  let creditPurchases = money(totals.creditPurchases);
  let totalPaid = money(totals.totalPaid);
  let balance = money(customer.balance);
  if (hasRecordedValue(customer.recordedTotal)) creditPurchases = money(customer.recordedTotal);
  if (hasRecordedValue(customer.recordedPaid)) totalPaid = money(customer.recordedPaid);
  if (hasRecordedValue(customer.recordedTotal) && hasRecordedValue(customer.recordedPaid)) balance = Math.max(0, creditPurchases - totalPaid);
  let productList = [];
  if (Array.isArray(customer.products) && customer.products.length) {
    for (const item of customer.products) {
      const id = item && item.id ? String(item.id) : null;
      const name = String((item && (item.name || '')) || '').trim();
      if (!name) continue;
      if (id) {
        const linked = db.products.find(product => product.id === id);
        // Fill in the product's current rate and base unit when the line was saved without them.
        if (linked) {
          const normalised = productQtyUnit(item);
          productList.push({
            id: linked.id,
            name: linked.name,
            manual: false,
            ...normalised,
            baseUnit: normalised.baseUnit || linked.unit || '',
            price: normalised.price || money(linked.price)
          });
        } else productList.push({ id: null, name, manual: true, ...productQtyUnit(item) });
      } else {
        productList.push({ id: null, name, manual: true, ...productQtyUnit(item) });
      }
    }
  } else if (customer.productId || customer.productName) {
    let single = null;
    if (customer.productId) {
      const linked = db.products.find(product => product.id === customer.productId);
      if (linked) single = { id: linked.id, name: linked.name, manual: false, ...productQtyUnit(customer) };
    }
    if (!single && customer.productName) single = { id: null, name: String(customer.productName), manual: true, ...productQtyUnit(customer) };
    if (single) productList = [single];
  }
  return {
    ...customer,
    cnicMasked: maskCnic(customer.cnic),
    cnic: undefined,
    creditPurchases,
    totalPaid,
    balance,
    lastPaymentAt: totals.lastPaymentAt || customer.lastPaymentAt || null,
    products: productList,
    profileProduct: productList[0] || null
  };
}

function toLocalDateParts(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toLocalTimeParts(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function combineDateTime(dateStr, timeStr) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || ''));
  if (!dm || !tm) return null;
  const date = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
  if (isNaN(date.getTime())) return null;
  return date;
}

function returnedQtyByItem(db, saleId) {
  const counts = {};
  for (const record of db.returns) {
    if (record.saleId !== saleId || record.voided) continue;
    for (const item of record.items || []) {
      const key = itemKey(item);
      counts[key] = round2((counts[key] || 0) + Number(item.qty || 0));
    }
  }
  return counts;
}

function processReturn(db, body, actor) {
  const lookup = String(body.saleId || body.invoiceNo || '').trim();
  if (!lookup) throw new Error('Provide the bill ID or invoice number');
  const sale = db.sales.find(item => item.id === lookup || String(item.invoiceNo).toLowerCase() === lookup.toLowerCase());
  if (!sale) throw new Error('Invoice not found');
  if (sale.voided) throw new Error('This invoice was cancelled and cannot be returned');
  // Checked before anything is moved: a return queued while offline can be replayed on reconnect,
  // and restocking the goods or refunding the cash a second time would be wrong.
  const returnClientId = String(body.clientId || '').trim();
  if (returnClientId) {
    const seen = (db.returns || []).find(row => row.clientId === returnClientId);
    if (seen) return { record: seen, duplicate: true };
  }

  const soldByKey = {};
  for (const item of sale.items) soldByKey[itemKey(item)] = item;
  const alreadyReturned = returnedQtyByItem(db, sale.id);

  let requests = Array.isArray(body.items) ? body.items.filter(item => Number(item.qty) > 0) : [];
  if (body.complete) {
    requests = sale.items.map(item => ({
      productId: item.productId,
      name: item.name,
      qty: round2(Number(item.qty) - (alreadyReturned[itemKey(item)] || 0))
    })).filter(item => item.qty > 0);
  }
  if (!requests.length) throw new Error('Select at least one product with a quantity to return');

  const returnItems = [];
  for (const request of requests) {
    const key = itemKey(request);
    const soldItem = soldByKey[key];
    if (!soldItem) throw new Error(`${request.name || 'Product'} is not on invoice ${sale.invoiceNo}`);
    const eligible = round2(Number(soldItem.qty) - (alreadyReturned[key] || 0));
    const qty = round2(request.qty);
    if (!(qty > 0)) throw new Error('Return quantity must be positive');
    if (qty > eligible + 1e-9) {
      throw new Error(`${soldItem.name}: only ${eligible} of ${soldItem.qty} can still be returned`);
    }
      // Carry the rate as it was billed. Rounding it to whole rupees would refund 0 for a
      // per-gram line such as Rs 0.1/gram.
      returnItems.push({ productId: soldItem.productId, name: soldItem.name, unit: soldItem.unit, qty, price: safeRate(soldItem.price), cost: money(soldItem.cost) });
  }

  for (const item of returnItems) {
    if (!item.productId) continue;
    const product = db.products.find(row => row.id === item.productId);
    if (product) {
      // Restock in the product's base unit, matching how the sale reduced it.
      const baseQty = stockQtyFor(item, product);
      product.stock = round3(Number(product.stock) + baseQty);
      product._updatedAt = now();
      db.stockMovements.unshift({ id: uid('stm'), at: now(), productId: product.id, type: 'return', qty: baseQty, unit: product.unit, note: `Return on ${sale.invoiceNo}` });
    }
  }

  const refundSubtotal = money(returnItems.reduce((sum, item) => sum + item.price * item.qty, 0));
  const ratio = Number(sale.subtotal) > 0 ? refundSubtotal / sale.subtotal : 0;
  const refundDiscount = money((sale.discount || 0) * ratio);
  const refundTax = money((sale.tax || 0) * ratio);
  const refundTotal = Math.max(0, refundSubtotal - refundDiscount + refundTax);

  const saleDue = Math.max(0, money(sale.dueAmount));
  const udharAdjustment = Math.min(refundTotal, saleDue);
  const cashRefund = money(refundTotal - udharAdjustment);
  if (udharAdjustment > 0) {
    sale.dueAmount = money(saleDue - udharAdjustment);
    const customer = db.customers.find(row => row.id === sale.customerId);
    if (customer) {
      customer.balance = Math.max(0, money(Number(customer.balance) - udharAdjustment));
      if (customer.recordedTotal !== undefined && customer.recordedTotal !== null && customer.recordedTotal !== '') {
        customer.recordedTotal = Math.max(0, money(Number(customer.recordedTotal) - udharAdjustment));
      }
      customer._updatedAt = now();
    }
  }

  const record = {
    id: uid('ret'),
    saleId: sale.id,
    invoiceNo: sale.invoiceNo,
    customerId: sale.customerId,
    createdAt: now(),
    createdBy: actor.id,
    createdByName: actor.name || '',
    clientId: returnClientId || undefined,
    items: returnItems,
    reason: String(body.reason || '').trim() || 'Customer return',
    refundSubtotal,
    refundDiscount,
    refundTax,
    total: refundTotal,
    udharAdjustment,
    cashRefund,
    _updatedAt: now()
  };
  db.returns.unshift(record);

  const updatedReturned = returnedQtyByItem(db, sale.id);
  sale.returnStatus = sale.items.every(item => round2(Number(item.qty) - (updatedReturned[itemKey(item)] || 0)) <= 1e-9) ? 'full' : 'partial';
  audit(db, actor, 'create', 'return', record.id, { invoiceNo: sale.invoiceNo, refund: refundTotal, udharAdjusted: udharAdjustment, cashRefund });
  return { record, sale };
}

function receiveUdharPayment(db, customerId, amountInput, actor, options = {}) {
  const customer = db.customers.find(item => item.id === customerId);
  if (!customer) throw new Error('Customer not found');
  if (customerId === 'cus_walkin') throw new Error('Walk-in customers cannot have udhar');
  // A payment queued while offline can be sent more than once (retry, reconnect, double tap). The
  // clientId identifies the same payment, so it is recorded once and never taken from the balance
  // twice.
  const clientId = String((options && options.clientId) || '').trim();
  if (clientId) {
    const seen = (db.payments || []).find(payment => payment.clientId === clientId);
    if (seen) {
      return {
        payment: seen,
        balance: money(customer.balance),
        duplicate: true,
        recordedPaid: customer.recordedPaid,
        hasRecordedPaid: hasRecordedValue(customer.recordedPaid)
      };
    }
  }
  const amount = money(amountInput);
  if (!(amount > 0)) throw new Error('Amount must be more than zero');
  const balance = money(customer.balance);
  if (amount > balance) throw new Error(`Amount is more than the udhar balance (Rs ${balance})`);
  let paidAt;
  if (options.at) {
    paidAt = new Date(options.at);
    if (isNaN(paidAt.getTime())) throw new Error('Invalid payment date');
  } else {
    paidAt = new Date();
  }
  const at = paidAt.toISOString();
  customer.balance = money(balance - amount);
  customer._updatedAt = now();
  customer.lastPaymentAt = at;
  if (customer.recordedPaid !== undefined && customer.recordedPaid !== null && customer.recordedPaid !== '') {
    customer.recordedPaid = money(Number(customer.recordedPaid) + amount);
  }
  const payment = { id: uid('pay'), customerId, amount, at, createdBy: actor.name || '', createdById: actor.id, saleId: options.saleId || null, note: options.note || '', clientId: clientId || undefined, _updatedAt: now() };
  db.payments = [payment, ...(db.payments || [])];
  audit(db, actor, options.clear ? 'clear-udhar' : 'payment', 'customer', customerId, { amount, newBalance: customer.balance, note: options.note || '' });
  return { payment, balance: customer.balance };
}

// Adds a manually entered udhar as a NEW transaction row. Nothing existing is replaced: the
// customer's stored balance only grows by the new amount, and every earlier transaction stays as
// it was. This mirrors the way createSale/receiveUdharPayment move the balance.
function addUdharEntry(db, customerId, body, actor) {
  const customer = db.customers.find(item => item.id === customerId);
  if (!customer) throw new Error('Customer not found');
  if (customerId === 'cus_walkin') throw new Error('Walk-in customers cannot have udhar');
  // Same idea as a queued payment: a clientId means this exact entry was already recorded, so a
  // retry must not add the amount to the balance a second time.
  const clientId = String(body.clientId || '').trim();
  if (clientId) {
    const seen = (db.udharEntries || []).find(entry => entry.clientId === clientId);
    if (seen) return { entry: seen, balance: money(customer.balance), duplicate: true };
  }
  const amount = money(body.amount);
  if (!(amount > 0)) throw new Error('Amount must be more than zero');
  const note = String(body.note || body.description || '').trim();
  const reference = String(body.reference || '').trim();

  let at;
  if (body.atDate || body.atTime) {
    const combined = combineDateTime(body.atDate, body.atTime);
    if (combined) at = combined.toISOString();
  }
  if (!at) at = now();

  const previousBalance = money(customer.balance);
  const limit = Number(customer.creditLimit || 0);
  if (limit > 0 && previousBalance + amount > limit) {
    throw new Error(`Credit limit exceeded. ${customer.name} can take Rs ${money(limit - previousBalance)} more udhar.`);
  }

  const entry = {
    id: uid('udh'),
    customerId,
    amount,
    note,
    reference,
    at,
    createdAt: now(),
    createdBy: actor.id,
    createdByName: actor.name || '',
    previousBalance,
    balanceAfter: money(previousBalance + amount),
    clientId: clientId || undefined,
    voided: false,
    _updatedAt: now()
  };
  db.udharEntries = [entry, ...(db.udharEntries || [])];

  customer.balance = entry.balanceAfter;
  // Customers with a recorded total keep a balance derived from it, so it has to move too.
  if (customer.recordedTotal !== undefined && customer.recordedTotal !== null && customer.recordedTotal !== '') {
    customer.recordedTotal = money(Number(customer.recordedTotal) + amount);
  }
  customer._updatedAt = now();
  audit(db, actor, 'create', 'udhar', entry.id, { customerId, amount, note, reference, at, previousBalance, newBalance: entry.balanceAfter });
  return { entry, balance: customer.balance };
}

// A customer runs off a stored total once one has been set, and off the summed ledger until then.
// This is the single place that decides which of the two applies, so the credit-limit pre-check and
// the recalculation after the edit can never drift apart.
function hasRecordedValue(value) {
  return value !== undefined && value !== null && value !== '';
}
function customerBalanceFromRecorded(db, customer, totals, nextTotal, nextPaid) {
  const total = hasRecordedValue(nextTotal) ? money(nextTotal) : money(totals.creditPurchases);
  const paid = hasRecordedValue(nextPaid) ? money(nextPaid) : money(totals.totalPaid);
  return Math.max(0, total - paid);
}

function updateCustomer(db, id, body, actor) {
  const customer = db.customers.find(item => item.id === id);
  if (!customer) throw new Error('Customer not found');
  // Checked before anything is written: a refused udhar amount must not leave a half-applied edit
  // (a new name or product list) behind on the customer.
  const wantsUdharEdit = body.udhaarTotal !== undefined || body.udhaarPaid !== undefined || body.paymentDate !== undefined || body.paymentTime !== undefined;
  // Adding a priced product is udhar too, so it is gated by the same permission as typing an amount.
  const wantsProductUdhar = body.productUdhar !== undefined && body.productUdhar !== null;
  if ((wantsUdharEdit || wantsProductUdhar) && !can(actor, 'udhar')) {
    throw new Error('Only Admin or Manager can edit udhaar amounts and payment dates');
  }
  // Checked up front for the same reason as the permission above: a refused product udhar must not
  // leave the rest of the customer edit already written. The balance is projected the same way the
  // total edit below recalculates it, so a save that raises the total and adds a product in one go
  // is measured against the number the cashier will actually end up with.
  if (wantsProductUdhar) {
    if (id === 'cus_walkin') throw new Error('Walk-in customers cannot have udhar');
    const productAmount = money(body.productUdhar && body.productUdhar.amount);
    if (!(productAmount > 0)) throw new Error('Amount must be more than zero');
    let projectedBalance = money(customer.balance);
    if (can(actor, 'udhar') && (body.udhaarTotal !== undefined || body.udhaarPaid !== undefined)) {
      const totals = customerTotals(db)[id] || { creditPurchases: 0, totalPaid: 0 };
      const nextTotal = body.udhaarTotal !== undefined ? money(body.udhaarTotal) : customer.recordedTotal;
      const nextPaid = body.udhaarPaid !== undefined ? money(body.udhaarPaid) : customer.recordedPaid;
      projectedBalance = customerBalanceFromRecorded(db, customer, totals, nextTotal, nextPaid);
    }
    const limit = Number(customer.creditLimit || 0);
    if (limit > 0 && projectedBalance + productAmount > limit) {
      throw new Error(`Credit limit exceeded. ${customer.name} can take Rs ${money(limit - projectedBalance)} more udhar.`);
    }
  }
  for (const field of ['name', 'phone', 'cnic', 'address', 'creditLimit']) {
    if (body[field] !== undefined) customer[field] = field === 'creditLimit' ? money(body[field]) : String(body[field]).trim();
  }
  if (Array.isArray(body.products)) {
    const productList = [];
    for (const item of body.products) {
      const rawId = String((item && item.id) || '').trim();
      const rawName = String((item && (item.name || '')) || '').trim();
      if (!rawName) continue;
      if (rawId) {
        const linked = db.products.find(product => product.id === rawId);
        if (linked) productList.push({ id: linked.id, name: linked.name, manual: false, ...productQtyUnit(item) });
        else productList.push({ id: null, name: rawName, manual: true, ...productQtyUnit(item) });
      } else {
        productList.push({ id: null, name: rawName, manual: true, ...productQtyUnit(item) });
      }
    }
    customer.products = productList.slice(0, 50);
    delete customer.productId;
    delete customer.productName;
  } else if (body.productId !== undefined || body.productName !== undefined) {
    const pid = String(body.productId || '').trim();
    const pname = String(body.productName || '').trim();
    if (pid) {
      customer.productId = pid;
      delete customer.productName;
    } else {
      delete customer.productId;
      if (pname) customer.productName = pname;
      else delete customer.productName;
    }
  }
  if (can(actor, 'udhar') && wantsUdharEdit) {
    if (body.udhaarTotal !== undefined) customer.recordedTotal = money(body.udhaarTotal);
    if (body.udhaarPaid !== undefined) customer.recordedPaid = money(body.udhaarPaid);
    if (body.udhaarTotal !== undefined || body.udhaarPaid !== undefined) {
      const totals = customerTotals(db)[id] || { creditPurchases: 0, totalPaid: 0 };
      customer.balance = customerBalanceFromRecorded(db, customer, totals, customer.recordedTotal, customer.recordedPaid);
    }
    if (body.paymentDate !== undefined || body.paymentTime !== undefined) {
      const related = (db.payments || []).filter(p => p.customerId === id);
      const latest = related.length ? related.reduce((a, b) => new Date(b.at).getTime() > new Date(a.at).getTime() ? b : a) : null;
      const base = latest ? new Date(latest.at) : (customer.lastPaymentAt ? new Date(customer.lastPaymentAt) : new Date());
      const dateStr = body.paymentDate !== undefined && body.paymentDate !== '' ? String(body.paymentDate) : toLocalDateParts(base);
      const timeStr = body.paymentTime !== undefined && body.paymentTime !== '' ? String(body.paymentTime) : toLocalTimeParts(base);
      const combined = combineDateTime(dateStr, timeStr);
      if (combined) {
        const iso = combined.toISOString();
        if (latest) latest.at = iso;
        customer.lastPaymentAt = iso;
      }
    }
  }
  // A priced product added in the customer form is recorded as a real, dated udhar entry so it shows
  // up in the khata on the day it happened, instead of only inflating a stored total that the ledger
  // would never explain. Applied after the explicit total edit above so a product added in the same
  // save stacks on top of the number the cashier typed rather than being overwritten by it.
  let productUdharResult = null;
  if (wantsProductUdhar) {
    const added = addUdharEntry(db, id, {
      amount: body.productUdhar.amount,
      note: body.productUdhar.note,
      reference: body.productUdhar.reference,
      atDate: body.productUdhar.atDate,
      atTime: body.productUdhar.atTime,
      clientId: body.productUdhar.clientId
    }, actor);
    productUdharResult = added;
  }
  customer._updatedAt = now();
  audit(db, actor, 'update', 'customer', customer.id, { name: customer.name, ...(body.udhaarTotal !== undefined ? { udhaarTotal: money(body.udhaarTotal) } : {}), ...(body.udhaarPaid !== undefined ? { udhaarPaid: money(body.udhaarPaid) } : {}), ...(productUdharResult ? { productUdhar: { entryId: productUdharResult.entry.id, amount: money(productUdharResult.entry.amount), duplicate: Boolean(productUdharResult.duplicate) } } : {}) });
  return productUdharResult ? { ...customer, productUdharEntry: productUdharResult.entry } : customer;
}

function createSupplier(db, body, actor) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('Supplier name is required');
  const supplier = { id: uid('sup'), name, phone: String(body.phone || '').trim(), address: String(body.address || '').trim(), active: true, _updatedAt: now() };
  db.suppliers = [supplier, ...(db.suppliers || [])];
  audit(db, actor, 'create', 'supplier', supplier.id, { name });
  return supplier;
}

function updateSupplier(db, id, body, actor) {
  const supplier = db.suppliers.find(item => item.id === id);
  if (!supplier) throw new Error('Supplier not found');
  if (body.name !== undefined) supplier.name = String(body.name).trim();
  if (body.phone !== undefined) supplier.phone = String(body.phone).trim();
  if (body.address !== undefined) supplier.address = String(body.address).trim();
  if (body.active !== undefined) supplier.active = body.active === true || body.active === 'true';
  supplier._updatedAt = now();
  audit(db, actor, 'update', 'supplier', supplier.id, { name: supplier.name });
  return supplier;
}

function deleteSupplier(db, id, actor) {
  const supplier = db.suppliers.find(item => item.id === id);
  if (!supplier) throw new Error('Supplier not found');
  const used = (db.purchases || []).some(item => item.supplierId === id);
  if (used) throw new Error('This supplier has purchase history and cannot be deleted');
  db.suppliers = db.suppliers.filter(item => item.id !== id);
  audit(db, actor, 'delete', 'supplier', id, { name: supplier.name });
  return { ok: true };
}

function deleteCustomer(db, id, actor) {
  const customer = db.customers.find(item => item.id === id);
  if (!customer) throw new Error('Customer not found');
  const hasSales = (db.sales || []).some(sale => sale.customerId === id && !sale.voided);
  const hasPayments = (db.payments || []).some(payment => payment.customerId === id && !payment.voided);
  const hasBalance = Number(customer.balance || 0) > 0;
  if (hasSales || hasPayments || hasBalance) {
    throw new Error('This customer has billing or udhaar history and cannot be deleted');
  }
  db.customers = db.customers.filter(item => item.id !== id);
  audit(db, actor, 'delete', 'customer', id, { name: customer.name });
  return { ok: true };
}

function clearUdhar(db, customerId, actor) {
  const customer = db.customers.find(item => item.id === customerId);
  if (!customer) throw new Error('Customer not found');
  const balance = money(customer.balance);
  if (balance <= 0) throw new Error('Udhar is already clear for this customer');
  const result = receiveUdharPayment(db, customerId, balance, actor, { note: 'Udhar cleared in full', clear: true });
  result.cleared = true;
  result.previousBalance = balance;
  return result;
}

function voidSale(db, sale, actor) {
  if (sale.voided) throw new Error('Sale already voided');
  sale.voided = true;
  sale.voidedAt = now();
  sale.voidedBy = actor.id;
  const changedAt = now();
  for (const item of sale.items || []) {
    if (!item.productId) continue;
    const product = db.products.find(row => row.id === item.productId);
    if (product) {
      // Give back exactly what was taken. New sales store baseQty; older ones are converted from
      // the billed unit, so a gram-billed line restores 0.5 kg and not 500 kg.
      const baseQty = stockQtyFor(item, product);
      product.stock = round3(Number(product.stock) + baseQty);
      product._updatedAt = changedAt;
      db.stockMovements.unshift({ id: uid('stm'), at: changedAt, productId: product.id, type: 'void', qty: baseQty, unit: product.unit, note: `Void ${sale.invoiceNo}` });
    }
  }
  const due = money(sale.dueAmount);
  if (due > 0 && sale.customerId && sale.customerId !== 'cus_walkin') {
    const customer = db.customers.find(row => row.id === sale.customerId);
    if (customer) {
      customer.balance = Math.max(0, money(Number(customer.balance) - due));
      if (customer.recordedTotal !== undefined && customer.recordedTotal !== null && customer.recordedTotal !== '') {
        customer.recordedTotal = Math.max(0, money(Number(customer.recordedTotal) - due));
      }
      customer._updatedAt = changedAt;
    }
  }
  for (const payment of db.payments || []) {
    if (payment.saleId === sale.id && !payment.voided) {
      payment.voided = true;
      payment.voidedAt = changedAt;
      payment.voidedBy = actor.id;
      payment._updatedAt = changedAt;
    }
  }
  audit(db, actor, 'void', 'sale', sale.id, { invoiceNo: sale.invoiceNo, balanceReversed: due, paymentsVoided: (db.payments || []).filter(p => p.saleId === sale.id && p.voided && p.voidedAt === changedAt).length });
  return sale;
}

function reversePayment(db, paymentId, actor) {
  const payment = (db.payments || []).find(item => item.id === paymentId);
  if (!payment) throw new Error('Payment not found');
  if (payment.voided) throw new Error('Payment already reversed');
  const customer = db.customers.find(row => row.id === payment.customerId);
  payment.voided = true;
  payment.voidedAt = now();
  payment.voidedBy = actor.id;
  payment._updatedAt = now();
  if (customer && customer.id !== 'cus_walkin') {
    customer.balance = money(Number(customer.balance) + Number(payment.amount));
    if (customer.recordedPaid !== undefined && customer.recordedPaid !== null && customer.recordedPaid !== '') {
      customer.recordedPaid = money(Number(customer.recordedPaid) - Number(payment.amount));
    }
    customer._updatedAt = payment.voidedAt;
  }
  audit(db, actor, 'reverse', 'payment', payment.id, { customerId: payment.customerId, amount: money(payment.amount), newBalance: customer ? customer.balance : null });
  return payment;
}

function csv(rows) {
  return rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

async function handleApi(request, response) {
  let db;
  try {
    db = await readDb();
  } catch (error) {
    db = null;
    for (const fallback of [readAuthData, recallLastGoodAuth]) {
      try {
        const auth = await fallback();
        if (auth && Array.isArray(auth.users) && auth.users.length) {
          db = {
            meta: { invoiceSeq: 0 },
            settings: auth.settings || {},
            users: auth.users,
            sessions: auth.sessions || {},
            products: [], customers: [], suppliers: [], purchases: [], sales: [],
            returns: [], payments: [], stockMovements: [], auditLogs: [],
            _readOnly: true
          };
          break;
        }
      } catch (_) {}
    }
    if (!db) {
      return json(response, 503, { error: 'Store database is waking up or briefly unreachable. Please press Sign in again in a few seconds.' });
    }
  }
  if (!db) {
    db = seedData();
    try { await saveDb(db); } catch (_) {}
  }
  const readOnlyMode = !!db._readOnly;
  delete db._readOnly;
  if (ensureCoreAccounts(db) || ensureSchema(db)) {
    try { await saveDb(db); } catch (_) {}
  }
  const url = new URL(request.url, `http://${request.headers.host}`);
  const method = request.method;
  const authOnlyPaths = ['/api/auth/login', '/api/auth/logout', '/api/auth/password', '/api/health'];
  if (readOnlyMode && !authOnlyPaths.includes(url.pathname)) {
    return json(response, 503, { error: 'Store database connection is weak right now. Sign in again - data will appear once the connection recovers.' });
  }

  try {
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      const rateKey = `${request.socket.remoteAddress || 'local'}:${String(request.headers['user-agent'] || '').slice(0, 80)}`;
      if (!loginAllowed(rateKey)) return json(response, 429, { error: 'Too many login attempts. Try again later.' });
      const body = await parseBody(request);
      const loginRaw = String(body.login || '').trim();
      const loginEmail = loginRaw.toLowerCase();
      const loginPhone = loginRaw.replace(/[\s-]/g, '');
      const user = db.users.find(item => item.active && (
        String(item.email).toLowerCase() === loginEmail ||
        String(item.phone || '').replace(/[\s-]/g, '') === loginPhone && loginPhone.length > 0
      ));
      if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
        return json(response, 401, { error: 'Invalid login credentials. Check your email/phone and password.' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      const store = pruneSessions(db);
      store[hashToken(token)] = { userId: user.id, createdAt: now(), agent: String(request.headers['user-agent'] || '').slice(0, 120) };
      audit(db, user, 'login', 'user', user.id);
      if (readOnlyMode) {
        return json(response, 200, { token, user: sanitizeUser(user), permissions: permissions[user.role] || [], warning: 'Connected in limited mode - the store database is still syncing. Please sign in again shortly.' });
      }
      await saveDb(db);
      return json(response, 200, { token, user: sanitizeUser(user), permissions: permissions[user.role] || [] });
    }

    const actor = requireActor(request, response, db);
    if (!actor) return;

    if (method === 'POST' && url.pathname === '/api/auth/logout') {
      const header = request.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (token) {
        delete getSessions(db)[hashToken(token)];
        delete getSessions(db)[token];
      }
      audit(db, actor, 'logout', 'user', actor.id);
      await saveDb(db);
      return json(response, 200, { ok: true });
    }

    if (method === 'GET' && url.pathname === '/api/bootstrap') {
      const totalsMap = customerTotals(db);
      return json(response, 200, {
        user: sanitizeUser(actor),
        settings: db.settings,
        products: db.products,
        warehouses: db.warehouses || [],
        customers: db.customers.map(item => decorateCustomer(db, item, totalsMap)),
        suppliers: db.suppliers,
        sales: db.sales.slice(0, 50),
        returns: db.returns.slice(0, 50),
        drafts: (db.drafts || []).slice(0, 50),
        lowStock: lowStock(db),
        stats: dashboardStats(db),
        reports: { day: calculateReport(db, 'day'), month: calculateReport(db, 'month'), year: calculateReport(db, 'year') }
      });
    }

    if (method === 'POST' && url.pathname === '/api/auth/password') {
      const body = await parseBody(request);
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      const confirmPassword = String(body.confirmPassword || '');
      if (!verifyPassword(currentPassword, actor.passwordHash)) {
        return json(response, 400, { error: 'Current password is incorrect.' });
      }
      if (newPassword !== confirmPassword) {
        return json(response, 400, { error: 'New password and confirmation do not match.' });
      }
      const validationError = validatePassword(newPassword);
      if (validationError) return json(response, 400, { error: validationError });
      actor.passwordHash = hashPassword(newPassword);
      audit(db, actor, 'change-password', 'user', actor.id);
      await saveDb(db);
      return json(response, 200, { ok: true });
    }

    if (method === 'GET' && url.pathname === '/api/dashboard') {
      const outstanding = money(db.customers
        .filter(item => item.id !== 'cus_walkin')
        .reduce((sum, item) => sum + Math.max(0, Number(item.balance) || 0), 0));
      return json(response, 200, {
        day: calculateReport(db, 'day'),
        month: calculateReport(db, 'month'),
        year: calculateReport(db, 'year'),
        lowStock: lowStock(db),
        stats: dashboardStats(db),
        recentSales: db.sales.slice(0, 10),
        totalUdharOutstanding: outstanding,
        creditCustomers: db.customers.filter(item => item.balance > 0).map(item => ({ ...item, cnicMasked: maskCnic(item.cnic), cnic: undefined }))
      });
    }

    if (method === 'GET' && url.pathname === '/api/products') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const category = String(url.searchParams.get('category') || '').trim().toLowerCase();
      const all = url.searchParams.get('all') === '1';
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 60)));
      let rows = db.products;
      if (q) rows = rows.filter(item => `${item.name} ${item.sku} ${item.barcode || ''} ${item.category}`.toLowerCase().includes(q));
      if (category) rows = rows.filter(item => String(item.category || '').toLowerCase() === category);
      const total = rows.length;
      const categories = [...new Set(db.products.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const products = all ? rows : rows.slice((page - 1) * limit, page * limit);
      return json(response, 200, { products, total, page, limit, categories });
    }

    if (method === 'POST' && url.pathname === '/api/products') {
      if (!can(actor, 'products')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const product = { id: uid('prd'), active: true, stock: 0, reorderLevel: 5, unit: 'pcs', category: 'General', _updatedAt: now(), ...body };
      const pricing = resolveProductPricing(product);
      product.price = pricing.price;
      product.cost = pricing.cost;
      product.stock = Number(product.stock || 0);
      if (product.barcode === undefined) product.barcode = '';
      if (product.image === undefined) product.image = '';
      if (!product.category) product.category = 'General';
      if (product.reorderLevel === undefined) product.reorderLevel = 5;
      product.kgPerBoree = Math.max(0, Number(product.kgPerBoree || 0));
      product.pcsPerCarton = Math.max(0, Number(product.pcsPerCarton || 0));
      product.active = !(product.status === 'inactive' || product.active === false);
      product.status = product.active ? 'active' : 'inactive';
      product._updatedAt = now();
      db.products.unshift(product);
      audit(db, actor, 'create', 'product', product.id, { name: product.name });
      await saveDb(db);
      return json(response, 201, product);
    }

    if (method === 'PUT' && url.pathname.startsWith('/api/products/')) {
      if (!can(actor, 'products')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/').pop();
      const product = db.products.find(item => item.id === id);
      if (!product) return json(response, 404, { error: 'Product not found' });
      Object.assign(product, await parseBody(request));
      const pricing = resolveProductPricing(product);
      product.price = pricing.price;
      product.cost = pricing.cost;
      product.stock = Number(product.stock || 0);
      product.kgPerBoree = Math.max(0, Number(product.kgPerBoree || 0));
      product.pcsPerCarton = Math.max(0, Number(product.pcsPerCarton || 0));
      product.active = !(product.status === 'inactive' || product.active === false);
      product.status = product.active ? 'active' : 'inactive';
      product._updatedAt = now();
      audit(db, actor, 'update', 'product', product.id, { name: product.name });
      await saveDb(db);
      return json(response, 200, product);
    }

    if (method === 'POST' && /^\/api\/products\/[^/]+\/stock$/.test(url.pathname)) {
      if (!can(actor, 'products') && !can(actor, 'inventory')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/')[3];
      const product = db.products.find(item => item.id === id);
      if (!product) return json(response, 404, { error: 'Product not found' });
      const body = await parseBody(request);
      const mode = body.mode === 'set' ? 'set' : 'add';
      const convert = body.convert === 'boree' || body.convert === 'carton' ? body.convert : 'none';
      const converted = convertPackQty(body.qty, convert, product);
      const requested = Number(body.qty);
      if (!Number.isFinite(requested) || requested <= 0) return json(response, 400, { error: 'Enter a quantity greater than 0' });
      if (!converted.qty) return json(response, 400, { error: `Set kg per boree / pcs per carton on ${product.name} first` });
      const before = Number(product.stock || 0);
      const delta = mode === 'set' ? round2(converted.qty - before) : converted.qty;
      const after = round2(mode === 'set' ? converted.qty : before + delta);
      if (after < 0) return json(response, 400, { error: `Stock cannot go below 0. Current stock is ${before}` });
      product.stock = after;
      product._updatedAt = now();
      db.stockMovements.unshift({
        id: uid('stm'),
        at: now(),
        productId: product.id,
        type: mode === 'set' ? 'stock-set' : 'stock-add',
        qty: round2(delta),
        requestedQty: requested,
        convert,
        note: String(body.note || (convert !== 'none' ? `Stock added (${requested} ${convert})` : 'Stock added'))
      });
      audit(db, actor, mode === 'set' ? 'stock-set' : 'stock-add', 'product', product.id, { name: product.name, before, after, qty: requested, convert });
      await saveDb(db);
      return json(response, 200, { product, before, after, added: round2(delta), convert, requestedQty: requested });
    }

    if (method === 'DELETE' && url.pathname.startsWith('/api/products/')) {
      if (!can(actor, 'products')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/').pop();
      const product = db.products.find(item => item.id === id);
      if (!product) return json(response, 404, { error: 'Product not found' });
      const used = db.sales.some(sale => (sale.items || []).some(item => item.productId === id))
        || db.purchases.some(purchase => (purchase.items || []).some(item => item.productId === id));
      if (used) {
        return json(response, 409, { error: 'PRODUCT_IN_USE', message: 'This product has billing history. Mark it Inactive instead of deleting so old bills stay correct.' });
      }
      db.products = db.products.filter(item => item.id !== id);
      audit(db, actor, 'delete', 'product', id, { name: product.name });
      await saveDb(db);
      return json(response, 200, { ok: true });
    }

    if (method === 'GET' && url.pathname === '/api/warehouses') {
      if (!can(actor, 'warehouse')) return json(response, 403, { error: 'Permission denied' });
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      let rows = db.warehouses;
      if (q) rows = rows.filter(item => `${item.name} ${item.sku || ''} ${item.barcode || ''} ${item.category || ''} ${item.location || ''} ${item.supplier || ''}`.toLowerCase().includes(q));
      return json(response, 200, { warehouses: rows, total: rows.length });
    }

    if (method === 'POST' && url.pathname === '/api/warehouses') {
      if (!can(actor, 'warehouse')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const item = { id: uid('wh'), active: true, stock: 0, reorderLevel: 5, unit: 'pcs', category: 'General', location: '', supplier: '', linkedProductId: '', kgPerBoree: 0, pcsPerCarton: 0, _updatedAt: now(), ...body };
      item.stock = Number(item.stock || 0);
      item.reorderLevel = Number(item.reorderLevel || 5);
      item.kgPerBoree = Math.max(0, Number(item.kgPerBoree || 0));
      item.pcsPerCarton = Math.max(0, Number(item.pcsPerCarton || 0));
      item.active = !(item.status === 'inactive' || item.active === false);
      item.status = item.active ? 'active' : 'inactive';
      item._updatedAt = now();
      db.warehouses.unshift(item);
      audit(db, actor, 'create', 'warehouse', item.id, { name: item.name });
      await saveDb(db);
      return json(response, 201, item);
    }

    if (method === 'PUT' && url.pathname.startsWith('/api/warehouses/')) {
      if (!can(actor, 'warehouse')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/').pop();
      const item = db.warehouses.find(w => w.id === id);
      if (!item) return json(response, 404, { error: 'Warehouse item not found' });
      const body = await parseBody(request);
      delete body.id;
      Object.assign(item, body);
      item.stock = Number(item.stock || 0);
      item.reorderLevel = Number(item.reorderLevel || 5);
      item.kgPerBoree = Math.max(0, Number(item.kgPerBoree || 0));
      item.pcsPerCarton = Math.max(0, Number(item.pcsPerCarton || 0));
      item.active = !(item.status === 'inactive' || item.active === false);
      item.status = item.active ? 'active' : 'inactive';
      item._updatedAt = now();
      audit(db, actor, 'update', 'warehouse', item.id, { name: item.name });
      await saveDb(db);
      return json(response, 200, item);
    }

    if (method === 'DELETE' && url.pathname.startsWith('/api/warehouses/')) {
      if (!can(actor, 'warehouse')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/').pop();
      const item = db.warehouses.find(w => w.id === id);
      if (!item) return json(response, 404, { error: 'Warehouse item not found' });
      db.warehouses = db.warehouses.filter(w => w.id !== id);
      audit(db, actor, 'delete', 'warehouse', id, { name: item.name });
      await saveDb(db);
      return json(response, 200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/api/warehouses/transfer') {
      if (!can(actor, 'warehouse')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const { warehouseId, productId, qty, direction } = body;
      const qtyNum = Number(qty);
      if (!warehouseId || !productId || !qtyNum || qtyNum <= 0) return json(response, 400, { error: 'warehouseId, productId, and positive qty are required' });
      const wh = db.warehouses.find(w => w.id === warehouseId);
      const prod = db.products.find(p => p.id === productId);
      if (!wh) return json(response, 404, { error: 'Warehouse item not found' });
      if (!prod) return json(response, 404, { error: 'Product not found' });
      const convert = body.convert === 'boree' || body.convert === 'carton' ? body.convert : 'none';
      // Warehousing counts packs (boree/carton); products count sellable units (kg/pcs).
      const source = direction === 'toWarehouse' ? prod : wh;
      const target = direction === 'toWarehouse' ? wh : prod;
      const conversion = convertPackQty(qtyNum, convert, source);
      if (convert !== 'none' && !conversion.factor) {
        return json(response, 400, { error: `Set ${convert === 'boree' ? 'kg per boree' : 'pcs per carton'} on ${source.name} first` });
      }
      const moveQty = conversion.qty;
      if (direction === 'toProduct') {
        if (Number(wh.stock) < qtyNum) return json(response, 400, { error: `Not enough warehouse stock for ${wh.name}. Available: ${wh.stock}` });
        wh.stock = round2(Number(wh.stock) - qtyNum);
        prod.stock = round2(Number(prod.stock || 0) + moveQty);
      } else {
        if (Number(prod.stock) < qtyNum) return json(response, 400, { error: `Not enough product stock for ${prod.name}. Available: ${prod.stock}` });
        prod.stock = round2(Number(prod.stock) - qtyNum);
        wh.stock = round2(Number(wh.stock || 0) + moveQty);
      }
      wh._updatedAt = now();
      prod._updatedAt = now();
      const note = conversion.label
        ? `${conversion.label} transfer: ${qtyNum} ${conversion.label}${conversion.factor > 1 ? ` = ${moveQty}` : ''}`
        : 'Stock transfer';
      if (direction === 'toProduct') {
        db.stockMovements.unshift({ id: uid('stm'), at: now(), productId, warehouseId, direction, qty: moveQty, packs: qtyNum, convert, note, by: actor.name });
      }
      audit(db, actor, 'transfer', direction === 'toWarehouse' ? 'product-to-warehouse' : 'warehouse-to-product', null, { warehouse: wh.name, product: prod.name, qty: qtyNum, moved: moveQty, convert: conversion.label || 'none' });
      await saveDb(db);
      return json(response, 200, { warehouse: wh, product: prod, moved: moveQty, packs: qtyNum, convert: conversion.label || 'none' });
    }

    if (method === 'GET' && url.pathname === '/api/customers') {
      const totalsMap = customerTotals(db);
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      let rows = db.customers;
      if (q) rows = rows.filter(item => `${item.name} ${item.phone || ''}`.toLowerCase().includes(q));
      return json(response, 200, rows.map(item => decorateCustomer(db, item, totalsMap)));
    }

    if (method === 'GET' && url.pathname === '/api/customers/export.csv') {
      if (!can(actor, 'customers')) return json(response, 403, { error: 'Permission denied' });
      const totalsMap = customerTotals(db);
      const rows = [['Customer Name', 'Phone', 'CNIC', 'Address', 'Credit Limit', 'Total Udhaar', 'Paid Amount', 'Remaining Amount', 'Payment Date', 'Payment Time', 'Status']];
      for (const customer of db.customers) {
        const decorated = decorateCustomer(db, customer, totalsMap);
        const at = decorated.lastPaymentAt ? new Date(decorated.lastPaymentAt) : null;
        rows.push([
          decorated.name,
          decorated.phone || '',
          decorated.cnicMasked || '',
          decorated.address || '',
          money(decorated.creditLimit),
          decorated.creditPurchases,
          decorated.totalPaid,
          decorated.balance,
          at ? toLocalDateParts(at) : '',
          at ? toLocalTimeParts(at) : '',
          decorated.active === false ? 'Inactive' : 'Active'
        ]);
      }
      response.writeHead(200, { ...securityHeaders, 'Content-Type': types['.csv'], 'Content-Disposition': 'attachment; filename="customers.csv"' });
      return response.end(csv(rows));
    }

    if (method === 'POST' && url.pathname === '/api/customers') {
      if (!can(actor, 'customers')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      if (!body.name || !String(body.name).trim()) return json(response, 400, { error: 'Customer name is required' });
      const customer = { id: uid('cus'), name: String(body.name).trim(), phone: String(body.phone || '').trim(), cnic: String(body.cnic || '').trim(), address: String(body.address || '').trim(), creditLimit: money(body.creditLimit), balance: money(body.balance), active: true, _updatedAt: now() };
      const productList = [];
      if (Array.isArray(body.products)) {
        for (const item of body.products) {
          const rawId = String((item && item.id) || '').trim();
          const rawName = String((item && (item.name || '')) || '').trim();
          if (!rawName) continue;
          if (rawId) productList.push({ id: rawId, name: rawName, manual: false, ...productQtyUnit(item) });
          else productList.push({ id: null, name: rawName, manual: true, ...productQtyUnit(item) });
        }
      } else {
        const productId = String(body.productId || '').trim();
        const productName = String(body.productName || '').trim();
        if (productId) productList.push({ id: productId, name: productName, manual: false });
        if (productName && !productId) productList.push({ id: null, name: productName, manual: true });
      }
      if (productList.length) customer.products = productList.slice(0, 50);
      db.customers.unshift(customer);
      audit(db, actor, 'create', 'customer', customer.id, { name: customer.name });
      await saveDb(db);
      return json(response, 201, decorateCustomer(db, customer, customerTotals(db)));
    }

    if (method === 'PUT' && /^\/api\/customers\/[^/]+$/.test(url.pathname)) {
      if (!can(actor, 'customers')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/')[3];
      if (!db.customers.some(item => item.id === id)) return json(response, 404, { error: 'Customer not found' });
      const body = await parseBody(request);
      const customer = updateCustomer(db, id, body, actor);
      await saveDb(db);
      return json(response, 200, decorateCustomer(db, customer, customerTotals(db)));
    }

    if (method === 'DELETE' && /^\/api\/customers\/[^/]+$/.test(url.pathname)) {
      if (!can(actor, 'customers')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/')[3];
      try {
        const result = deleteCustomer(db, id, actor);
        await saveDb(db);
        return json(response, 200, result);
      } catch (err) {
        return json(response, 409, { error: 'CUSTOMER_IN_USE', message: err.message });
      }
    }

    if (method === 'GET' && /^\/api\/customers\/[^/]+\/ledger$/.test(url.pathname)) {
      if (!can(actor, 'customers')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/')[3];
      const customer = db.customers.find(item => item.id === id);
      if (!customer) return json(response, 404, { error: 'Customer not found' });
      // Every invoice to this customer belongs on their khata, not just the ones that left udhar -
      // the cashier wants one place that shows what this customer actually bought. A bill settled in
      // full still shows up, it simply moves the balance by nothing.
      const creditSales = db.sales
        .filter(sale => sale.customerId === id && !sale.voided)
        .map(sale => ({
          type: 'sale',
          id: sale.id,
          at: sale.createdAt,
          invoiceNo: sale.invoiceNo,
          amount: sale.total,
          paidAtBilling: money(sale.paidAmount),
          paidInFull: money(sale.dueAmount != null ? sale.dueAmount : money(sale.total) - money(sale.paidAmount)) <= 0,
          // Only the unpaid part changes the outstanding, so a settled bill leaves the running
          // balance exactly where it was instead of counting twice.
          udharAdded: money(sale.dueAmount != null ? sale.dueAmount : money(sale.total) - money(sale.paidAmount)),
          products: sale.items.map(item => `${item.name} x${item.qty}`).join(', '),
          items: (sale.items || []).map(item => ({
            name: item.name,
            sku: item.sku || '',
            qty: Number(item.qty) || 0,
            unit: item.unit || 'pcs',
            price: Number(item.price) || 0,
            amount: Math.round((Number(item.price) || 0) * (Number(item.qty) || 0))
          })),
          createdBy: sale.createdByName || ''
        }));
// The money taken at the counter is already carried on the bill's own row as "paid at billing", so
      // counting its payment row again in the running balance used to subtract the same rupees twice
      // and left the statement reading lower than what the customer actually owes. The row stays on
      // the khata for the record - it is flagged and simply does not move the balance.
      const payments = (db.payments || [])
        .filter(payment => payment.customerId === id && !payment.voided)
        .map(payment => {
          const bill = payment.saleId ? db.sales.find(item => item.id === payment.saleId) : null;
          const paidAtBilling = !!bill && payment.at === bill.createdAt;
          return {
            type: 'payment',
            id: payment.id,
            at: payment.at,
            amount: payment.amount,
            paidAtBilling,
            invoiceNo: bill ? (bill.invoiceNo || '') : '',
            note: payment.note || '',
            createdBy: payment.createdBy || ''
          };
});
      const udharEntries = (db.udharEntries || [])
        .filter(entry => entry.customerId === id && !entry.voided)
        .map(entry => ({
          type: 'udhar',
          id: entry.id,
          at: entry.at || entry.createdAt,
          amount: entry.amount,
          invoiceNo: '',
          note: entry.note || '',
          reference: entry.reference || '',
          createdBy: entry.createdByName || ''
        }));
      const allEntries = [...creditSales, ...payments, ...udharEntries].sort((a, b) => new Date(a.at) - new Date(b.at));
      let running = 0;
      const balanceAfter = {};
      const balanceBefore = {};
      for (const entry of allEntries) {
        balanceBefore[entry.id] = money(running);
        if (entry.type === 'sale') running += money(entry.udharAdded);
        else if (entry.type === 'payment') { if (!entry.paidAtBilling) running -= money(entry.amount); }
        else running += money(entry.amount);
        balanceAfter[entry.id] = money(running);
      }
      const entries = allEntries.reverse();
      return json(response, 200, { customer: { ...customer, cnicMasked: maskCnic(customer.cnic), cnic: undefined }, entries, balanceAfter, balanceBefore });
    }

    if (method === 'POST' && /^\/api\/customers\/[^/]+\/payments$/.test(url.pathname)) {
      if (!can(actor, 'udhar')) return json(response, 403, { error: 'Only Admin or Manager can record udhar payments' });
      const id = url.pathname.split('/')[3];
      const body = await parseBody(request);
      const options = { note: String(body.note || '').trim(), saleId: body.saleId || null };
      if (body.atDate || body.atTime) {
        const combined = combineDateTime(body.atDate, body.atTime);
        if (combined) options.at = combined.toISOString();
      }
      try {
        const result = receiveUdharPayment(db, id, body.amount, actor, options);
        await saveDb(db);
        return json(response, 201, { payment: result.payment, balance: result.balance });
      } catch (error) {
        const status = error.message === 'Customer not found' ? 404 : 400;
        return json(response, status, { error: error.message });
      }
    }

    if (method === 'POST' && /^\/api\/customers\/[^/]+\/udhar$/.test(url.pathname)) {
      if (!can(actor, 'udhar')) return json(response, 403, { error: 'Only Admin or Manager can add udhar' });
      const id = url.pathname.split('/')[3];
      const body = await parseBody(request);
      try {
        const { entry, balance } = addUdharEntry(db, id, body, actor);
        await saveDb(db);
        return json(response, 201, { entry, balance, previousBalance: entry.previousBalance });
      } catch (error) {
        const status = error.message === 'Customer not found' ? 404 : 400;
        return json(response, status, { error: error.message });
      }
    }

    if (method === 'POST' && /^\/api\/customers\/[^/]+\/clear-udhar$/.test(url.pathname)) {
      if (!can(actor, 'udhar')) return json(response, 403, { error: 'Only Admin or Manager can clear udhar' });
      const id = url.pathname.split('/')[3];
      try {
        const result = clearUdhar(db, id, actor);
        await saveDb(db);
        return json(response, 200, { ok: true, cleared: true, previousBalance: result.previousBalance, balance: 0, payment: result.payment });
      } catch (error) {
        const status = error.message === 'Customer not found' ? 404 : 400;
        return json(response, status, { error: error.message });
      }
    }

    if (method === 'POST' && url.pathname === '/api/reset') {
      if (String(actor.role || '').toLowerCase() !== 'admin') return json(response, 403, { error: 'Only admin can reset the shop data' });
      const body = await parseBody(request);
      db.sales = [];
      db.returns = [];
      db.purchases = [];
      db.stockMovements = [];
      db.payments = [];
      db.customers = [{ id: 'cus_walkin', name: 'Walk-in Customer', phone: '', cnic: '', creditLimit: 0, balance: 0, active: true }];
      if (body.clearProducts) db.products = [];
      db.meta.invoiceSeq = 1000;
      db.auditLogs = [];
      audit(db, actor, 'reset', 'system', 'reset', { clearProducts: !!body.clearProducts });
      await saveDb(db);
      let warning = null;
      if (useSupabase && MODE !== 'cloud') {
        try {
          await writeCloudDb(db);
        } catch (error) {
          warning = `Reset saved locally but the cloud update failed (${error.message}). It will retry automatically.`;
        }
      }
      return json(response, 200, { ok: true, warning });
    }

    if (method === 'POST' && url.pathname === '/api/sales') {
      if (!can(actor, 'pos')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      // A slow connection can make the cashier press Complete Bill again while the first request is
      // still in flight, or the client can retry one the server already recorded. The clientId is
      // the same on every attempt for one cart, so the retry returns the original bill instead of
      // billing the customer twice. createSale also writes the invoice, its payment, the stock
      // movement and the customer's new balance together in one db, saved in one write below - so a
      // failed write leaves nothing behind rather than a bill with no khata entry.
      const clientId = String((body && body.clientId) || '').trim();
      if (clientId) {
        const existing = (db.sales || []).find(row => row.clientId === clientId);
        if (existing) return json(response, 200, existing);
      }
      const sale = createSale(db, body, actor, 'online');
      await saveDb(db);
      // The cashier's screen is updated from this response instead of fetching the whole store
      // again, so the customer's new balance and totals come from the same rules the ledger uses -
      // including the recorded-total legacy customers - rather than being recalculated here.
      const totalsMap = customerTotals(db);
      const billed = db.customers.find(row => row.id === sale.customerId);
      return json(response, 201, { ...sale, customer: billed ? decorateCustomer(db, billed, totalsMap) : null });
    }

    if (method === 'GET' && url.pathname === '/api/drafts') {
      if (!can(actor, 'pos')) return json(response, 403, { error: 'Permission denied' });
      return json(response, 200, { drafts: (db.drafts || []).slice(0, 50) });
    }

    if (method === 'POST' && url.pathname === '/api/drafts') {
      if (!can(actor, 'pos')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const items = Array.isArray(body.items)
        ? body.items.map(item => ({
            productId: item.productId || null,
            name: String(item.name || '').trim(),
            sku: item.sku || '',
            unit: item.unit || 'pcs',
            qty: Number.isFinite(Number(item.qty)) && Number(item.qty) > 0 ? Math.round(Number(item.qty) * 1000) / 1000 : 0,
            price: safeRate(item.price, 0),
            manual: !!item.manual
          })).filter(item => item.name && item.qty > 0)
        : [];
      if (!items.length) return json(response, 400, { error: 'Draft must include at least one item' });
      let draft = db.drafts.find(item => item.id === body.id || (body.clientId && item.clientId === body.clientId));
      if (!draft) {
        draft = { id: uid('drf'), clientId: body.clientId || uid('drfc'), createdAt: now(), createdByName: actor.name || '' };
        db.drafts.unshift(draft);
      }
      draft.updatedAt = now();
      draft.customerId = body.customerId || 'cus_walkin';
      draft.paymentType = body.paymentType || 'Cash';
      draft.discount = safeMoney(body.discount);
      draft.additionalDiscount = safeMoney(body.additionalDiscount);
      draft.receivedAmount = safeMoney(body.receivedAmount);
      draft.reference = String(body.reference ?? '').trim();
      draft.items = items;
      if (body.delivery && typeof body.delivery === 'object' && !Array.isArray(body.delivery)) {
        draft.delivery = Object.fromEntries(Object.entries(body.delivery).filter(([, value]) => String(value ?? '').trim() !== ''));
      } else {
        delete draft.delivery;
      }
      await saveDb(db);
      return json(response, 200, { draft });
    }

    if (method === 'DELETE' && url.pathname.startsWith('/api/drafts/')) {
      if (!can(actor, 'pos')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/')[3];
      const before = db.drafts.length;
      db.drafts = db.drafts.filter(item => item.id !== id && item.clientId !== id);
      if (db.drafts.length === before) return json(response, 404, { error: 'Draft not found' });
      await saveDb(db);
      return json(response, 200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/api/sync') {
      if (!can(actor, 'pos')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const results = [];

      // Everything the shop recorded while offline arrives here. Each entry carries a clientId, so
      // sending the same entry again (retry, reconnect, double tap) is recognised and skipped
      // rather than billed or credited twice. A single refused entry is reported on its own and
      // the rest of the batch still goes through, so one bad entry cannot block the queue.
      for (const queued of (Array.isArray(body.sales) ? body.sales : [])) {
        const clientId = String((queued && queued.clientId) || '').trim();
        try {
          const existing = db.sales.find(sale => clientId && sale.clientId === clientId);
          if (existing) results.push({ type: 'sale', clientId, status: 'duplicate' });
          else results.push({ type: 'sale', clientId, status: 'created', sale: createSale(db, queued, actor, 'offline-sync') });
        } catch (err) {
          results.push({ type: 'sale', clientId, status: 'failed', error: err.message });
        }
      }

      if (Array.isArray(body.udharEntries) && body.udharEntries.length) {
        if (!can(actor, 'udhar')) return json(response, 403, { error: 'Only Admin or Manager can add udhar' });
        for (const queued of body.udharEntries) {
          const clientId = String((queued && queued.clientId) || '').trim();
          try {
            const added = addUdharEntry(db, String(queued.customerId || ''), { ...queued, clientId }, actor);
            results.push({ type: 'udhar', clientId, status: added.duplicate ? 'duplicate' : 'created', entry: added.entry });
          } catch (err) {
            results.push({ type: 'udhar', clientId, status: 'failed', error: err.message });
          }
        }
      }

      if (Array.isArray(body.payments) && body.payments.length) {
        if (!can(actor, 'udhar')) return json(response, 403, { error: 'Only Admin or Manager can record udhar payments' });
        for (const queued of body.payments) {
          const clientId = String((queued && queued.clientId) || '').trim();
          try {
            // The cashier can pick the date and time on the form, so the queued entry carries them
            // exactly as typed and they are resolved here, at the moment the entry is recorded.
            const paidAt = queued.at || (queued.atDate || queued.atTime ? combineDateTime(queued.atDate, queued.atTime) : null);
            const paid = receiveUdharPayment(db, String(queued.customerId || ''), queued.amount, actor, {
              note: queued.note || 'Offline payment',
              saleId: queued.saleId || null,
              clear: Boolean(queued.clear),
              at: paidAt || undefined,
              clientId
            });
            results.push({ type: 'payment', clientId, status: paid.duplicate ? 'duplicate' : 'created', payment: paid.payment });
          } catch (err) {
            results.push({ type: 'payment', clientId, status: 'failed', error: err.message });
          }
        }
      }

      if (Array.isArray(body.returns) && body.returns.length) {
        if (!can(actor, 'returns')) return json(response, 403, { error: 'Permission denied' });
        for (const queued of body.returns) {
          const clientId = String((queued && queued.clientId) || '').trim();
          try {
            const done = processReturn(db, { ...queued, clientId }, actor);
            results.push({ type: 'return', clientId, status: done.duplicate ? 'duplicate' : 'created', record: done.record });
          } catch (err) {
            results.push({ type: 'return', clientId, status: 'failed', error: err.message });
          }
        }
      }

      // A customer edited while offline. Setting the same fields again lands on the same result,
      // so replaying this is safe and needs no dedupe of its own. A priced product carried in the
      // same edit is the exception: it becomes a udhar entry, which is not idempotent, so it dedupes
      // on the clientId stored inside productUdhar.
      if (Array.isArray(body.customers) && body.customers.length) {
        if (!can(actor, 'customers')) return json(response, 403, { error: 'Permission denied' });
        for (const queued of body.customers) {
          const customerId = String((queued && queued.customerId) || '').trim();
          const clientId = String((queued && queued.clientId) || '').trim();
          try {
            const saved = updateCustomer(db, customerId, queued, actor);
            results.push({ type: 'customer', clientId, status: 'created', customer: decorateCustomer(db, saved, customerTotals(db)) });
          } catch (err) {
            results.push({ type: 'customer', clientId, status: 'failed', error: err.message });
          }
        }
      }

      await saveDb(db);
      return json(response, 200, { results });
      }

    if (method === 'POST' && url.pathname.match(/^\/api\/sales\/[^/]+\/void$/)) {
      if (!can(actor, 'returns')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/')[3];
      const sale = db.sales.find(item => item.id === id || item.invoiceNo === id);
      if (!sale) return json(response, 404, { error: 'Sale not found' });
      try {
        const result = voidSale(db, sale, actor);
        await saveDb(db);
        return json(response, 200, result);
      } catch (err) {
        return json(response, 409, { error: err.message });
      }
    }

    if (method === 'POST' && /^\/api\/payments\/[^/]+\/reverse$/.test(url.pathname)) {
      if (!can(actor, 'udhar')) return json(response, 403, { error: 'Only Admin or Manager can reverse udhar payments' });
      const id = url.pathname.split('/')[3];
      try {
        const payment = reversePayment(db, id, actor);
        await saveDb(db);
        return json(response, 200, { ok: true, payment });
      } catch (err) {
        return json(response, err.message === 'Payment not found' ? 404 : 400, { error: err.message });
      }
    }

    if (method === 'GET' && url.pathname === '/api/sales/lookup') {
      const invoiceNo = String(url.searchParams.get('invoiceNo') || '').trim();
      const saleId = String(url.searchParams.get('saleId') || '').trim();
      if (!invoiceNo && !saleId) return json(response, 400, { error: 'Enter a bill ID or invoice number' });
      const sale = db.sales.find(item =>
        item.id === saleId ||
        String(item.invoiceNo).toLowerCase() === invoiceNo.toLowerCase()
      );
      if (!sale) return json(response, 404, { error: `No invoice found for "${invoiceNo || saleId}"` });
      const customer = db.customers.find(item => item.id === sale.customerId);
      const returnedMap = returnedQtyByItem(db, sale.id);
      const items = sale.items.map(item => {
        const returnedQty = returnedMap[itemKey(item)] || 0;
        return { ...item, returnedQty, eligibleQty: round2(Number(item.qty) - returnedQty) };
      });
      return json(response, 200, {
        sale: {
          id: sale.id,
          invoiceNo: sale.invoiceNo,
          createdAt: sale.createdAt,
          paymentType: sale.paymentType,
          subtotal: sale.subtotal,
          discount: sale.discount,
          tax: sale.tax,
          total: sale.total,
          paidAmount: money(sale.paidAmount),
          dueAmount: Math.max(0, money(sale.dueAmount)),
          voided: !!sale.voided,
          returnStatus: sale.returnStatus || 'none',
          createdByName: sale.createdByName || ''
        },
        customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, cnicMasked: maskCnic(customer.cnic), balance: money(customer.balance) } : null,
        previousReturns: db.returns.filter(record => record.saleId === sale.id),
        items
      });
    }

    if (method === 'POST' && url.pathname === '/api/returns') {
      if (!can(actor, 'returns:create') && !can(actor, 'returns')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      const { record } = processReturn(db, body, actor);
      await saveDb(db);
      return json(response, 201, record);
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
        product._updatedAt = now();
        purchase.total += qty * cost;
        db.stockMovements.unshift({ id: uid('stm'), at: now(), productId: product.id, type: 'purchase', qty, note: 'Supplier purchase' });
      }
      db.purchases.unshift(purchase);
      audit(db, actor, 'create', 'purchase', purchase.id, { total: purchase.total });
      await saveDb(db);
      return json(response, 201, purchase);
    }

    if (method === 'GET' && url.pathname === '/api/suppliers') return json(response, 200, db.suppliers);

    if (method === 'POST' && url.pathname === '/api/suppliers') {
      if (!can(actor, 'purchases')) return json(response, 403, { error: 'Permission denied' });
      const body = await parseBody(request);
      try {
        const supplier = createSupplier(db, body, actor);
        await saveDb(db);
        return json(response, 201, supplier);
      } catch (error) {
        return json(response, 400, { error: error.message });
      }
    }

    if (method === 'PUT' && /^\/api\/suppliers\/[^/]+$/.test(url.pathname)) {
      if (!can(actor, 'purchases')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/')[3];
      const body = await parseBody(request);
      try {
        const supplier = updateSupplier(db, id, body, actor);
        await saveDb(db);
        return json(response, 200, supplier);
      } catch (error) {
        return json(response, error.message === 'Supplier not found' ? 404 : 400, { error: error.message });
      }
    }

    if (method === 'DELETE' && /^\/api\/suppliers\/[^/]+$/.test(url.pathname)) {
      if (!can(actor, 'purchases')) return json(response, 403, { error: 'Permission denied' });
      const id = url.pathname.split('/')[3];
      try {
        const result = deleteSupplier(db, id, actor);
        await saveDb(db);
        return json(response, 200, result);
      } catch (error) {
        return json(response, error.message === 'Supplier not found' ? 404 : 400, { error: error.message });
      }
    }

    if (method === 'GET' && url.pathname === '/api/users') {
      if (!can(actor, 'users')) return json(response, 403, { error: 'Only Admin can manage users' });
      return json(response, 200, db.users.map(sanitizeUser));
    }

    if (method === 'POST' && url.pathname === '/api/users') {
      if (!can(actor, 'users')) return json(response, 403, { error: 'Only Admin can manage users' });
      const body = await parseBody(request);
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const phone = String(body.phone || '').trim();
      const password = String(body.password || '');
      const role = String(body.role || '').trim();
      if (!name || !email) return json(response, 400, { error: 'Name and email are required' });
      if (!permissions[role]) return json(response, 400, { error: `Role must be one of: ${Object.keys(permissions).join(', ')}` });
      if (db.users.some(item => item.email.toLowerCase() === email)) return json(response, 400, { error: 'A user with this email already exists' });
      if (!phone) return json(response, 400, { error: 'Phone number is required for login' });
      if (db.users.some(item => item.phone === phone)) return json(response, 400, { error: 'A user with this phone already exists' });
      const validationError = validatePassword(password);
      if (validationError) return json(response, 400, { error: validationError });
      const user = { id: uid('usr'), name, email, phone, role, active: true, passwordHash: hashPassword(password), _updatedAt: now() };
      if (Array.isArray(body.permissions)) user.permissions = body.permissions;
      db.users.push(user);
      audit(db, actor, 'create', 'user', user.id, { name, role });
      await saveDb(db);
      return json(response, 201, sanitizeUser(user));
    }

    if (method === 'PUT' && /^\/api\/users\/[^/]+$/.test(url.pathname)) {
      if (!can(actor, 'users')) return json(response, 403, { error: 'Only Admin can manage users' });
      const id = url.pathname.split('/')[3];
      const user = db.users.find(item => item.id === id);
      if (!user) return json(response, 404, { error: 'User not found' });
      const body = await parseBody(request);
      if (body.role !== undefined) {
        const role = String(body.role).trim();
        if (!permissions[role]) return json(response, 400, { error: `Role must be one of: ${Object.keys(permissions).join(', ')}` });
        const wasAdmin = user.role === 'Admin';
        const willBeAdmin = role === 'Admin';
        if (wasAdmin && !willBeAdmin) {
          const otherActiveAdmins = db.users.filter(item => item.id !== id && item.role === 'Admin' && item.active).length;
          if (otherActiveAdmins === 0) return json(response, 400, { error: 'Cannot demote the last active Admin' });
        }
        user.role = role;
        delete user.permissions;
      }
      if (body.active !== undefined) {
        if (user.id === actor.id && !body.active) return json(response, 400, { error: 'You cannot deactivate your own account' });
        if (user.role === 'Admin' && !body.active) {
          const otherActiveAdmins = db.users.filter(item => item.id !== id && item.role === 'Admin' && item.active).length;
          if (otherActiveAdmins === 0) return json(response, 400, { error: 'Cannot deactivate the last active Admin' });
        }
        if (!body.active) {
          for (const [tokenKey, session] of Object.entries(getSessions(db))) {
            if (session.userId === user.id) delete getSessions(db)[tokenKey];
          }
        }
        user.active = !!body.active;
      }
      if (body.name !== undefined) user.name = String(body.name).trim() || user.name;
      if (body.phone !== undefined) user.phone = String(body.phone).trim();
      if (body.password) {
        const validationError = validatePassword(String(body.password));
        if (validationError) return json(response, 400, { error: validationError });
        user.passwordHash = hashPassword(String(body.password));
      }
      if (Array.isArray(body.permissions)) user.permissions = body.permissions;
      user._updatedAt = now();
      audit(db, actor, 'update', 'user', user.id, { name: user.name, role: user.role, active: user.active });
      await saveDb(db);
      return json(response, 200, sanitizeUser(user));
    }

    if (method === 'GET' && url.pathname === '/api/audit-logs') {
      if (!can(actor, 'settings')) return json(response, 403, { error: 'Permission denied' });
      return json(response, 200, db.auditLogs.slice(0, 200));
    }

    if (method === 'GET' && url.pathname === '/api/backups') {
      if (!can(actor, 'backups')) return json(response, 403, { error: 'Permission denied' });
      if (isVercel && useSupabase) {
        const backups = await listCloudBackups();
        return json(response, 200, backups);
      }
      ensureDir(backupDir);
      const backups = fs.readdirSync(backupDir).filter(name => name.endsWith('.json')).sort().reverse();
      return json(response, 200, backups.map(file => ({ file })));
    }

    if (method === 'POST' && url.pathname === '/api/backups') {
      if (!can(actor, 'backups')) return json(response, 403, { error: 'Permission denied' });
      const backup = await createBackup('manual');
      audit(db, actor, 'create', 'backup', backup.file);
      await saveDb(db);
      return json(response, 201, backup);
    }

    if (method === 'POST' && url.pathname.match(/^\/api\/backups\/[^/]+\/restore$/)) {
      if (!can(actor, 'backups')) return json(response, 403, { error: 'Permission denied' });
      const file = decodeURIComponent(url.pathname.split('/')[3]);
      const restored = await restoreBackup(file, actor);
      return json(response, 200, restored);
    }

    json(response, 404, { error: 'API route not found' });
  } catch (error) {
    json(response, 400, { error: error.message || 'Request failed' });
  }
}

// Paths that must never be downloadable. Kept as a denylist so new data files are covered by
// default instead of relying on a rule per file.
const PROTECTED_PREFIXES = ['database', 'backups', '.git'];
const PROTECTED_NAMES = new Set(['.env', '.env.local', '.vercelignore', '.gitignore']);
const isProtectedPath = requested => {
  const segments = String(requested || '').split(/[\\/]+/).filter(Boolean);
  if (!segments.length) return false;
  if (PROTECTED_NAMES.has(segments[segments.length - 1])) return true;
  return segments.some(segment => PROTECTED_PREFIXES.includes(segment));
};

function serveStatic(request, response) {
  const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
  const requested = parsedUrl.pathname === '/' ? 'index.html' : decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
  // Never serve the database, secrets or backups over HTTP, even if such a file ever ends up inside
  // a build. These hold real customer names, phones, CNICs, balances and session/password hashes.
  if (isProtectedPath(requested)) return response.writeHead(404, securityHeaders).end('Not found');
  const file = path.resolve(root, requested);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return response.writeHead(403, securityHeaders).end('Forbidden');
  fs.readFile(file, (error, content) => {
    if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500, securityHeaders).end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
    response.writeHead(200, { ...securityHeaders, 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(content);
  });
}

// Answered before the database lock and without touching the store data. The client polls
// sync-status every 20s; making it queue behind the lock and read the whole database blob meant a
// status check could sit in front of a cashier pressing Complete Bill.
function requestHandler(request, response) {
  if (request.url.startsWith('/api/')) {
    const { pathname } = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { ok: true, at: now() });
    if (request.method === 'GET' && pathname === '/api/sync-status') {
      return json(response, 200, {
        mode: MODE,
        cloudConfigured: useSupabase,
        enabled: cloudSync.enabled,
        intervalMs: SYNC_INTERVAL_MS,
        running: cloudSync.running,
        lastAttemptAt: cloudSync.lastAttemptAt,
        lastSuccessAt: cloudSync.lastSuccessAt,
        lastError: cloudSync.lastError
      });
    }
    return withDbLock(() => handleApi(request, response));
  }
  return serveStatic(request, response);
}

async function initDb() {
  ensureDir(backupDir);
  const existing = await readDb();
  if (!existing) {
    const data = seedData();
    await saveDb(data);
    console.log('Database seeded with initial data');
  } else if (ensureCoreAccounts(existing)) {
    await saveDb(existing);
    console.log('Core accounts and store settings migrated');
  }
  try { await createBackup('startup'); } catch (_) {}
  if (cloudSync.enabled) {
    console.log(`Cloud sync active: local database syncs to the cloud every ${Math.round(SYNC_INTERVAL_MS / 1000)}s`);
    setTimeout(() => { syncWithCloud(); }, 1500);
    setInterval(() => { syncWithCloud(); }, SYNC_INTERVAL_MS);
  }
}

function createServer() {
  return http.createServer(requestHandler);
}

if (require.main === module) {
  initDb().then(() => {
    createServer().listen(PORT, () => console.log(`Faislabadi POS is running on http://localhost:${PORT}`));
  }).catch(err => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  });
}

module.exports = requestHandler;
module.exports.maxDuration = 30;
module.exports.createServer = createServer;
module.exports.seedData = seedData;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.validatePassword = validatePassword;
module.exports.calculateReport = calculateReport;
module.exports.dashboardStats = dashboardStats;
module.exports.convertPackQty = convertPackQty;
module.exports.resolveProductPricing = resolveProductPricing;
module.exports.maskCnic = maskCnic;
module.exports.restoreBackup = restoreBackup;
module.exports.ensureSchema = ensureSchema;
module.exports.createSale = createSale;
module.exports.processReturn = processReturn;
module.exports.receiveUdharPayment = receiveUdharPayment;
module.exports.addUdharEntry = addUdharEntry;
module.exports.clearUdhar = clearUdhar;
module.exports.returnedQtyByItem = returnedQtyByItem;
module.exports.customerTotals = customerTotals;
module.exports.decorateCustomer = decorateCustomer;
module.exports.combineDateTime = combineDateTime;
module.exports.createSupplier = createSupplier;
module.exports.updateSupplier = updateSupplier;
module.exports.deleteSupplier = deleteSupplier;
module.exports.deleteCustomer = deleteCustomer;
module.exports.voidSale = voidSale;
module.exports.reversePayment = reversePayment;
module.exports.can = can;
module.exports.permissions = permissions;
module.exports.isProtectedPath = isProtectedPath;
module.exports.unitToBase = unitToBase;
module.exports.qtyToBase = qtyToBase;
module.exports.priceToUnit = priceToUnit;
module.exports.stockQtyFor = stockQtyFor;
module.exports.UNIT_FACTORS = UNIT_FACTORS;
module.exports.unitDimension = unitDimension;
module.exports.unitsCompatible = unitsCompatible;
module.exports.updateCustomer = updateCustomer;
