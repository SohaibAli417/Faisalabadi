/* global React, ReactDOM */
const { useEffect, useMemo, useState } = React;
const h = React.createElement;

const pages = [
  ['dashboard', 'Dashboard'],
  ['pos', 'Point of Sale'],
  ['products', 'Products'],
  ['inventory', 'Inventory'],
  ['purchases', 'Purchases'],
  ['customers', 'Customers and Udhar'],
  ['reports', 'Reports'],
  ['users', 'Users and Audit'],
  ['settings', 'Settings and Backups']
];

const stateKey = 'faislabadi-pos-session';
const queueKey = 'faislabadi-pos-offline-sales';
const money = value => `Rs ${Math.round(Number(value || 0)).toLocaleString('en-PK')}`;
const loadJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
};
const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const friendlyError = error => {
  if (String(error?.message || '').includes('Failed to fetch')) {
    return 'Cannot connect to the POS server. Open http://localhost:3000/ instead of opening frontend/index.html directly.';
  }
  return error.message || 'Request failed';
};

function Badge({ children, tone = 'neutral' }) {
  return h('span', { className: `badge ${tone}` }, children);
}

function apiClient(token, setOnline) {
  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    setOnline(true);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }
  return {
    get: path => request(path),
    post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
    put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) })
  };
}

function Login({ onLogin }) {
  const [login, setLogin] = useState('admin@faislabadi.pk');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Login failed');
      saveJson(stateKey, payload);
      onLogin(payload);
    } catch (err) {
      setError(friendlyError(err));
    }
  }
  return h('main', { className: 'login-page' },
    h('form', { className: 'login-card', onSubmit: submit },
      h('div', { className: 'brand login-brand' }, h('span', { className: 'brand-logo' }, 'F'), h('div', null, h('strong', null, 'Faislabadi'), h('small', null, 'GENERAL STORE POS'))),
      h('p', { className: 'eyebrow' }, 'SECURE LOGIN'),
      h('h1', null, 'Sign in to POS'),
      h('p', { className: 'subtitle' }, 'Default setup users: admin@faislabadi.pk / admin123, manager@faislabadi.pk / manager123, cashier@faislabadi.pk / cashier123.'),
      h('label', null, 'Email or phone'),
      h('input', { value: login, onChange: event => setLogin(event.target.value), autoComplete: 'username', required: true }),
      h('label', null, 'Password'),
      h('input', { value: password, onChange: event => setPassword(event.target.value), type: 'password', autoComplete: 'current-password', required: true }),
      error && h('div', { className: 'notice danger' }, error),
      h('button', { className: 'primary', type: 'submit' }, 'Sign in')));
}

function Metric({ title, value, note }) {
  return h('article', { className: 'metric-card' }, h('p', null, title), h('h3', null, value), h('small', null, note));
}

function Dashboard({ data, go }) {
  const report = data.reports?.day || {};
  return h('div', { className: 'page dashboard' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, 'LIVE STORE OVERVIEW'), h('h1', null, 'Dashboard'), h('p', { className: 'subtitle' }, 'Sales, stock, credit and low-stock alerts from persisted data.')), h('button', { className: 'primary', onClick: () => go('pos') }, 'New sale')),
    h('section', { className: 'metrics' },
      h(Metric, { title: 'Net sales today', value: money(report.netSales), note: `${report.salesCount || 0} invoices` }),
      h(Metric, { title: 'Gross profit', value: money(report.grossProfit), note: 'After product cost and discounts' }),
      h(Metric, { title: 'Credit sales', value: money(report.creditSales), note: 'Added to Udhar balances' }),
      h(Metric, { title: 'Low stock items', value: data.lowStock.length, note: 'At or below reorder level' })),
    h('section', { className: 'dashboard-grid' },
      h('article', { className: 'panel' }, h('div', { className: 'panel-head' }, h('div', null, h('h2', null, 'Recent invoices'), h('p', null, 'Latest persisted sales'))), h(SalesTable, { sales: data.sales.slice(0, 8), customers: data.customers })),
      h('article', { className: 'panel' }, h('div', { className: 'panel-head' }, h('div', null, h('h2', null, 'Low stock alert'), h('p', null, 'Products needing replenishment'))), data.lowStock.length ? data.lowStock.map(product => h('div', { className: 'stock-row', key: product.id }, h('div', null, h('strong', null, product.name), h('small', null, `${product.stock} ${product.unit} remaining, reorder at ${product.reorderLevel}`)), h(Badge, { tone: 'danger' }, 'Low'))) : h('p', { className: 'empty-copy' }, 'No low stock items.'))));
}

function SalesTable({ sales, customers }) {
  return h('div', { className: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Invoice', 'Customer', 'Payment', 'Date', 'Total', 'Status'].map(label => h('th', { key: label }, label)))),
    h('tbody', null, sales.length ? sales.map(sale => {
      const customer = customers.find(item => item.id === sale.customerId);
      return h('tr', { key: sale.id }, h('td', null, h('strong', null, sale.invoiceNo)), h('td', null, customer?.name || 'Walk-in Customer'), h('td', null, h(Badge, { tone: sale.paymentType === 'Credit' ? 'warning' : 'success' }, sale.paymentType)), h('td', null, new Date(sale.createdAt).toLocaleString()), h('td', null, h('strong', null, money(sale.total))), h('td', null, sale.voided ? h(Badge, { tone: 'danger' }, 'Voided') : h(Badge, { tone: 'success' }, 'Posted')));
    }) : h('tr', null, h('td', { colSpan: 6 }, 'No sales recorded yet.')))));
}

function POS({ client, data, refresh, online, setOnline }) {
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState([]);
  const [customerId, setCustomerId] = useState('cus_walkin');
  const [paymentType, setPaymentType] = useState('Cash');
  const [discount, setDiscount] = useState(0);
  const [manual, setManual] = useState({ name: '', price: '', qty: '1', unit: 'pcs' });
  const [receipt, setReceipt] = useState(null);
  const [message, setMessage] = useState('');
  const products = data.products.filter(product => product.active);
  const shown = products.filter(product => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(query.toLowerCase()));
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const tax = Math.round(Math.max(0, subtotal - discount) * Number(data.settings.taxRate));
  const total = Math.max(0, subtotal - discount) + tax;

  function addProduct(product) {
    setCart(items => {
      const old = items.find(item => item.productId === product.id);
      if (old) return items.map(item => item.productId === product.id ? { ...item, qty: item.qty + 1 } : item);
      return [...items, { productId: product.id, name: product.name, price: product.price, qty: 1, unit: product.unit }];
    });
  }

  function scanBarcode(event) {
    if (event.key !== 'Enter') return;
    const code = query.trim().toLowerCase();
    const exact = products.find(product => String(product.sku || '').toLowerCase() === code);
    if (!exact) return;
    event.preventDefault();
    addProduct(exact);
    setQuery('');
    setMessage(`${exact.name} added by barcode.`);
  }

  function addManual(event) {
    event.preventDefault();
    const price = Number(manual.price);
    const qty = Number(manual.qty);
    if (!manual.name.trim() || price <= 0 || qty <= 0) return;
    setCart(items => [...items, { productId: null, name: manual.name.trim(), price, qty, unit: manual.unit }]);
    setManual({ name: '', price: '', qty: '1', unit: 'pcs' });
  }

  function changeQty(index, delta) {
    setCart(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, qty: item.qty + delta } : item).filter(item => item.qty > 0));
  }

  async function syncQueuedSales() {
    const queued = loadJson(queueKey, []);
    if (!queued.length) return;
    try {
      await client.post('/api/sync', { sales: queued });
      saveJson(queueKey, []);
      setMessage('Offline sales synced.');
      await refresh();
    } catch (_) {
      setOnline(false);
    }
  }

  async function charge() {
    const payload = { clientId: `client_${Date.now()}`, customerId, paymentType, discount: Number(discount || 0), items: cart };
    try {
      const sale = await client.post('/api/sales', payload);
      setReceipt(sale);
      setCart([]);
      setDiscount(0);
      await refresh();
    } catch (err) {
      if (!navigator.onLine || /fetch/i.test(err.message)) {
        const queued = loadJson(queueKey, []);
        saveJson(queueKey, [...queued, payload]);
        setCart([]);
        setDiscount(0);
        setOnline(false);
        setMessage('Connection unavailable. Sale saved offline and will sync later.');
      } else {
        setMessage(friendlyError(err));
      }
    }
  }

  useEffect(() => {
    syncQueuedSales();
    const timer = setInterval(syncQueuedSales, 15000);
    return () => clearInterval(timer);
  }, [client]);

  return h('div', { className: 'pos-page' },
    h('section', { className: 'pos-catalog' },
      h('div', { className: 'page-title compact' }, h('div', null, h('p', { className: 'eyebrow' }, online ? 'COUNTER ONLINE' : 'COUNTER OFFLINE'), h('h1', null, 'New sale')), h(Badge, { tone: online ? 'success' : 'warning' }, online ? 'Synced' : `${loadJson(queueKey, []).length} queued`)),
      message && h('div', { className: 'notice' }, message),
      h('label', { className: 'search' }, h('input', { autoFocus: true, value: query, onChange: event => setQuery(event.target.value), onKeyDown: scanBarcode, placeholder: 'Scan barcode or search product name' })),
      h('form', { className: 'manual-form', onSubmit: addManual }, h('strong', null, 'Manual item'), h('input', { value: manual.name, onChange: event => setManual({ ...manual, name: event.target.value }), placeholder: 'Product name' }), h('input', { type: 'number', min: '1', value: manual.price, onChange: event => setManual({ ...manual, price: event.target.value }), placeholder: 'Price' }), h('input', { type: 'number', min: '0.01', step: '0.01', value: manual.qty, onChange: event => setManual({ ...manual, qty: event.target.value }), placeholder: 'Qty' }), h('select', { value: manual.unit, onChange: event => setManual({ ...manual, unit: event.target.value }) }, ['pcs', 'pack', 'kg', 'gram', 'litre', 'dozen'].map(unit => h('option', { key: unit }, unit))), h('button', { className: 'secondary' }, 'Add')),
      h('div', { className: 'catalog-grid' }, shown.map(product => h('button', { className: 'pos-product', key: product.id, onClick: () => addProduct(product) }, h('strong', null, product.name), h('small', null, `${product.sku} - ${product.stock} ${product.unit}`), h('b', null, money(product.price)))))),
    h('aside', { className: 'cart-panel' },
      h('header', null, h('div', null, h('p', { className: 'eyebrow' }, 'CURRENT INVOICE'), h('h2', null, 'Cart'))),
      h('select', { className: 'customer-select', value: customerId, onChange: event => setCustomerId(event.target.value) }, data.customers.map(customer => h('option', { value: customer.id, key: customer.id }, `${customer.name}${customer.balance ? ` - Udhar ${money(customer.balance)}` : ''}`))),
      h('select', { className: 'customer-select', value: paymentType, onChange: event => setPaymentType(event.target.value) }, ['Cash', 'Card', 'Credit'].map(type => h('option', { key: type }, type))),
      h('div', { className: 'cart-list' }, cart.length ? cart.map((item, index) => h('div', { className: 'cart-line', key: `${item.productId || item.name}-${index}` }, h('div', { className: 'line-info' }, h('strong', null, item.name), h('small', null, `${money(item.price)} x ${item.qty}`), h('div', { className: 'quantity' }, h('button', { onClick: () => changeQty(index, -1) }, '-'), h('b', null, item.qty), h('button', { onClick: () => changeQty(index, 1) }, '+'))), h('strong', null, money(item.price * item.qty)))) : h('div', { className: 'empty' }, h('h3', null, 'Cart is empty'), h('p', null, 'Scan or select a product.'))),
      h('div', { className: 'cart-footer' }, h('label', null, 'Discount'), h('input', { className: 'discount-input', type: 'number', min: '0', value: discount, onChange: event => setDiscount(Number(event.target.value)) }), h('div', { className: 'totals' }, h('div', null, h('span', null, 'Subtotal'), h('strong', null, money(subtotal))), h('div', null, h('span', null, 'Tax'), h('strong', null, money(tax))), h('div', { className: 'grand-total' }, h('span', null, 'Total'), h('strong', null, money(total)))), h('button', { className: 'charge', disabled: !cart.length, onClick: charge }, 'Charge payment'))),
    receipt && h(ReceiptModal, { sale: receipt, customers: data.customers, onClose: () => setReceipt(null) }));
}

function ReceiptModal({ sale, customers, onClose }) {
  const customer = customers.find(item => item.id === sale.customerId);
  return h('div', { className: 'modal' }, h('section', { className: 'receipt' },
    h('h2', null, 'Faislabadi General Store'),
    h('p', null, `Invoice ${sale.invoiceNo}`),
    h('p', null, `Customer: ${customer?.name || 'Walk-in Customer'}`),
    h('table', null, h('tbody', null, sale.items.map(item => h('tr', { key: `${item.name}-${item.qty}` }, h('td', null, item.name), h('td', null, item.qty), h('td', null, money(item.price * item.qty)))))),
    h('h3', null, money(sale.total)),
    h('div', { className: 'success-actions no-print' }, h('button', { className: 'secondary', onClick: () => window.print() }, 'Print receipt'), h('button', { className: 'primary', onClick: onClose }, 'Close'))));
}

function DataPage({ page, data, client, refresh }) {
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({});
  const title = pages.find(item => item[0] === page)?.[1] || page;
  const rows = page === 'customers' ? data.customers : data.products;
  async function addRecord(event) {
    event.preventDefault();
    setMessage('');
    try {
      if (page === 'products' || page === 'inventory') await client.post('/api/products', form);
      if (page === 'customers') await client.post('/api/customers', form);
      setForm({});
      await refresh();
      setMessage('Saved.');
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  if (page === 'reports') return h(Reports, { data });
  if (page === 'purchases') return h(Purchases, { data, client, refresh });
  if (page === 'users') return h(AuditLogs, { client });
  if (page === 'settings') return h(Settings, { data, client });
  return h('div', { className: 'page' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, 'MANAGEMENT'), h('h1', null, title)), h('a', { className: 'secondary', href: '/api/reports/export.csv' }, 'Export CSV')),
    message && h('div', { className: 'notice' }, message),
    ['products', 'inventory', 'customers'].includes(page) && h('form', { className: 'inline-form', onSubmit: addRecord },
      page === 'customers' ? [
        h('input', { key: 'name', placeholder: 'Name', value: form.name || '', onChange: e => setForm({ ...form, name: e.target.value }), required: true }),
        h('input', { key: 'phone', placeholder: 'Phone', value: form.phone || '', onChange: e => setForm({ ...form, phone: e.target.value }) }),
        h('input', { key: 'cnic', placeholder: 'CNIC optional', value: form.cnic || '', onChange: e => setForm({ ...form, cnic: e.target.value }) }),
        h('button', { key: 'save', className: 'primary' }, 'Add customer')
      ] : [
        h('input', { key: 'name', placeholder: 'Product name', value: form.name || '', onChange: e => setForm({ ...form, name: e.target.value }), required: true }),
        h('input', { key: 'sku', placeholder: 'Barcode / SKU', value: form.sku || '', onChange: e => setForm({ ...form, sku: e.target.value }) }),
        h('input', { key: 'price', type: 'number', placeholder: 'Sale price', value: form.price || '', onChange: e => setForm({ ...form, price: e.target.value }), required: true }),
        h('input', { key: 'cost', type: 'number', placeholder: 'Purchase price', value: form.cost || '', onChange: e => setForm({ ...form, cost: e.target.value }) }),
        h('input', { key: 'stock', type: 'number', placeholder: 'Stock', value: form.stock || '', onChange: e => setForm({ ...form, stock: e.target.value }) }),
        h('button', { key: 'save', className: 'primary' }, 'Add product')
      ]),
    h('article', { className: 'panel data-panel' }, h('div', { className: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, (page === 'customers' ? ['Name', 'Phone', 'CNIC', 'Balance', 'Status'] : ['Product', 'SKU', 'Category', 'Stock', 'Cost', 'Price']).map(label => h('th', { key: label }, label)))),
      h('tbody', null, rows.map(row => page === 'customers'
        ? h('tr', { key: row.id }, h('td', null, h('strong', null, row.name)), h('td', null, row.phone), h('td', null, row.cnicMasked || ''), h('td', null, money(row.balance)), h('td', null, row.balance > 0 ? h(Badge, { tone: 'warning' }, 'Udhar') : h(Badge, { tone: 'success' }, 'Clear')))
        : h('tr', { key: row.id }, h('td', null, h('strong', null, row.name)), h('td', null, row.sku), h('td', null, row.category), h('td', null, `${row.stock} ${row.unit}`), h('td', null, money(row.cost)), h('td', null, money(row.price)))))))));
}

function Purchases({ data, client, refresh }) {
  const [item, setItem] = useState({ supplierId: data.suppliers[0]?.id, productId: data.products[0]?.id, qty: 1, cost: '' });
  const [message, setMessage] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      await client.post('/api/purchases', { supplierId: item.supplierId, items: [{ productId: item.productId, qty: Number(item.qty), cost: Number(item.cost) }] });
      await refresh();
      setMessage('Purchase received and stock updated.');
    } catch (err) {
      setMessage(err.message);
    }
  }
  return h('div', { className: 'page' }, h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, 'SUPPLIERS'), h('h1', null, 'Purchases'))), message && h('div', { className: 'notice' }, message), h('form', { className: 'inline-form', onSubmit: submit }, h('select', { value: item.supplierId, onChange: e => setItem({ ...item, supplierId: e.target.value }) }, data.suppliers.map(s => h('option', { value: s.id, key: s.id }, s.name))), h('select', { value: item.productId, onChange: e => setItem({ ...item, productId: e.target.value }) }, data.products.map(p => h('option', { value: p.id, key: p.id }, p.name))), h('input', { type: 'number', min: '1', value: item.qty, onChange: e => setItem({ ...item, qty: e.target.value }) }), h('input', { type: 'number', min: '1', placeholder: 'Cost', value: item.cost, onChange: e => setItem({ ...item, cost: e.target.value }) }), h('button', { className: 'primary' }, 'Receive stock')));
}

function Reports({ data }) {
  return h('div', { className: 'page' }, h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, 'PROFIT AND LOSS'), h('h1', null, 'Reports')), h('a', { className: 'secondary', href: '/api/reports/export.csv' }, 'Export CSV')),
    h('section', { className: 'metrics' }, ['day', 'month', 'year'].map(period => {
      const report = data.reports[period] || {};
      return h(Metric, { key: period, title: `${period} net sales`, value: money(report.netSales), note: `Profit ${money(report.grossProfit)} - Refunds ${money(report.refunds)}` });
    })),
    h('article', { className: 'panel' }, h('h2', null, 'Report definitions'), h('p', { className: 'subtitle' }, 'Revenue, discounts, tax, refunds, credit sales, and gross profit are calculated from persisted invoices and returns.')));
}

function AuditLogs({ client }) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { client.get('/api/audit-logs').then(setLogs).catch(err => setError(friendlyError(err))); }, [client]);
  return h('div', { className: 'page' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, 'SECURITY'), h('h1', null, 'Users and Audit Logs'))),
    error && h('div', { className: 'notice danger' }, error),
    h('article', { className: 'panel data-panel' },
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['Time', 'User', 'Action', 'Entity', 'Details'].map(label => h('th', { key: label }, label)))),
          h('tbody', null, logs.map(log => h('tr', { key: log.id },
            h('td', null, new Date(log.at).toLocaleString()),
            h('td', null, log.actorName),
            h('td', null, log.action),
            h('td', null, log.entity),
            h('td', null, JSON.stringify(log.details || {})))))))));
}

function Settings({ data, client }) {
  const [backups, setBackups] = useState([]);
  const [message, setMessage] = useState('');
  async function loadBackups() {
    try { setBackups(await client.get('/api/backups')); } catch (err) { setMessage(friendlyError(err)); }
  }
  async function createBackup() {
    try {
      await client.post('/api/backups', {});
      setMessage('Backup created. POS does not provide deletion.');
      await loadBackups();
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  async function restoreBackup(file) {
    const confirmed = window.confirm(`Restore backup ${file}? A safety backup will be created first.`);
    if (!confirmed) return;
    try {
      await client.post(`/api/backups/${encodeURIComponent(file)}/restore`, {});
      setMessage('Backup restored. Refreshing POS data now.');
      window.location.reload();
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  useEffect(() => { loadBackups(); }, [client]);
  return h('div', { className: 'page' }, h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, 'STORE SETTINGS'), h('h1', null, data.settings.storeName), h('p', { className: 'subtitle' }, `${data.settings.address} - Tax ${(data.settings.taxRate * 100).toFixed(0)}%`)), h('button', { className: 'primary', onClick: createBackup }, 'Create backup')), message && h('div', { className: 'notice' }, message), h('article', { className: 'panel' }, h('h2', null, 'Backups'), h('p', { className: 'subtitle' }, 'Backups are append-only from the POS. Delete is not available. Restore creates a safety backup first.'), backups.map(backup => h('div', { className: 'stock-row', key: backup.file }, h('strong', null, backup.file), h('button', { className: 'secondary', onClick: () => restoreBackup(backup.file) }, 'Restore')))));
}

function App() {
  const [session, setSession] = useState(() => loadJson(stateKey, null));
  const [data, setData] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const client = useMemo(() => apiClient(session?.token, setOnline), [session?.token]);

  async function refresh() {
    if (!session?.token) return;
    try {
      setError('');
      const payload = await client.get('/api/bootstrap');
      setData(payload);
    } catch (err) {
      setOnline(false);
      setError(friendlyError(err));
    }
  }

  useEffect(() => { refresh(); }, [session?.token]);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  if (!session) return h(Login, { onLogin: setSession });
  if (!data) return h('main', { className: 'loading' }, error || 'Loading POS data...');
  const role = data.user.role;
  const visiblePages = role === 'Cashier' ? pages.filter(([id]) => ['dashboard', 'pos', 'customers', 'reports'].includes(id)) : pages;
  return h('main', { className: 'app-shell' },
    h('aside', { className: 'sidebar' }, h('div', { className: 'brand' }, h('span', { className: 'brand-logo' }, 'F'), h('div', null, h('strong', null, 'Faislabadi'), h('small', null, 'GENERAL STORE'))), h('nav', null, visiblePages.map(([id, title]) => h('button', { key: id, className: page === id ? 'nav-item active' : 'nav-item', onClick: () => setPage(id) }, h('span', null, title)))), h('div', { className: 'sidebar-footer' }, h('div', { className: 'avatar' }, data.user.name.split(' ').map(part => part[0]).join('').slice(0, 2)), h('div', null, h('strong', null, data.user.name), h('small', null, role)), h('button', { className: 'more', onClick: () => { localStorage.removeItem(stateKey); setSession(null); } }, 'Logout'))),
    h('section', { className: 'main-area' }, h('header', { className: 'topbar' }, h('div', { className: 'crumb' }, 'Faislabadi General Store / ', h('strong', null, pages.find(item => item[0] === page)?.[1])), h('div', { className: 'top-actions' }, h('span', { className: online ? 'sync-status' : 'sync-status offline' }, online ? 'Online' : 'Offline'), h('button', { className: 'secondary', onClick: refresh }, 'Refresh'))), page === 'dashboard' ? h(Dashboard, { data, go: setPage }) : page === 'pos' ? h(POS, { client, data, refresh, online, setOnline }) : h(DataPage, { page, data, client, refresh })));
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
