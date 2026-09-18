/* global React, ReactDOM */
const APP_VERSION = 'v24';
const APP_CHECKSUM = 'portal-paren-fix-v24';
(function() {
  var stored = null;
  try { stored = localStorage.getItem('faislabadi-pos-version'); } catch(_) {}
  if (stored && stored !== APP_CHECKSUM) {
    try { localStorage.removeItem('faislabadi-pos-session'); } catch(_) {}
  }
  try { localStorage.setItem('faislabadi-pos-version', APP_CHECKSUM); } catch(_) {}
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(function(reg) {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        window.location.reload();
      }
    });
  }
})();
const { useEffect, useMemo, useState } = React;
const h = React.createElement;

const pages = [
  ['dashboard', 'Dashboard'],
  ['pos', 'Point of Sale'],
  ['products', 'Products'],
  ['warehouse', 'Warehouse'],
  ['inventory', 'Inventory'],
  ['purchases', 'Purchases'],
  ['customers', 'Customers and Udhar'],
  ['returns', 'Product Returns'],
  ['reports', 'Reports'],
  ['users', 'Users and Audit'],
  ['settings', 'Settings and Backups']
];

const pagePermissions = {
  dashboard: 'dashboard',
  pos: 'pos',
  products: 'products',
  warehouse: 'warehouse',
  inventory: 'inventory',
  purchases: 'purchases',
  customers: 'customers',
  returns: 'returns:create',
  reports: 'reports',
  reportsown: 'reports:own',
  users: 'users',
  settings: 'settings'
};

function canSee(user, pageId) {
  if (!user) return false;
  const role = user.role;
  const allowed = role === 'Admin' ? ['*'] : role === 'Manager' ? permissionsList.Manager : permissionsList.Cashier;
  if (allowed.includes('*')) return true;
  const needed = pagePermissions[pageId];
  if (pageId === 'reports') return allowed.includes('reports') || allowed.includes('reports:own');
  return allowed.includes(needed);
}

const permissionsList = {
  Admin: ['*'],
  Manager: ['dashboard', 'pos', 'products', 'warehouse', 'inventory', 'purchases', 'customers', 'udhar', 'returns', 'reports', 'settings', 'backups'],
  Cashier: ['dashboard', 'pos', 'customers', 'reports:own', 'returns:create']
};

const stateKey = 'faislabadi-pos-session';
const queueKey = 'faislabadi-pos-offline-sales';
const usersCacheKey = 'faislabadi-pos-users-cache';
const bootstrapCacheKey = 'faislabadi-pos-bootstrap-cache';
const printerConfigKey = 'faislabadi-pos-printer';
const money = value => `Rs ${Math.round(Number(value || 0)).toLocaleString('en-PK')}`;
const UNITS = [
  { value: 'kg', urdu: 'کلو' },
  { value: 'gram', urdu: 'گرام' },
  { value: 'litre', urdu: 'لیٹر' },
  { value: 'pcs', urdu: 'عدد' },
  { value: 'pack', urdu: 'پیک' },
  { value: 'dozen', urdu: 'درجن' },
  { value: 'boree', urdu: 'بوری' }
];
const unitLabel = unit => (UNITS.find(item => item.value === unit) || {}).urdu || unit || '';
const isWeightUnit = unit => ['kg', 'gram', 'litre', 'boree'].includes(unit);
const pad2 = n => String(n).padStart(2, '0');
const toDateInputValue = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const toTimeInputValue = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const LANG_KEY = 'faislabadi-pos-lang';
let LANG = 'en';
try { LANG = localStorage.getItem(LANG_KEY) === 'ur' ? 'ur' : 'en'; } catch (_) {}
const STRINGS = {
  en: {
    nav_dashboard: 'Dashboard', nav_pos: 'Point of Sale', nav_products: 'Products', nav_warehouse: 'Warehouse', nav_inventory: 'Inventory',
    nav_purchases: 'Purchases', nav_customers: 'Customers and Udhar', nav_returns: 'Product Returns',
    nav_reports: 'Reports', nav_users: 'Users and Audit', nav_settings: 'Settings and Backups',
    secureLogin: 'SECURE LOGIN', signInToPos: 'Sign in to POS', emailOrPhone: 'Email or phone', password: 'Password',
    signIn: 'Sign in', offlineModeNotice: 'Offline mode - using cached data',
    loginNoServer: 'Cannot reach the POS server from this device. Check that you are on the same Wi-Fi as the shop computer (or use the website address), then try again. First-time login needs internet.',
    liveStoreOverview: 'LIVE STORE OVERVIEW', dashSubtitle: 'Sales, stock, credit and low-stock alerts from persisted data.', newSale: 'New sale',
    netSalesToday: 'Net sales today', invoicesCount: 'invoices', grossProfit: 'Gross profit', grossProfitNote: 'After product cost and discounts',
    creditSales: 'Credit sales', creditSalesNote: 'Added to Udhar balances', lowStockItems: 'Low stock items', lowStockNote: 'At or below reorder level',
    recentInvoices: 'Recent invoices', latestSales: 'Latest persisted sales', lowStockAlert: 'Low stock alert', needsRestock: 'Products needing replenishment',
    remainingReorder: 'remaining, reorder at', noLowStock: 'No low stock items.',
    thInvoice: 'Invoice', thCustomer: 'Customer', thPayment: 'Payment', thDate: 'Date', thTotal: 'Total', thStatus: 'Status',
    walkIn: 'Walk-in Customer', voided: 'Voided', posted: 'Posted', noSalesYet: 'No sales recorded yet.',
    counterOnline: 'COUNTER ONLINE', counterOffline: 'COUNTER OFFLINE', synced: 'Synced', queued: 'queued', revertBill: 'Revert / Return bill',
    searchPlaceholder: 'Scan barcode or search product name', looseItem: 'Loose item (کھلا مال)', productName: 'Product name',
    ratePer: 'Rate per', weightQty: 'Weight/Qty', add: 'Add', available: 'available', currentInvoice: 'CURRENT INVOICE', cart: 'Cart',
    cash: 'Cash', card: 'Card', credit: 'Credit', cartEmpty: 'Cart is empty', scanOrSelect: 'Scan or select a product.',
    discount: 'Discount', taxWord: 'Tax', subtotal: 'Subtotal', customerPaysNow: 'Customer pays now', udharRemaining: 'Udhar (remaining)',
    fullyPaid: 'Fully paid', total: 'Total', paidNowFull: 'Paid now', full: 'Full', none: 'None',
    selectCustomerForUdhar: 'Select a customer for udhar', chargePayment: 'Charge payment', saveSaleUdhar: 'Save sale - Udhar',
    offlineQueuedBadge: 'queued', management: 'MANAGEMENT',
    hName: 'Name', hPhone: 'Phone', hCnic: 'CNIC', hTotalCredit: 'Total Credit', hTotalPaid: 'Total Paid', hBalance: 'Balance',
    hActions: 'Actions', hProduct: 'Product', hSku: 'SKU', hCategory: 'Category', hStock: 'Stock', hCost: 'Cost', hProfit: 'Profit', hPrice: 'Price',
    hPaymentDate: 'Payment Date', hPaymentTime: 'Payment Time', editLabel: 'Edit', saveLabel: 'Save', cancelLabel: 'Cancel',
    khata: 'Khata', payUdhar: 'Pay Udhar', clearShort: 'Clear', udharBadge: 'Udhar', clearBadge: 'Clear', activeBadge: 'Active', inactiveBadge: 'Inactive', lowBadge: 'Low',
    delete: 'Delete', saved: 'Saved.', addCustomer: 'Add customer', addProduct: 'Add product', addSupplier: 'Add supplier',
    phName: 'Name', phPhone: 'Phone', phCnicOptional: 'CNIC (optional)', phAddressOptional: 'Address (optional)',
    phProductName: 'Product name', phCategory: 'Category', phCost: 'Purchase price (cost)', profitRs: 'Profit Rs', profitPercent: 'Profit %',
    phOwnerProfit: 'Owner profit', phSalePriceAuto: 'Sale price (auto)', phLowAlertAt: 'Low stock alert at', barcodeLabel: 'Barcode:',
    udharKhataEyebrow: 'UDHAR KHATA', cnicLabel: 'CNIC:', totalCreditPurchases: 'Total credit purchases', totalPaidLabel: 'Total paid',
    remaining: 'Remaining', payUdharMax: 'Pay udhar - max', clearUdharBtn: 'Clear Udhar', loading: 'Loading...', noUdharHistory: 'No udhar history yet.',
    creditSaleEntry: 'Credit sale', paymentReceived: 'Payment received', close: 'Close',
    saleReturnsEyebrow: 'SALE RETURNS', returnsSubtitle: 'Search a bill by invoice number, then return selected products or the complete bill. Stock and udhar update automatically.',
    enterBillId: 'Enter Bill ID / Invoice No (e.g. FS-1049)', findInvoice: 'Find invoice', noInvoiceLoaded: 'No invoice loaded yet.',
    voidedBlocked: 'This invoice was cancelled/voided - returns are not allowed.', invoiceWord: 'Invoice', cashierLabel: 'Cashier:',
    customerLabel: 'Customer:', paymentLabel: 'Payment:', paidLabel: 'Paid', udharDueLabel: 'Udhar due', returnStatusLabel: 'Return status:',
    hPurchased: 'Purchased', hAlreadyReturned: 'Already returned', hCanStillReturn: 'Can still return', hReturnNow: 'Return now',
    fullyReturned: 'Fully returned', reasonOptional: 'Reason (optional)', returnSelected: 'Return selected products', returnComplete: 'Return complete bill',
    voidBill: 'Void / Reverse Bill', voidBillConfirm: 'Void this entire bill?', voidBillDetail: 'This will cancel the bill, restore all stock, and mark it as voided. This cannot be undone.',
    voidBillSuccess: 'Bill voided and stock restored.', alreadyVoided: 'This bill is already voided.',
    previousReturns: 'Previous returns on this invoice', administration: 'ADMINISTRATION', usersRolesAudit: 'Users, Roles and Audit',
    onlyAdminManages: 'Only Admin can manage user accounts.', userAccounts: 'User accounts', hRole: 'Role', hEmail: 'Email', hTime: 'Time',
    hUser: 'User', hAction: 'Action', hEntity: 'Entity', hDetails: 'Details', changeSuffix: '/ change', disable: 'Disable', enable: 'Enable',
    resetPassword: 'Reset password', addUser: 'Add user', phFullName: 'Full name', phEmailLogin: 'Email (login)', phPhoneLogin: 'Phone (login)',
    phPasswordMin8: 'Password (min 8, letters+numbers)', suppliersEyebrow: 'SUPPLIERS', receiveStock: 'Receive stock', phCostPerUnit: 'Cost per unit',
    purchaseDone: 'Purchase received and stock updated.', pnlEyebrow: 'PROFIT AND LOSS', reportDefinitions: 'Report definitions',
    reportDefinitionsNote: 'Revenue, discounts, tax, refunds, credit sales, and gross profit are calculated from persisted invoices and returns.',
    profitNote: 'Profit', refundsNote: 'Refunds',     securityEyebrow: 'SECURITY', storeSettings: 'STORE SETTINGS',
    createBackup: 'Create backup', changePasswordHeading: 'Change password', currentPassword: 'Current password', newPassword: 'New password',
    confirmNewPassword: 'Confirm new password', updatePassword: 'Update password', backupsHeading: 'Backups',
    backupsNote: 'Backups are append-only from the POS. Delete is not available. Restore creates a safety backup first.', restore: 'Restore',
    startFresh: 'Start Fresh (Reset)', startFreshNote: 'Deletes ALL sales, udhar khata, payments and customer records for a new beginning. Products, users and settings are kept unless you choose to remove products too. Create a backup first!',
    resetShopData: 'Reset shop data', online: 'Online', offline: 'Offline', refresh: 'Refresh', logout: 'Logout',
    printerSettings: 'PRINTER & SCANNER', autoPrint: 'Auto-print after sale', autoPrintNote: 'Automatically print receipt after every sale',
    paperSize: 'Paper size', paper58: '58mm (small)', paper80: '80mm (standard)', paperA4: 'A4 / Letter',
    scanMode: 'Scanner mode', scanModeNote: 'Barcode scanner connects as keyboard - scan into the POS search box', scanModeAlways: 'Scanner is always ready', scanModeManual: 'Press F3 to focus scanner input',
    cloudSynced: 'Cloud synced', cloudPending: 'Cloud pending', cloudConnecting: 'Cloud connecting', waitingFirstSync: 'Waiting for first cloud sync',
    cloudSyncedAt: 'Cloud synced', loadingData: 'Loading POS data...', offlineCached: 'Offline mode - showing cached data',
    offlineNoCache: 'Offline and no cached data. Connect to the internet first.', langSwitch: 'اردو',
    whEyebrow: 'WAREHOUSE MANAGEMENT', whAddItem: 'Add warehouse item', whTransfer: 'Transfer Stock', whTransferToProduct: 'To Product', whTransferToWarehouse: 'To Warehouse',
    whLocation: 'Location', whSupplier: 'Supplier', phWhName: 'Item name', phWhLocation: 'Bin / Location', phWhSupplier: 'Supplier (optional)',
    phTransferQty: 'Quantity', transferDone: 'Stock transferred successfully.', linkedProduct: 'Linked Product', linkProduct: 'Link product', unlinkProduct: 'Unlink'
  },
  ur: {
    nav_dashboard: 'ڈیش بورڈ', nav_pos: 'نئی فروخت', nav_products: 'پروڈکٹس', nav_warehouse: 'گودام', nav_inventory: 'اسٹاک',
    nav_purchases: 'خریداری', nav_customers: 'گاہک اور اُدھار', nav_returns: 'پروڈکٹ واپسی',
    nav_reports: 'رپورٹس', nav_users: 'یوزرز اور آڈٹ', nav_settings: 'سیٹنگز اور بیک اپ',
    secureLogin: 'محفوظ لاگ ان', signInToPos: 'پی او ایس میں سائن کریں', emailOrPhone: 'ای میل یا موبائل نمبر', password: 'پاس ورڈ',
    signIn: 'سائن ان', offlineModeNotice: 'آف لائن موڈ - محفوظ شدہ پرانا ڈیٹا',
    loginNoServer: 'اس ڈیوائس سے پی او ایس سرور تک رسائی نہیں مل رہی۔ چیک کریں کہ آپ دکان کے کمپیوٹر والے وائی فائی پر ہیں (یا ویب سائٹ کا پتہ استعمال کریں) پھر دوبارہ کوشش کریں۔ پہلی بار لاگ ان کے لیے انٹرنیٹ ضروری ہے۔',
    liveStoreOverview: 'لائیو اسٹور', dashSubtitle: 'فروخت، اسٹاک، اُدھار اور کم اسٹاک کی اطلاعات۔', newSale: 'نئی سیل',
    netSalesToday: 'آج کی خالص فروخت', invoicesCount: 'بل', grossProfit: 'کل منافع', grossProfitNote: 'لاگت اور رعایت کے بعد',
    creditSales: 'اُدھار فروخت', creditSalesNote: 'گاہکوں کے اُدھار میں شامل', lowStockItems: 'کم اسٹاک اشیاء', lowStockNote: 'دوبارہ آرڈر کی سطح پر یا اس سے کم',
    recentInvoices: 'حالیہ بل', latestSales: 'تازہ ترین فروخت', lowStockAlert: 'کم اسٹاک الرٹ', needsRestock: 'جو اشیاء دوبارہ منگوانی ہیں',
    remainingReorder: 'باقی، دوبارہ آرڈر پر', noLowStock: 'کوئی کم اسٹاک چیز نہیں۔',
    thInvoice: 'بل نمبر', thCustomer: 'گاہک', thPayment: 'ادائیگی', thDate: 'تاریخ', thTotal: 'کل', thStatus: 'حالت',
    walkIn: 'عمومی گاہک', voided: 'منسوخ', posted: 'درج', noSalesYet: 'ابھی کوئی فروخت نہیں ہوئی۔',
    counterOnline: 'کاؤنٹر آن لائن', counterOffline: 'کاؤنٹر آف لائن', synced: 'سنک', queued: 'زیرِ انتظار', revertBill: 'بل واپسی / ریٹرن',
    searchPlaceholder: 'بارکوڈ اسکین کریں یا پروڈکٹ کا نام لکھیں', looseItem: 'کھلا مال', productName: 'پروڈکٹ کا نام',
    ratePer: 'ریٹ فی', weightQty: 'وزن/تعداد', add: 'شامل کریں', available: 'موجود', currentInvoice: 'موجودہ بل', cart: 'کارٹ',
    cash: 'نقد', card: 'کارڈ', credit: 'اُدھار', cartEmpty: 'کارٹ خالی ہے', scanOrSelect: 'پروڈکٹ اسکین کریں یا منتخب کریں۔',
    discount: 'رعایت', taxWord: 'ٹیکس', subtotal: 'ذیلی کل', customerPaysNow: 'گاہک اب دے رہا ہے', udharRemaining: 'اُدھار (باقی)',
    fullyPaid: 'مکمل ادائیگی', total: 'ٹوٹل', paidNowFull: 'ابھی ادائیگی', full: 'پورا', none: 'کچھ نہیں',
    selectCustomerForUdhar: 'اُدھار کے لیے گاہک منتخب کریں', chargePayment: 'ادائیگی وصول کریں', saveSaleUdhar: 'سیل محفوظ کریں - اُدھار',
    offlineQueuedBadge: 'زیرِ انتظار', management: 'انتظامیہ',
    hName: 'نام', hPhone: 'موبائل', hCnic: 'شناختی نمبر', hTotalCredit: 'کل اُدھار', hTotalPaid: 'کل ادائیگی', hBalance: 'بقیہ',
    hActions: 'ایکشن', hProduct: 'پروڈکٹ', hSku: 'کوڈ', hCategory: 'قسم', hStock: 'اسٹاک', hCost: 'لاگت', hProfit: 'منافع', hPrice: 'قیمت',
    hPaymentDate: 'ادائیگی کی تاریخ', hPaymentTime: 'ادائیگی کا وقت', editLabel: 'ترمیم', saveLabel: 'محفوظ', cancelLabel: 'منسوخ',
    khata: 'کھاتہ', payUdhar: 'اُدھار وصول', clearShort: 'کلیر', udharBadge: 'اُدھار', clearBadge: 'صاف', activeBadge: 'فعال', inactiveBadge: 'بند', lowBadge: 'کم',
    delete: 'ڈیلیٹ', saved: 'محفوظ ہو گیا۔', addCustomer: 'گاہک شامل کریں', addProduct: 'پروڈکٹ شامل کریں', addSupplier: 'سپلائر شامل کریں',
    phName: 'نام', phPhone: 'موبائل', phCnicOptional: 'شناختی نمبر (اختیاری)', phAddressOptional: 'پتہ (اختیاری)',
    phProductName: 'پروڈکٹ کا نام', phCategory: 'قسم', phCost: 'خرید قیمت (لاگت)', profitRs: 'منافع روپے', profitPercent: 'منافع فیصد',
    phOwnerProfit: 'مالکانہ منافع', phSalePriceAuto: 'فروخت قیمت (خود بخود)', phLowAlertAt: 'کم اسٹاک الرٹ پر', barcodeLabel: 'بارکوڈ:',
    udharKhataEyebrow: 'اُدھار کھاتہ', cnicLabel: 'شناختی کارڈ:', totalCreditPurchases: 'کل اُدھار خریداری', totalPaidLabel: 'کل ادا شدہ',
    remaining: 'باقی', payUdharMax: 'اُدھار وصول کریں - زیادہ سے زیادہ', clearUdharBtn: 'پورا اُدھار کلیر کریں', loading: 'لوڈ ہو رہا ہے...', noUdharHistory: 'ابھی اُدھار کی تاریخ نہیں۔',
    creditSaleEntry: 'اُدھار سیل', paymentReceived: 'ادائیگی موصول', close: 'بند کریں',
    saleReturnsEyebrow: 'فروخت واپسی', returnsSubtitle: 'بل نمبر سے بل تلاش کریں، پھر منتخب اشیاء یا پورا بل واپس کریں۔ اسٹاک اور اُدھار خود بخود اپڈیٹ ہو جائیں گے۔',
    enterBillId: 'بل آئی ڈی / انوائس نمبر لکھیں (مثلاً FS-1049)', findInvoice: 'بل تلاش کریں', noInvoiceLoaded: 'ابھی کوئی بل کھولا نہیں گیا۔',
    voidedBlocked: 'یہ بل منسوخ ہو چکا ہے - واپسی ممکن نہیں۔', invoiceWord: 'بل', cashierLabel: 'کیشئر:',
    customerLabel: 'گاہک:', paymentLabel: 'ادائیگی:', paidLabel: 'ادا شدہ', udharDueLabel: 'اُدھار باقی', returnStatusLabel: 'واپسی کی حالت:',
    hPurchased: 'خریدا', hAlreadyReturned: 'پہلے واپس', hCanStillReturn: 'ابھی واپس ہو سکتا', hReturnNow: 'ابھی واپس',
    fullyReturned: 'مکمل واپس', reasonOptional: 'وجہ (اختیاری)', returnSelected: 'منتخب اشیاء واپس کریں', returnComplete: 'پورا بل واپس کریں',
    voidBill: 'بل منسوخ / واپس کریں', voidBillConfirm: 'یہ پورا بل منسوخ کریں؟', voidBillDetail: 'اس سے بل منسوخ ہو جائے گا، تمام اسٹاک واپس آئے گا اور بل منسوخ نشان لگ جائے گا۔ یہ واپس نہیں ہو سکتا۔',
    voidBillSuccess: 'بل منسوخ اور اسٹاک واپس ہو گیا۔', alreadyVoided: 'یہ بل پہلے منسوخ ہو چکا ہے۔',
    previousReturns: 'اس بل کی پچھلی واپسیاں', administration: 'انتظام', usersRolesAudit: 'یوزرز، رولز اور آڈٹ',
    onlyAdminManages: 'صرف ایڈمن یوزر اکاؤنٹس سنبھال سکتا ہے۔', userAccounts: 'یوزر اکاؤنٹس', hRole: 'عہدہ', hEmail: 'ای میل', hTime: 'وقت',
    hUser: 'یوزر', hAction: 'عمل', hEntity: 'چیز', hDetails: 'تفصیل', changeSuffix: '/ تبدیل', disable: 'بند کریں', enable: 'چالو کریں',
    resetPassword: 'پاس ورڈ بدلیں', addUser: 'یوزر شامل کریں', phFullName: 'پورا نام', phEmailLogin: 'ای میل (لاگ ان)', phPhoneLogin: 'موبائل (لاگ ان)',
    phPasswordMin8: 'پاس ورڈ (کم از کم 8، حروف+اعداد)', suppliersEyebrow: 'سپلائرز', receiveStock: 'اسٹاک وصول کریں', phCostPerUnit: 'فی یونٹ لاگت',
    purchaseDone: 'خریداری موصول اور اسٹاک اپڈیٹ ہو گیا۔', pnlEyebrow: 'نقصان اور منافع', reportDefinitions: 'رپورٹ کی تعریفات',
    reportDefinitionsNote: 'آمدنی، رعایات، ٹیکس، واپسیاں، اُدھار فروخت اور کل منافع محفوظ شدہ بلز اور واپسیوں سے حساب کیا جاتا ہے۔',
    profitNote: 'منافع', refundsNote: 'واپسیاں',     securityEyebrow: 'سیکیورٹی', storeSettings: 'اسٹور سیٹنگز',
    createBackup: 'بیک اپ بنائیں', changePasswordHeading: 'پاس ورڈ تبدیل کریں', currentPassword: 'موجودہ پاس ورڈ', newPassword: 'نیا پاس ورڈ',
    confirmNewPassword: 'نیا پاس ورڈ دوبارہ', updatePassword: 'پاس ورڈ اپڈیٹ کریں', backupsHeading: 'بیک اپس',
    backupsNote: 'بیک اپس صرف بنائے جا سکتے ہیں، ڈیلیٹ نہیں۔ بحالی سے پہلے حفاظتی بیک اپ بن جاتا ہے۔', restore: 'بحال کریں',
    startFresh: 'نیا آغاز (ری سیٹ)', startFreshNote: 'تمام سیلز، اُدھار کھاتہ، ادائیگیاں اور گاہک ریکارڈ ڈیلیٹ ہوں گے۔ پروڈکٹس، یوزرز اور سیٹنگز رہیں گی جب تک آپ پروڈکٹس بھی ڈیلیٹ نہ کریں۔ پہلے بیک اپ بنائیں!',
    resetShopData: 'دکان کا ڈیٹا ری سیٹ کریں', online: 'آن لائن', offline: 'آف لائن', refresh: 'ریفریش', logout: 'لاگ آؤٹ',
    printerSettings: 'پرنٹر اور اسکینر', autoPrint: 'فروخت کے بعد خود بخود پرنٹ', autoPrintNote: 'ہر فروخت کے بعد رسید خود بخود پرنٹ ہو',
    paperSize: 'کاغذ کا سائز', paper58: '58mm (چھوٹا)', paper80: '80mm (معمول)', paperA4: 'A4 / لیٹر',
    scanMode: 'اسکینر موڈ', scanModeNote: 'بارکوڈ اسکینر کی بورڈ کی طرح کام کرتا ہے - پی او ایس سرچ باکس میں اسکین کریں', scanModeAlways: 'اسکینر ہمیشہ تیار ہے', scanModeManual: 'اسکینر انپٹ پر فوکس کے لیے F3 دبائیں',
    cloudSynced: 'کلاؤڈ سنک', cloudPending: 'کلاؤڈ زیرِ انتظار', cloudConnecting: 'کلاؤڈ جوڑ رہے ہیں', waitingFirstSync: 'پہلی کلاؤڈ سنک کا انتظار',
    cloudSyncedAt: 'کلاؤڈ سنک ہوا', loadingData: 'ڈیٹا لوڈ ہو رہا ہے...', offlineCached: 'آف لائن موڈ - پرانا ڈیٹا دکھایا جا رہا ہے',
    offlineNoCache: 'آف لائن ہیں اور کوئی محفوظ ڈیٹا نہیں۔ پہلے انٹرنیٹ سے جوڑیں۔', langSwitch: 'English',
    whEyebrow: 'گودام انتظام', whAddItem: 'گودام میں شامل کریں', whTransfer: 'اسٹاک منتقل کریں', whTransferToProduct: 'پروڈکٹ کو', whTransferToWarehouse: 'گودام کو',
    whLocation: 'لوکیشن', whSupplier: 'سپلائر', phWhName: 'چیز کا نام', phWhLocation: 'بن / لوکیشن', phWhSupplier: 'سپلائر (اختیاری)',
    phTransferQty: 'تعداد', transferDone: 'اسٹاک منتقل ہو گیا۔', linkedProduct: 'لنکڈ پروڈکٹ', linkProduct: 'لنک کریں', unlinkProduct: 'لنک ہٹائیں'
  }
};
const t = key => (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
function applyLangToDocument() {
  const rtl = LANG === 'ur';
  document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', rtl ? 'ur' : 'en');
}
applyLangToDocument();

const loadJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
};
const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const ERROR_UR = [
  [/billing history\. Mark it Inactive/i, 'اس پروڈکٹ کی بلنگ کی تاریخ ہے۔ ڈیلیٹ کے بجائے اسے "بند (Inactive)" کر دیں تاکہ پرانے بل درست رہیں۔'],
  [/Permission denied/i, 'آپ کو اجازت نہیں ہے۔'],
  [/Not enough stock for (.+)/i, null],
  [/Customer name is required/i, 'گاہک کا نام لازمی ہے۔'],
  [/registered customer/i, 'اُدھار کے لیے رجسٹرڈ گاہک ضروری ہے۔'],
  [/more than the udhar balance/i, 'رقم اُدھار کے بقایا سے زیادہ ہے۔'],
  [/already been fully returned/i, 'یہ بل پہلے مکمل واپس ہو چکا ہے۔'],
  [/Cannot return more than/i, 'اتنی مقدار واپس نہیں ہو سکتی جتنی خریدی گئی تھی۔'],
  [/temporarily unavailable|weak right now/i, 'اسٹور ڈیٹابیس عارضی طور پر سست ہے۔ چند سیکنڈ بعد دوبارہ کوشش کریں۔']
];
const friendlyError = error => {
  const raw = String((error && error.message) || 'Request failed');
  if (/Failed to fetch/i.test(raw)) {
    return LANG === 'ur' ? 'آپ آف لائن ہیں۔ کچھ فیچرز محدود ہو سکتے ہیں۔' : 'You are offline. Some features may be limited.';
  }
  if (LANG === 'ur') {
    for (const [pattern, replacement] of ERROR_UR) {
      if (replacement !== null && pattern.test(raw)) return raw.replace(pattern, replacement);
    }
  }
  return raw;
};

let _confirmResolve = null;
let _confirmState = { show: false, title: '', message: '' };

function askConfirm(title, message) {
  return new Promise(function(resolve) {
    _confirmResolve = resolve;
    _confirmState = { show: true, title: title, message: message };
    renderConfirm();
  });
}

function renderConfirm() {
  var el = document.getElementById('confirm-modal-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'confirm-modal-root';
    document.body.appendChild(el);
  }
  if (!_confirmState.show) { el.innerHTML = ''; return; }
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
  var card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:14px;padding:24px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.25);text-align:center;';
  var titleEl = document.createElement('h3');
  titleEl.textContent = _confirmState.title;
  titleEl.style.cssText = 'margin:0 0 12px;font-size:18px;color:#1a1a2e;';
  var msgEl = document.createElement('p');
  msgEl.textContent = _confirmState.message;
  msgEl.style.cssText = 'margin:0 0 20px;font-size:14px;color:#555;white-space:pre-line;line-height:1.5;';
  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';
  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = LANG === 'ur' ? 'منسوخ' : 'Cancel';
  cancelBtn.style.cssText = 'padding:10px 24px;border-radius:8px;border:1px solid #ccc;background:#fff;font-size:15px;font-weight:600;cursor:pointer;min-width:80px;';
  var okBtn = document.createElement('button');
  okBtn.textContent = LANG === 'ur' ? 'ٹھیک ہے' : 'OK';
  okBtn.style.cssText = 'padding:10px 24px;border-radius:8px;border:none;background:#c0392b;color:#fff;font-size:15px;font-weight:600;cursor:pointer;min-width:80px;';
  cancelBtn.onclick = function() { _confirmState.show = false; renderConfirm(); if (_confirmResolve) _confirmResolve(false); };
  okBtn.onclick = function() { _confirmState.show = false; renderConfirm(); if (_confirmResolve) _confirmResolve(true); };
  overlay.onclick = function(e) { if (e.target === overlay) { _confirmState.show = false; renderConfirm(); if (_confirmResolve) _confirmResolve(false); } };
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(okBtn);
  card.appendChild(titleEl);
  card.appendChild(msgEl);
  card.appendChild(btnRow);
  overlay.appendChild(card);
  el.innerHTML = '';
  el.appendChild(overlay);
}

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
    if (!response.ok) throw new Error(payload.message || payload.error || 'Request failed');
    return payload;
  }
  async function exportCsv(path, filename) {
    const response = await fetch(path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) throw new Error('Export failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return {
    get: path => request(path),
    post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
    put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
    del: path => request(path, { method: 'DELETE' }),
    exportCsv
  };
}

function LangToggle({ className = 'secondary', tick }) {
  return h('button', { className, onClick: () => { setLang(LANG === 'ur' ? 'en' : 'ur'); if (tick) tick(v => v + 1); } }, t('langSwitch'));
}
function setLang(lang) {
  LANG = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
  applyLangToDocument();
}

function Login({ onLogin, langTick, bumpLang }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const isOffline = !navigator.onLine;
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
      var cachedUsers = loadJson(usersCacheKey, []);
      var existing = cachedUsers.findIndex(function(u) { return u.id === payload.user.id; });
      if (existing >= 0) cachedUsers[existing] = payload.user;
      else cachedUsers.push(payload.user);
      saveJson(usersCacheKey, cachedUsers);
      onLogin(payload);
    } catch (err) {
      if (/fetch/i.test(String(err.message)) || isOffline) {
        var cachedUsers2 = loadJson(usersCacheKey, []);
        var matched = cachedUsers2.find(function(u) {
          return u.email.toLowerCase() === login.trim().toLowerCase() || String(u.phone).replace(/[\s-]/g, '') === login.replace(/[\s-]/g, '');
        });
        if (matched) {
          saveJson(stateKey, { token: 'offline-token', user: matched, permissions: matched.role === 'Admin' ? ['*'] : matched.role === 'Manager' ? permissionsList.Manager : permissionsList.Cashier });
          onLogin({ token: 'offline-token', user: matched });
        } else {
          setError(t('loginNoServer'));
        }
      } else {
        setError(friendlyError(err));
      }
    }
  }
  return h('main', { className: 'login-page' },
    h('form', { className: 'login-card', onSubmit: submit },
      h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, h(LangToggle, { tick: bumpLang })),
      h('div', { className: 'brand login-brand' }, h('span', { className: 'brand-logo' }, 'F'), h('div', null, h('strong', null, 'Faislabadi'), h('small', null, 'GENERAL STORE POS'))),
      h('p', { className: 'eyebrow' }, t('secureLogin')),
      h('h1', null, t('signInToPos')),
      isOffline && h('div', { className: 'notice' }, t('offlineModeNotice')),
      h('label', null, t('emailOrPhone')),
      h('input', { value: login, onChange: event => setLogin(event.target.value), autoComplete: 'username', required: true, autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, inputMode: 'email' }),
      h('label', null, t('password')),
      h('input', { value: password, onChange: event => setPassword(event.target.value), type: 'password', autoComplete: 'current-password', required: true }),
      error && h('div', { className: 'notice danger' }, error),
      h('button', { className: 'primary', type: 'submit' }, t('signIn')),
      h('div', { className: 'login-hints' },
        h('p', { className: 'login-hint' }, LANG === 'ur' ? 'ایڈمن: sohaib@faislabadi.pk یا 03074224449' : 'Admin: sohaib@faislabadi.pk or 03074224449'),
        h('p', { className: 'login-hint' }, LANG === 'ur' ? 'مینیجر: akmal@faislabadi.pk یا 03024503010' : 'Manager: akmal@faislabadi.pk or 03024503010'))));
}

function Metric({ title, value, note }) {
  return h('article', { className: 'metric-card' }, h('p', null, title), h('h3', null, value), h('small', null, note));
}

function Dashboard({ data, go, client }) {
  const report = data.reports?.day || {};
  return h('div', { className: 'page dashboard' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, t('liveStoreOverview')), h('h1', null, t('nav_dashboard')), h('p', { className: 'subtitle' }, t('dashSubtitle'))), h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, h('button', { className: 'primary', onClick: () => go('pos') }, t('newSale')), h('button', { className: 'secondary', onClick: () => client.exportCsv('/api/reports/export.csv', 'sales-report.csv') }, 'Export CSV'))),
    h('section', { className: 'metrics' },
      h(Metric, { title: t('netSalesToday'), value: money(report.netSales), note: `${report.salesCount || 0} ${t('invoicesCount')}` }),
      h(Metric, { title: t('grossProfit'), value: money(report.grossProfit), note: t('grossProfitNote') }),
      h(Metric, { title: t('creditSales'), value: money(report.creditSales), note: t('creditSalesNote') }),
      h(Metric, { title: t('lowStockItems'), value: data.lowStock.length, note: t('lowStockNote') })),
    h('section', { className: 'dashboard-grid' },
      h('article', { className: 'panel' }, h('div', { className: 'panel-head' }, h('div', null, h('h2', null, t('recentInvoices')), h('p', null, t('latestSales')))), h(SalesTable, { sales: data.sales.slice(0, 8), customers: data.customers })),
      h('article', { className: 'panel' }, h('div', { className: 'panel-head' }, h('div', null, h('h2', null, t('lowStockAlert')), h('p', null, t('needsRestock')))), data.lowStock.length ? data.lowStock.map(product => h('div', { className: 'stock-row', key: product.id }, h('div', null, h('strong', null, product.name), h('small', null, `${product.stock} ${unitLabel(product.unit)} ${t('remainingReorder')} ${product.reorderLevel}`)), h(Badge, { tone: 'danger' }, t('lowBadge')))) : h('p', { className: 'empty-copy' }, t('noLowStock')))));
}

function SalesTable({ sales, customers }) {
  return h('div', { className: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, [t('thInvoice'), t('thCustomer'), t('thPayment'), t('thDate'), t('thTotal'), t('thStatus')].map(label => h('th', { key: label }, label)))),
    h('tbody', null, sales.length ? sales.map(sale => {
      const customer = customers.find(item => item.id === sale.customerId);
      return h('tr', { key: sale.id }, h('td', null, h('strong', null, sale.invoiceNo)), h('td', null, customer?.name || t('walkIn')), h('td', null, h(Badge, { tone: sale.paymentType === 'Credit' ? 'warning' : 'success' }, sale.paymentType)), h('td', null, new Date(sale.createdAt).toLocaleString()), h('td', null, h('strong', null, money(sale.total))), h('td', null, sale.voided ? h(Badge, { tone: 'danger' }, t('voided')) : h(Badge, { tone: 'success' }, t('posted'))));
    }) : h('tr', null, h('td', { colSpan: 6 }, t('noSalesYet'))))));
}

function POS({ client, data, refresh, online, setOnline, go }) {
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState([]);
  const [customerId, setCustomerId] = useState('cus_walkin');
  const [paymentType, setPaymentType] = useState('Cash');
  const [paidInput, setPaidInput] = useState('');
  const [discount, setDiscount] = useState(0);
  const [applyTax, setApplyTax] = useState(true);
  const [manual, setManual] = useState({ name: '', price: '', qty: '1', unit: 'pcs' });
  const [receipt, setReceipt] = useState(null);
  const [message, setMessage] = useState('');
  const searchRef = React.useRef(null);
  const printerCfg = loadJson(printerConfigKey, { autoPrint: false, paperSize: '80' });
  const products = data.products.filter(product => product.active && product.status !== 'inactive');
  const shown = products.filter(product => `${product.name} ${product.sku} ${product.barcode || ''} ${product.category}`.toLowerCase().includes(query.toLowerCase()));
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const tax = applyTax ? Math.round(Math.max(0, subtotal - discount) * Number(data.settings.taxRate)) : 0;
  const total = Math.max(0, subtotal - discount) + tax;
  const isCredit = paymentType === 'Credit';
  const paidNow = !isCredit ? total : Math.max(0, Math.min(total, Math.round(Number(paidInput || 0))));
  const dueAmount = Math.max(0, total - paidNow);
  const selectedCustomer = data.customers.find(item => item.id === customerId);

  function addProduct(product) {
    setCart(items => {
      const old = items.find(item => item.productId === product.id);
      if (old) return items.map(item => item.productId === product.id ? { ...item, qty: item.qty + 1 } : item);
      return [...items, { productId: product.id, name: product.name, price: product.price, qty: 1, unit: product.unit }];
    });
  }

  function scanBarcode(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const code = query.trim();
    if (!code) return;
    const codeLower = code.toLowerCase();
    const exact = products.find(product =>
      String(product.barcode || '').toLowerCase() === codeLower ||
      String(product.sku || '').toLowerCase() === codeLower
    );
    if (exact) {
      addProduct(exact);
      setQuery('');
      setMessage(LANG === 'ur' ? `${exact.name} بارکوڈ سے شامل ہو گیا۔` : `${exact.name} added by barcode.`);
    } else {
      setMessage(LANG === 'ur'
        ? `"${code}" سے کوئی پروڈکٹ نہیں ملا۔`
        : `No product found for "${code}". Check the barcode or search by name.`);
    }
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
      setMessage(LANG === 'ur' ? 'آف لائن سیلز سنک ہو گئیں۔' : 'Offline sales synced.');
      await refresh();
    } catch (_) {
      setOnline(false);
    }
  }

  async function charge() {
    if (!cart.length) return;
    if (dueAmount > 0 && (!selectedCustomer || customerId === 'cus_walkin')) {
      setMessage(LANG === 'ur'
        ? `اُدھار چھوڑنے سے پہلے رجسٹرڈ گاہک منتخب کریں۔ بقایا: روپے ${dueAmount.toLocaleString('en-PK')}`
        : 'Select a registered customer before leaving Rs ' + dueAmount.toLocaleString('en-PK') + ' as udhar.');
      return;
    }
    const payload = { clientId: `client_${Date.now()}`, customerId, paymentType, discount: Number(discount || 0), items: cart, taxRate: applyTax ? undefined : 0 };
    if (isCredit) payload.paidAmount = paidNow;
    try {
      const sale = await client.post('/api/sales', payload);
      setReceipt(sale);
      setCart([]);
      setDiscount(0);
      setPaidInput('');
      setPaymentType('Cash');
      await refresh();
      if (printerCfg.autoPrint) {
        setTimeout(() => window.print(), 500);
      }
    } catch (err) {
      if (!navigator.onLine || /fetch/i.test(err.message)) {
        const queued = loadJson(queueKey, []);
        saveJson(queueKey, [...queued, payload]);
        setReceipt({
          offlineDraft: true,
          invoiceNo: 'OFFLINE-' + Date.now().toString().slice(-5),
          createdAt: new Date().toISOString(),
          createdBy: (data.user && data.user.name) || '',
          customerId,
          paymentType,
          source: 'offline',
          items: cart.map(item => ({ productId: item.productId, name: item.name, unit: item.unit, qty: Number(item.qty), price: Number(item.price), cost: 0, manual: !item.productId })),
          subtotal: Math.round(subtotal),
          discount: Math.round(Number(discount || 0)),
          taxRate: applyTax ? Number(data.settings.taxRate) : 0,
          tax,
          total,
          paidAmount: isCredit ? paidNow : total,
          dueAmount: isCredit ? dueAmount : 0,
          returnStatus: 'none'
        });
        setCart([]);
        setDiscount(0);
        setOnline(false);
        setMessage(LANG === 'ur'
          ? 'آف لائن محفوظ ہو گیا۔ رسید نیچے پرنٹ کریں - انٹرنیٹ آنے پر سیل خود بخود سنک ہو جائے گی۔'
          : 'Saved OFFLINE. Receipt printed below - sale will sync automatically when internet returns.');
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

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'F2') {
        e.preventDefault();
        if (cart.length && !receipt) charge();
      }
      if (e.key === 'F3') {
        e.preventDefault();
        if (searchRef.current) searchRef.current.focus();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [cart, receipt]);

  const posTitle = h('div', { className: 'page-title compact' },
    h('div', null, h('p', { className: 'eyebrow' }, online ? t('counterOnline') : t('counterOffline')), h('h1', null, t('newSale'))),
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      h(Badge, { tone: online ? 'success' : 'warning' }, online ? t('synced') : `${loadJson(queueKey, []).length} ${t('queued')}`),
      go && h('button', { className: 'secondary', onClick: () => go('returns') }, t('revertBill'))));

  const cartTotals = h('div', { className: 'totals' },
    h('div', null, h('span', null, t('subtotal')), h('strong', null, money(subtotal))),
    applyTax && h('div', null, h('span', null, t('taxWord')), h('strong', null, money(tax))),
    isCredit && h('div', { className: 'paid-line' }, h('span', null, t('customerPaysNow')), h('strong', null, money(paidNow))),
    isCredit && h('div', { className: dueAmount > 0 ? 'due-line' : '' },
      h('span', null, dueAmount > 0 ? t('udharRemaining') : t('fullyPaid')),
      h('strong', { style: dueAmount > 0 ? { color: '#c0392b' } : { color: '#267152' } }, money(dueAmount))),
    h('div', { className: 'grand-total' }, h('span', null, t('total')), h('strong', null, money(total))));

  return h('div', { className: 'pos-page' },
    h('section', { className: 'pos-catalog' },
      posTitle,
      message && h('div', { className: 'notice' }, message),
      h('label', { className: 'search' }, h('input', { ref: searchRef, autoFocus: true, value: query, onChange: event => setQuery(event.target.value), onKeyDown: scanBarcode, placeholder: t('searchPlaceholder') })),
      h('form', { className: 'manual-form', onSubmit: addManual },
        h('strong', null, t('looseItem')),
        h('input', { value: manual.name, onChange: event => setManual({ ...manual, name: event.target.value }), placeholder: t('productName'), required: true }),
        h('input', { type: 'number', min: '1', value: manual.price, onChange: event => setManual({ ...manual, price: event.target.value }), placeholder: `${t('ratePer')} ${unitLabel(manual.unit)}`, required: true }),
        h('input', { type: 'number', min: '0.01', step: '0.01', value: manual.qty, onChange: event => setManual({ ...manual, qty: event.target.value }), placeholder: t('weightQty'), required: true }),
        h('select', { value: manual.unit, onChange: event => setManual({ ...manual, unit: event.target.value }) }, UNITS.map(unit => h('option', { key: unit.value, value: unit.value }, unit.urdu))),
        h('button', { className: 'secondary' }, t('add'))),
      h('div', { className: 'catalog-grid' }, shown.map(product => h('button', { className: 'pos-product', key: product.id, onClick: () => addProduct(product) },
        h('strong', null, product.name),
        h('small', null, `${product.sku ? product.sku + ' - ' : ''}${product.stock} ${unitLabel(product.unit)} ${t('available')}`),
        h('b', null, isWeightUnit(product.unit) ? `${money(product.price)}/${unitLabel(product.unit)}` : money(product.price)))))),
    h('aside', { className: 'cart-panel' },
      h('header', null, h('div', null, h('p', { className: 'eyebrow' }, t('currentInvoice')), h('h2', null, t('cart')))),
      h('select', { className: 'customer-select', value: customerId, onChange: event => setCustomerId(event.target.value) },
        data.customers.map(customer => h('option', { value: customer.id, key: customer.id }, `${customer.name}${customer.balance ? ` - ${t('udharBadge')} ${money(customer.balance)}` : ''}`))),
      h('select', { className: 'customer-select', value: paymentType, onChange: event => setPaymentType(event.target.value) },
        ['Cash', 'Card', 'Credit'].map(type => h('option', { key: type, value: type }, LANG === 'ur' ? { Cash: t('cash'), Card: t('card'), Credit: t('credit') }[type] : type))),
      h('div', { className: 'cart-list' }, cart.length ? cart.map((item, index) => h('div', { className: 'cart-line', key: `${item.productId || item.name}-${index}` },
        h('div', { className: 'line-info' },
          h('strong', null, item.name),
          h('small', null, `${money(item.price)} x ${item.qty} ${unitLabel(item.unit)}`),
          h('div', { className: 'quantity' },
            h('button', { onClick: () => changeQty(index, isWeightUnit(item.unit) ? -0.25 : -1) }, '-'),
            h('input', { className: 'qty-input', type: 'number', min: '0.01', step: isWeightUnit(item.unit) ? '0.25' : '1', value: item.qty, onChange: event => setCart(items => items.map((old, oldIndex) => oldIndex === index ? { ...old, qty: Number(event.target.value) || 0 } : old)) }),
            h('button', { onClick: () => changeQty(index, isWeightUnit(item.unit) ? 0.25 : 1) }, '+'))),
        h('strong', null, money(item.price * item.qty)))) : h('div', { className: 'empty' }, h('h3', null, t('cartEmpty')), h('p', null, t('scanOrSelect')))),
      h('div', { className: 'cart-footer' },
        h('label', null, t('discount')),
        h('input', { className: 'discount-input', type: 'number', min: '0', value: discount, onChange: event => setDiscount(Number(event.target.value)) }),
        h('label', { className: 'tax-toggle' },
          h('input', { type: 'checkbox', checked: applyTax, onChange: event => setApplyTax(event.target.checked) }),
          ` ${t('taxWord')} (${(data.settings.taxRate * 100).toFixed(0)}%)`),
        cartTotals,
        isCredit && h('div', { className: 'partial-pay-row' },
          h('input', { type: 'number', min: '0', max: total, value: paidInput, placeholder: LANG === 'ur' ? `ابھی ادائیگی (0 = پورا اُدھار ${money(total)})` : `Paid now (0 = full udhar of ${money(total)})`, onChange: event => setPaidInput(event.target.value) }),
          h('button', { className: 'secondary', onClick: () => setPaidInput(String(total)) }, t('full')),
          h('button', { className: 'secondary', onClick: () => setPaidInput('0') }, t('none'))),
        isCredit && dueAmount > 0 && (!selectedCustomer || customerId === 'cus_walkin') && h('div', { className: 'notice danger', style: { margin: '8px 20px 0' } }, t('selectCustomerForUdhar')),
        h('button', { className: 'charge', disabled: !cart.length || cart.some(item => !(Number(item.qty) > 0)), onClick: charge },
          isCredit && dueAmount > 0 ? `${t('saveSaleUdhar')} ${money(dueAmount)}` : t('chargePayment')))),
    receipt && h(ReceiptModal, { sale: receipt, customers: data.customers, settings: data.settings, onClose: () => setReceipt(null) }));
}

function ReceiptModal({ sale, customers, settings, onClose }) {
  const customer = customers.find(item => item.id === sale.customerId);
  const saleDate = new Date(sale.createdAt);
  const dateStr = saleDate.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = saleDate.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  const hasDiscount = sale.discount > 0;
  const hasTax = sale.tax > 0;
  const storeName = (settings && settings.storeName) || 'Faislabadi General Store';
  const storePhone = (settings && settings.phone) || '';
  const storeAddress = (settings && settings.address) || '';
  var taxPercent = (settings && settings.taxRate) ? (settings.taxRate * 100).toFixed(0) : '18';
  const printerCfg = loadJson(printerConfigKey, { autoPrint: false, paperSize: '80' });
  const paperClass = 'paper-' + printerCfg.paperSize;
  useEffect(() => {
    function handlePrintKey(e) { if (e.key === 'F4') { e.preventDefault(); window.print(); } }
    window.addEventListener('keydown', handlePrintKey);
    return () => window.removeEventListener('keydown', handlePrintKey);
  }, []);
  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'receipt ' + paperClass, onClick: function(e) { e.stopPropagation(); } },
      h('div', { className: 'receipt-header' },
        h('div', { className: 'receipt-brand' }, h('span', { className: 'receipt-logo' }, 'F')),
        h('h2', null, storeName),
        storeAddress && h('p', { className: 'receipt-info' }, storeAddress),
        storePhone && h('p', { className: 'receipt-info' }, storePhone)),
      h('div', { className: 'receipt-divider' }),
      h('div', { className: 'receipt-meta' },
        h('div', { className: 'receipt-row' }, h('span', null, 'Invoice'), h('span', null, sale.invoiceNo)),
        h('div', { className: 'receipt-row' }, h('span', null, 'Date'), h('span', null, dateStr)),
        h('div', { className: 'receipt-row' }, h('span', null, 'Time'), h('span', null, timeStr)),
        h('div', { className: 'receipt-row' }, h('span', null, 'Cashier'), h('span', null, sale.createdBy || '-')),
        h('div', { className: 'receipt-row' }, h('span', null, 'Customer'), h('span', null, (customer && customer.name) || 'Walk-in')),
        sale.offlineDraft && h('div', { className: 'receipt-row' }, h('span', null, 'Status'), h('span', null, 'OFFLINE - WILL SYNC'))),
      h('div', { className: 'receipt-divider' }),
      h('div', { className: 'receipt-items-header' },
        h('span', { className: 'ri-name' }, 'Item'),
        h('span', { className: 'ri-qty' }, 'Qty'),
        h('span', { className: 'ri-price' }, 'Rate'),
        h('span', { className: 'ri-total' }, 'Total')),
      h('div', { className: 'receipt-items' },
        sale.items.map(function(item) {
          return h('div', { className: 'receipt-item', key: item.name + '-' + item.qty },
            h('span', { className: 'ri-name' }, item.name),
            h('span', { className: 'ri-qty' }, `${item.qty} ${unitLabel(item.unit)}`),
            h('span', { className: 'ri-price' }, money(item.price)),
            h('span', { className: 'ri-total' }, money(item.price * item.qty)));
        })),
      h('div', { className: 'receipt-divider' }),
      h('div', { className: 'receipt-totals' },
        h('div', { className: 'receipt-row' }, h('span', null, 'Subtotal'), h('span', null, money(sale.subtotal))),
        hasDiscount && h('div', { className: 'receipt-row receipt-discount' }, h('span', null, 'Discount'), h('span', null, '- ' + money(sale.discount))),
        hasTax && h('div', { className: 'receipt-row' }, h('span', null, 'Tax (' + taxPercent + '%)'), h('span', null, money(sale.tax))),
        h('div', { className: 'receipt-row receipt-grand' }, h('span', null, 'TOTAL'), h('span', null, money(sale.total))),
        Number(sale.paidAmount) < Number(sale.total) && h('div', { className: 'receipt-row' }, h('span', null, 'Paid now'), h('span', null, money(sale.paidAmount))),
        Number(sale.paidAmount) < Number(sale.total) && h('div', { className: 'receipt-row receipt-due' }, h('span', null, 'UDHAR REMAINING'), h('span', null, money(Math.max(0, sale.total - sale.paidAmount))))),
      h('div', { className: 'receipt-divider' }),
      h('div', { className: 'receipt-paytype' },
        h('span', { className: 'receipt-badge ' + (sale.paymentType === 'Credit' ? 'badge-credit' : 'badge-cash') }, sale.paymentType)),
      h('div', { className: 'receipt-footer' },
        h('p', null, 'Thank you for shopping with us!'),
        h('p', { className: 'receipt-info' }, 'Goods once sold will not be exchanged or returned')),
      h('div', { className: 'receipt-credit' },
        h('p', { className: 'credit-title' }, 'Designed and Developed By'),
        h('p', { className: 'credit-name' }, 'Sohaib Ali'),
        h('p', { className: 'credit-phone' }, 'Mobile No: 03074224449')),
      h('div', { className: 'success-actions no-print' },
        h('button', { className: 'secondary', onClick: function() { window.print(); } }, 'Print receipt (F4)'),
        h('button', { className: 'primary', onClick: onClose }, 'Close')))),
    document.body);
}

function DataPage({ page, data, client, refresh }) {
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({});
  const [khata, setKhata] = useState(null);
  const [search, setSearch] = useState('');
  const [editCustomer, setEditCustomer] = useState(null);
  const [editProduct, setEditProduct] = useState(null);
  const title = pages.find(item => item[0] === page)?.[1] || page;
  const allRows = page === 'customers' ? data.customers : data.products;
  const searchTerm = search.trim().toLowerCase();
  const rows = searchTerm
    ? allRows.filter(row => page === 'customers'
      ? `${row.name || ''} ${row.phone || ''}`.toLowerCase().includes(searchTerm)
      : `${row.name || ''} ${row.sku || ''} ${row.barcode || ''} ${row.category || ''}`.toLowerCase().includes(searchTerm))
    : allRows;
  function setProductField(field, value) {
    setForm(old => {
      const next = { ...old, [field]: value };
      if (['cost', 'profitType', 'profitValue'].includes(field)) {
        const cost = Number(next.cost || 0);
        const profitValue = Number(next.profitValue || 0);
        const price = next.profitType === 'percent' ? cost * (1 + profitValue / 100) : cost + profitValue;
        next.price = String(Math.max(0, Math.round(price)));
      }
      return next;
    });
  }
  async function addRecord(event) {
    event.preventDefault();
    setMessage('');
    try {
      if (page === 'products' || page === 'inventory') await client.post('/api/products', form);
      if (page === 'customers') await client.post('/api/customers', form);
      setForm({});
      await refresh();
      setMessage(t('saved'));
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  if (page === 'reports') return h(Reports, { data, client });
  if (page === 'purchases') return h(Purchases, { data, client, refresh });
  if (page === 'users') return h(UsersAdmin, { client });
  if (page === 'returns') return h(ReturnsPage, { data, client, refresh });
  if (page === 'settings') return h(Settings, { data, client });

  function customerRow(row) {
    const canManageUdhar = data.user.role === 'Admin' || data.user.role === 'Manager';
    return h('tr', { key: row.id },
      h('td', null, h('strong', null, row.name)),
      h('td', null, row.phone || ''),
      h('td', null, row.cnicMasked || ''),
      h('td', null, money(row.creditPurchases || 0)),
      h('td', null, money(row.totalPaid || 0)),
      h('td', null, h('strong', { style: Number(row.balance) > 0 ? { color: '#c0392b' } : null }, money(row.balance))),
      h('td', null, row.lastPaymentAt ? toDateInputValue(row.lastPaymentAt) : h('span', { className: 'muted' }, '-')),
      h('td', null, row.lastPaymentAt ? toTimeInputValue(row.lastPaymentAt) : h('span', { className: 'muted' }, '-')),
      h('td', null, Number(row.balance) > 0 ? h(Badge, { tone: 'warning' }, t('udharBadge')) : h(Badge, { tone: 'success' }, t('clearBadge'))),
      h('td', null,
        h('button', { className: 'secondary khata-btn', onClick: () => setKhata(row) }, t('khata')),
        h('button', { className: 'secondary khata-btn', onClick: () => setEditCustomer(row) }, t('editLabel')),
        canManageUdhar && Number(row.balance) > 0 && h('button', { className: 'secondary khata-btn pay-btn', onClick: () => setKhata(row) }, t('payUdhar')),
        canManageUdhar && Number(row.balance) > 0 && h('button', { className: 'secondary khata-btn danger-btn small', onClick: () => confirmClearUdhar(row) }, t('clearShort'))));
  }
  async function confirmClearUdhar(row) {
    const ok = await askConfirm(LANG === 'ur'
      ? `${row.name} کا اُدھار کلیر کریں؟`
      : `Clear udhar for ${row.name}?`,
      LANG === 'ur'
      ? `بقیہ: ${money(row.balance)}\n\nیہ اُدھار مکمل ادا شدہ قرار پائے گا اور بیلنس روپے 0 ہو جائے گا۔ مکمل تاریخ محفوظ رہے گی۔`
      : `Remaining balance: ${money(row.balance)}\n\nThis marks the udhar as FULLY PAID and sets the balance to Rs 0. Full payment history will be kept permanently.`);
    if (!ok) return;
    try {
      await client.post(`/api/customers/${row.id}/clear-udhar`, {});
      setMessage(LANG === 'ur' ? `${row.name} کا اُدھار کلیر ہو گیا۔ تاریخ محفوظ ہے۔` : `${row.name}'s udhar cleared. History preserved.`);
      await refresh();
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  function productRow(row) {
    const canDeleteProducts = data.user.role === 'Admin' || data.user.role === 'Manager';
    const isLow = Number(row.stock) <= Number(row.reorderLevel || 0);
    return h('tr', { key: row.id },
      h('td', null, h('strong', null, row.name), row.barcode ? h('small', { style: { display: 'block', color: '#64748b' } }, `${t('barcodeLabel')} ${row.barcode}`) : null),
      h('td', null, row.sku || ''),
      h('td', null, row.category || ''),
      h('td', null, `${row.stock} ${unitLabel(row.unit)}`, isLow && row.active !== false ? h('span', null, ' ', h(Badge, { tone: 'danger' }, t('lowBadge'))) : null),
      h('td', null, money(row.cost)),
      h('td', null, h(Badge, { tone: row.price - row.cost > 0 ? 'success' : 'danger' }, money(row.price - row.cost))),
      h('td', null, isWeightUnit(row.unit) ? `${money(row.price)}/${unitLabel(row.unit)}` : money(row.price)),
      h('td', null, row.active === false || row.status === 'inactive' ? h(Badge, { tone: 'neutral' }, t('inactiveBadge')) : h(Badge, { tone: 'success' }, t('activeBadge'))),
      h('td', null,
        canDeleteProducts && h('button', { className: 'secondary small', onClick: () => setEditProduct(row) }, t('editLabel')),
        canDeleteProducts && (page === 'products' || page === 'inventory') && h('button', { className: 'secondary danger-btn small', onClick: () => confirmDeleteProduct(row) }, t('delete'))));
  }
  async function confirmDeleteProduct(row) {
    const ok = await askConfirm(LANG === 'ur'
      ? `"${row.name}" ڈیلیٹ کریں؟`
      : `Delete "${row.name}"?`,
      LANG === 'ur'
      ? `اگر یہ پروڈکٹ کسی بل میں آ چکی ہے تو ڈیلیٹ کے بجائے "بند (Inactive)" کیا جائے گا۔`
      : `If this product has billing history it will be marked Inactive instead of being deleted.`);
    if (!ok) return;
    try {
      await client.del(`/api/products/${row.id}`);
      setMessage(LANG === 'ur' ? `"${row.name}" انوینٹری سے ڈیلیٹ ہو گئی۔` : `"${row.name}" deleted from inventory.`);
      await refresh();
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (/PRODUCT_IN_USE/i.test(msg) || /billing history/i.test(msg)) {
        const markInactive = await askConfirm(LANG === 'ur'
          ? `"${row.name}" بند (Inactive) کریں؟`
          : `Mark "${row.name}" as Inactive?`,
          LANG === 'ur'
          ? `یہ پروڈکٹ پوس سے چھپ جائے گا لیکن پرانے بل محفوظ رہیں گے۔`
          : `It will hide from POS but old bills stay correct.`);
        if (markInactive) {
          try {
            await client.put(`/api/products/${row.id}`, { active: false, status: 'inactive' });
            setMessage(LANG === 'ur' ? `"${row.name}" بند (Inactive) کر دیا گیا۔` : `"${row.name}" marked as Inactive.`);
            await refresh();
          } catch (innerErr) {
            setMessage(friendlyError(innerErr));
          }
        }
      } else {
        setMessage(friendlyError(err));
      }
    }
  }
  const headers = page === 'customers'
    ? [t('hName'), t('hPhone'), t('hCnic'), t('hTotalCredit'), t('hTotalPaid'), t('hBalance'), t('hPaymentDate'), t('hPaymentTime'), t('thStatus'), t('hActions')]
    : [t('hProduct'), t('hSku'), t('hCategory'), t('hStock'), t('hCost'), t('hProfit'), t('hPrice'), t('thStatus'), t('hActions')];
  const thead = h('thead', null, h('tr', null, headers.map((label, index) => h('th', { key: index }, label))));
  const tbody = h('tbody', null, rows.length ? rows.map(row => (page === 'customers' ? customerRow(row) : productRow(row)))
    : h('tr', null, h('td', { colSpan: headers.length }, LANG === 'ur' ? 'کچھ نہیں ملا' : 'No matching records found.')));
  const customersExport = page === 'customers'
    ? h('button', { className: 'secondary', onClick: () => client.exportCsv('/api/customers/export.csv', 'customers.csv') }, 'Export CSV')
    : h('button', { className: 'secondary', onClick: () => client.exportCsv('/api/reports/export.csv', 'sales-report.csv') }, 'Export CSV');

  return h('div', { className: 'page' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, t('management')), h('h1', null, title)), customersExport),
    message && h('div', { className: 'notice' }, message),
    ['products', 'inventory', 'customers'].includes(page) && h('form', { className: 'inline-form', onSubmit: addRecord },
      page === 'customers' ? [
        h('input', { key: 'name', placeholder: t('phName'), value: form.name || '', onChange: e => setForm({ ...form, name: e.target.value }), required: true }),
        h('input', { key: 'phone', placeholder: t('phPhone'), value: form.phone || '', onChange: e => setForm({ ...form, phone: e.target.value }) }),
        h('input', { key: 'cnic', placeholder: t('phCnicOptional'), value: form.cnic || '', onChange: e => setForm({ ...form, cnic: e.target.value }) }),
        h('input', { key: 'address', placeholder: t('phAddressOptional'), value: form.address || '', onChange: e => setForm({ ...form, address: e.target.value }) }),
        h('button', { key: 'save', className: 'primary' }, t('addCustomer'))
      ] : [
        h('input', { key: 'name', placeholder: t('phProductName'), value: form.name || '', onChange: e => setProductField('name', e.target.value), required: true }),
        h('input', { key: 'category', placeholder: t('phCategory'), value: form.category || '', onChange: e => setProductField('category', e.target.value) }),
        h('input', { key: 'sku', placeholder: 'SKU / code', value: form.sku || '', onChange: e => setProductField('sku', e.target.value) }),
        h('input', { key: 'barcode', placeholder: 'Barcode (optional)', value: form.barcode || '', onChange: e => setProductField('barcode', e.target.value) }),
        h('input', { key: 'cost', type: 'number', min: '0', placeholder: t('phCost'), value: form.cost || '', onChange: e => setProductField('cost', e.target.value), required: true }),
        h('select', { key: 'profitType', value: form.profitType || 'amount', onChange: e => setProductField('profitType', e.target.value) }, [h('option', { key: 'amount', value: 'amount' }, t('profitRs')), h('option', { key: 'percent', value: 'percent' }, t('profitPercent'))]),
        h('input', { key: 'profitValue', type: 'number', min: '0', placeholder: t('phOwnerProfit'), value: form.profitValue || '', onChange: e => setProductField('profitValue', e.target.value) }),
        h('input', { key: 'price', type: 'number', min: '0', placeholder: t('phSalePriceAuto'), title: t('phSalePriceAuto'), value: form.price || '', onChange: e => setProductField('price', e.target.value), required: true }),
        h('select', { key: 'unit', value: form.unit || 'pcs', onChange: e => setProductField('unit', e.target.value), title: t('looseItem') }, UNITS.map(unit => h('option', { key: unit.value, value: unit.value }, unit.urdu))),
        h('input', { key: 'stock', type: 'number', step: 'any', placeholder: t('hStock'), value: form.stock || '', onChange: e => setProductField('stock', e.target.value) }),
        h('input', { key: 'reorderLevel', type: 'number', min: '0', placeholder: t('phLowAlertAt'), value: form.reorderLevel || '', onChange: e => setProductField('reorderLevel', e.target.value) }),
        h('button', { key: 'save', className: 'primary' }, t('addProduct'))
      ]),
    ['products', 'inventory', 'customers'].includes(page) && h('div', { className: 'table-toolbar' },
      h('label', { className: 'search' }, h('input', { type: 'search', value: search, onChange: e => setSearch(e.target.value), placeholder: page === 'customers'
        ? (LANG === 'ur' ? 'گاہک کا نام تلاش کریں...' : 'Search customers by name...')
        : (LANG === 'ur' ? 'پروڈکٹ کا نام تلاش کریں...' : 'Search products by name...') })),
      rows.length < allRows.length && h('small', { className: 'muted' }, `${rows.length} / ${allRows.length}`)),
    h('article', { className: 'panel data-panel' }, h('div', { className: 'table-wrap' }, h('table', null, thead, tbody))),
    khata && h(KhataModal, { customer: khata, client, onClose: () => setKhata(null), refresh }),
    editCustomer && h(CustomerEditModal, { customer: editCustomer, client, refresh, canEditUdhar: data.user.role === 'Admin' || data.user.role === 'Manager', onClose: () => setEditCustomer(null) }),
    editProduct && h(ProductEditModal, { product: editProduct, client, refresh, onClose: () => setEditProduct(null) }));
}

function WarehousePage({ data, client, refresh }) {
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({});
  const [search, setSearch] = useState('');
  const [transferModal, setTransferModal] = useState(null);
  const [editWh, setEditWh] = useState(null);
  const items = (data.warehouses || []).filter(item => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${item.name} ${item.sku || ''} ${item.barcode || ''} ${item.category || ''} ${item.location || ''} ${item.supplier || ''}`.toLowerCase().includes(q);
  });
  const products = data.products || [];
  const productsByName = {};
  products.forEach(p => { productsByName[p.id] = p; });

  async function addItem(event) {
    event.preventDefault();
    setMessage('');
    try {
      await client.post('/api/warehouses', form);
      setForm({});
      await refresh();
      setMessage(t('saved'));
    } catch (err) { setMessage(friendlyError(err)); }
  }

  async function deleteItem(row) {
    const ok = await askConfirm(LANG === 'ur' ? `"${row.name}" گودام سے ہٹائیں؟` : `Delete "${row.name}" from warehouse?`,
      LANG === 'ur' ? `یہ عمل واپس نہیں ہو سکتا۔` : `This cannot be undone.`);
    if (!ok) return;
    try {
      await client.del(`/api/warehouses/${row.id}`);
      setMessage(LANG === 'ur' ? `"${row.name}" گودام سے ہٹایا گیا۔` : `"${row.name}" removed from warehouse.`);
      await refresh();
    } catch (err) { setMessage(friendlyError(err)); }
  }

  async function doTransfer(direction) {
    if (!transferModal) return;
    const qty = Number(transferModal.qty);
    if (!qty || qty <= 0) { setMessage(LANG === 'ur' ? 'درست تعداد لکھیں۔' : 'Enter a valid quantity.'); return; }
    setMessage('');
    try {
      await client.post('/api/warehouses/transfer', { warehouseId: transferModal.item.id, productId: transferModal.productId, qty, direction });
      setTransferModal(null);
      await refresh();
      setMessage(t('transferDone'));
    } catch (err) { setMessage(friendlyError(err)); }
  }

  async function linkProduct(whItem) {
    const pid = window.prompt(LANG === 'ur' ? `پروڈکٹ کوڈ (SKU) یا نام لکھیں:` : `Enter product SKU or name:`, '');
    if (!pid) return;
    const match = products.find(p => p.sku === pid || p.id === pid || p.name.toLowerCase() === pid.toLowerCase());
    if (!match) { setMessage(LANG === 'ur' ? 'پروڈکٹ نہیں ملا۔' : 'Product not found.'); return; }
    try {
      await client.put(`/api/warehouses/${whItem.id}`, { linkedProductId: match.id });
      await refresh();
      setMessage(LANG === 'ur' ? `لنک ہو گیا: ${match.name}` : `Linked: ${match.name}`);
    } catch (err) { setMessage(friendlyError(err)); }
  }

  async function unlinkProduct(whItem) {
    try {
      await client.put(`/api/warehouses/${whItem.id}`, { linkedProductId: '' });
      await refresh();
    } catch (err) { setMessage(friendlyError(err)); }
  }

  function renderTable() {
    var headers = h('thead', null, h('tr', null,
      [t('hProduct'), t('hSku'), t('hCategory'), t('hStock'), t('whLocation'), t('whSupplier'), t('linkedProduct'), t('thStatus'), t('hActions')]
        .map(function(label, i) { return h('th', { key: i }, label); })));
    var bodyRows = items.map(function(item) {
      var isLow = Number(item.stock) <= Number(item.reorderLevel || 0);
      var linked = item.linkedProductId && productsByName[item.linkedProductId];
      return h('tr', { key: item.id },
        h('td', null, h('strong', null, item.name), item.barcode ? h('small', { style: { display: 'block', color: '#64748b' } }, t('barcodeLabel') + ' ' + item.barcode) : null),
        h('td', null, item.sku || ''),
        h('td', null, item.category || ''),
        h('td', null, item.stock + ' ' + unitLabel(item.unit), isLow ? h('span', null, ' ', h(Badge, { tone: 'danger' }, t('lowBadge'))) : null),
        h('td', null, item.location || ''),
        h('td', null, item.supplier || ''),
        h('td', null, linked
          ? h('span', null, h(Badge, { tone: 'success' }, linked.name), ' ', h('button', { className: 'secondary danger-btn small', style: { marginLeft: '4px', padding: '2px 6px', fontSize: '11px' }, onClick: function() { unlinkProduct(item); } }, t('unlinkProduct')))
          : h('button', { className: 'secondary small', onClick: function() { linkProduct(item); } }, t('linkProduct'))),
        h('td', null, item.active === false || item.status === 'inactive' ? h(Badge, { tone: 'neutral' }, t('inactiveBadge')) : h(Badge, { tone: 'success' }, t('activeBadge'))),
        h('td', null,
          h('button', { className: 'secondary small', onClick: function() { setEditWh(item); } }, t('editLabel')),
          h('button', { className: 'secondary small', onClick: function() { setTransferModal({ item: item, productId: item.linkedProductId || '', qty: '' }); } }, t('whTransfer')),
          h('button', { className: 'secondary danger-btn small', onClick: function() { deleteItem(item); } }, t('delete'))));
    });
    return h('article', { className: 'panel data-panel' },
      h('div', { className: 'table-wrap' },
        h('table', null, headers, h('tbody', null, bodyRows))));
  }

  function renderTransferModal() {
    if (!transferModal) return null;
    return h('div', { style: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: function(e) { if (e.target.style.background) setTransferModal(null); } },
      h('div', { style: { background: '#fff', borderRadius: '14px', padding: '24px', maxWidth: '400px', width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }, onClick: function(e) { e.stopPropagation(); } },
        h('h3', { style: { margin: '0 0 16px' } }, t('whTransfer') + ': ' + transferModal.item.name),
        h('div', { style: { marginBottom: '12px' } },
          h('label', { style: { display: 'block', marginBottom: '4px', fontWeight: 600 } }, t('hProduct')),
          h('select', { style: { width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #ddd' }, value: transferModal.productId, onChange: function(e) { setTransferModal(Object.assign({}, transferModal, { productId: e.target.value })); } },
            h('option', { value: '' }, '-- Select Product --'),
            products.filter(function(p) { return p.active !== false; }).map(function(p) {
              return h('option', { key: p.id, value: p.id }, p.name + ' (' + (p.stock || 0) + ' in stock)');
            }))),
        h('div', { style: { marginBottom: '16px' } },
          h('label', { style: { display: 'block', marginBottom: '4px', fontWeight: 600 } }, t('phTransferQty')),
          h('input', { type: 'number', min: '1', step: 'any', style: { width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #ddd' }, value: transferModal.qty, onChange: function(e) { setTransferModal(Object.assign({}, transferModal, { qty: e.target.value })); }, placeholder: (LANG === 'ur' ? 'گودام میں موجود' : 'In warehouse') + ': ' + transferModal.item.stock })),
        h('div', { style: { display: 'flex', gap: '10px' } },
          h('button', { className: 'primary', disabled: !transferModal.productId, onClick: function() { doTransfer('toProduct'); } }, t('whTransferToProduct')),
          h('button', { className: 'primary', disabled: !transferModal.productId, onClick: function() { doTransfer('toWarehouse'); } }, t('whTransferToWarehouse')),
          h('button', { className: 'secondary', onClick: function() { setTransferModal(null); } }, t('close')))));
  }

  return h('div', { className: 'page' },
    h('div', { className: 'page-title' },
      h('div', null, h('p', { className: 'eyebrow' }, t('whEyebrow')), h('h1', null, t('nav_warehouse')))),
    message && h('div', { className: 'notice' }, message),
    h('form', { className: 'inline-form', onSubmit: addItem },
      h('input', { key: 'name', placeholder: t('phWhName'), value: form.name || '', onChange: e => setForm({ ...form, name: e.target.value }), required: true }),
      h('input', { key: 'sku', placeholder: 'SKU / code', value: form.sku || '', onChange: e => setForm({ ...form, sku: e.target.value }) }),
      h('input', { key: 'barcode', placeholder: 'Barcode', value: form.barcode || '', onChange: e => setForm({ ...form, barcode: e.target.value }) }),
      h('input', { key: 'category', placeholder: t('phCategory'), value: form.category || '', onChange: e => setForm({ ...form, category: e.target.value }) }),
      h('input', { key: 'stock', type: 'number', step: 'any', placeholder: t('hStock'), value: form.stock || '', onChange: e => setForm({ ...form, stock: e.target.value }) }),
      h('input', { key: 'reorderLevel', type: 'number', min: '0', placeholder: t('phLowAlertAt'), value: form.reorderLevel || '', onChange: e => setForm({ ...form, reorderLevel: e.target.value }) }),
      h('select', { key: 'unit', value: form.unit || 'pcs', onChange: e => setForm({ ...form, unit: e.target.value }) },
        UNITS.map(unit => h('option', { key: unit.value, value: unit.value }, unit.urdu))),
      h('input', { key: 'location', placeholder: t('phWhLocation'), value: form.location || '', onChange: e => setForm({ ...form, location: e.target.value }) }),
      h('input', { key: 'supplier', placeholder: t('phWhSupplier'), value: form.supplier || '', onChange: e => setForm({ ...form, supplier: e.target.value }) }),
      h('button', { key: 'save', className: 'primary' }, t('whAddItem'))),
    h('div', { style: { margin: '12px 0' } },
      h('input', { type: 'search', placeholder: t('searchPlaceholder'), value: search, onChange: e => setSearch(e.target.value), style: { width: '100%', maxWidth: '400px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '8px' } })),
    renderTable(),
    renderTransferModal(),
    editWh && h(WarehouseEditModal, { item: editWh, client, refresh, onClose: () => setEditWh(null) }));
}

function KhataModal({ customer, client, onClose, refresh }) {
  const [entries, setEntries] = useState(null);
  const [summary, setSummary] = useState({ creditPurchases: customer.creditPurchases || 0, totalPaid: customer.totalPaid || 0 });
  const [balance, setBalance] = useState(customer.balance);
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(toDateInputValue(new Date().toISOString()));
  const [payTime, setPayTime] = useState(toTimeInputValue(new Date().toISOString()));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function loadLedger() {
    try {
      const payload = await client.get(`/api/customers/${customer.id}/ledger`);
      setEntries(payload.entries);
      setBalance(payload.customer.balance);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  useEffect(() => { loadLedger(); }, [client, customer.id]);
  async function receivePayment(event) {
    event.preventDefault();
    setMessage('');
    if (!(Number(amount) > 0)) return;
    if (Number(amount) > Number(balance)) {
      setMessage(LANG === 'ur' ? `رقم اُدھار کے بقایا (${money(balance)}) سے زیادہ ہے۔` : `Amount is more than the udhar balance (${money(balance)}).`);
      return;
    }
    setBusy(true);
    try {
      const payload = { amount: Number(amount) };
      if (payDate || payTime) {
        payload.atDate = payDate;
        payload.atTime = payTime;
      }
      const result = await client.post(`/api/customers/${customer.id}/payments`, payload);
      setBalance(result.balance);
      setAmount('');
      setMessage(LANG === 'ur' ? `${money(result.payment.amount)} وصول ہوئے۔ بقایا اُدھار: ${money(result.balance)}۔` : `Payment of ${money(result.payment.amount)} received. Remaining udhar: ${money(result.balance)}.`);
      await loadLedger();
      await loadSummary();
      refresh();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  async function loadSummary() {
    try {
      const list = await client.get('/api/customers');
      const updated = list.find(item => item.id === customer.id);
      if (updated) setSummary({ creditPurchases: updated.creditPurchases || 0, totalPaid: updated.totalPaid || 0 });
    } catch (_) {}
  }
  async function clearUdhar() {
    const ok = await askConfirm(LANG === 'ur'
      ? `${customer.name} کا پورا اُدھار کلیر کریں؟`
      : `Clear ALL udhar for ${customer.name}?`,
      LANG === 'ur'
      ? `بقیہ: ${money(balance)}\n\nبیلنس روپے 0 ہو جائے گا اور تاریخ میں "اُدھار مکمل کلیر" درج ہوگا۔`
      : `Remaining: ${money(balance)}\n\nThe balance will become Rs 0 and this will be recorded as "Udhar cleared in full" in the history.`);
    if (!ok) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await client.post(`/api/customers/${customer.id}/clear-udhar`, {});
      setBalance(0);
      setMessage(LANG === 'ur' ? `اُدھار کلیر۔ ${money(result.previousBalance)} طے ہوئے۔ تاریخ محفوظ۔` : `Udhar cleared. ${money(result.previousBalance)} was settled. History preserved.`);
      await loadLedger();
      await loadSummary();
      refresh();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  const when = at => new Date(at).toLocaleString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'khata', onClick: e => e.stopPropagation() },
      h('header', { className: 'khata-head' },
        h('div', null,
          h('p', { className: 'eyebrow' }, t('udharKhataEyebrow')),
          h('h2', null, customer.name),
          customer.phone && h('p', { className: 'subtitle' }, customer.phone),
          customer.address && h('p', { className: 'subtitle' }, customer.address),
          customer.cnicMasked && h('p', { className: 'subtitle' }, `${t('cnicLabel')} ${customer.cnicMasked}`)),
        h('span', { className: `badge ${Number(balance) > 0 ? 'warning' : 'success'}` }, Number(balance) > 0 ? `${t('udharBadge')} ${money(balance)}` : t('clearBadge'))),
      h('div', { className: 'khata-summary' },
        h('div', null, h('span', null, t('totalCreditPurchases')), h('strong', null, money(summary.creditPurchases))),
        h('div', null, h('span', null, t('totalPaidLabel')), h('strong', null, money(summary.totalPaid))),
        h('div', null, h('span', null, t('remaining')), h('strong', { style: Number(balance) > 0 ? { color: '#c0392b' } : { color: '#267152' } }, money(balance)))),
      message && h('div', { className: 'notice' }, message),
      h('form', { className: 'payment-form khata-pay-form', onSubmit: receivePayment },
        h('input', { type: 'number', min: '1', step: 'any', placeholder: `${t('payUdharMax')} ${money(balance)}`, value: amount, onChange: e => setAmount(e.target.value), required: true }),
        h('input', { type: 'date', value: payDate, onChange: e => setPayDate(e.target.value), title: t('hPaymentDate') }),
        h('input', { type: 'time', value: payTime, onChange: e => setPayTime(e.target.value), title: t('hPaymentTime') }),
        h('button', { className: 'primary', disabled: !(Number(balance) > 0) || busy }, t('payUdhar')),
        h('button', { type: 'button', className: 'danger-btn', disabled: !(Number(balance) > 0) || busy, onClick: clearUdhar }, t('clearUdharBtn'))),
      h('div', { className: 'ledger-list' },
        entries === null ? h('p', { className: 'empty-copy' }, t('loading')) :
        entries.length === 0 ? h('p', { className: 'empty-copy' }, t('noUdharHistory')) :
        entries.map(entry => h('div', { className: `ledger-entry ${entry.type}`, key: entry.id },
          h('div', { className: 'entry-info' },
            h('strong', null, entry.type === 'sale'
              ? `${t('creditSaleEntry')} ${entry.invoiceNo}`
              : `${t('paymentReceived')}${entry.invoiceNo ? ' (' + entry.invoiceNo + ')' : ''}${entry.note && !entry.invoiceNo ? ' - ' + entry.note : ''}`),
            entry.products && h('small', null, entry.products),
            h('small', null, `${when(entry.at)}${entry.createdBy ? ' - ' + entry.createdBy : ''}${entry.note && entry.invoiceNo ? ' - ' + entry.note : ''}`)),
          h('b', { className: entry.type === 'sale' ? 'amount-due' : 'amount-paid' }, entry.type === 'sale' ? `+${money(entry.amount)}` : `-${money(entry.amount)}`)))),
      h('div', { className: 'success-actions no-print' }, h('button', { className: 'primary', onClick: onClose }, t('close'))))),
    document.body);
}

function CustomerEditModal({ customer, client, refresh, canEditUdhar, onClose }) {
  const init = {
    name: customer.name || '',
    phone: customer.phone || '',
    cnic: '',
    address: customer.address || '',
    creditLimit: customer.creditLimit || 0,
    udhaarTotal: Number(customer.creditPurchases || 0),
    udhaarPaid: Number(customer.totalPaid || 0),
    paymentDate: customer.lastPaymentAt ? toDateInputValue(customer.lastPaymentAt) : '',
    paymentTime: customer.lastPaymentAt ? toTimeInputValue(customer.lastPaymentAt) : ''
  };
  const [form, setForm] = useState(init);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const remaining = Math.max(0, (Number(form.udhaarTotal) || 0) - (Number(form.udhaarPaid) || 0));

  async function save(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      const payload = { name: form.name, phone: form.phone, address: form.address, creditLimit: Number(form.creditLimit || 0) };
      if (form.cnic.trim()) payload.cnic = form.cnic.trim();
      if (canEditUdhar) {
        if (Number(form.udhaarTotal) !== init.udhaarTotal || Number(form.udhaarPaid) !== init.udhaarPaid) {
          payload.udhaarTotal = Math.max(0, Number(form.udhaarTotal) || 0);
          payload.udhaarPaid = Math.max(0, Math.min(Number(form.udhaarPaid) || 0, Number(payload.udhaarTotal)));
        }
        if (form.paymentDate !== init.paymentDate || form.paymentTime !== init.paymentTime) {
          if (form.paymentDate) payload.paymentDate = form.paymentDate;
          if (form.paymentTime) payload.paymentTime = form.paymentTime;
        }
      }
      await client.put(`/api/customers/${customer.id}`, payload);
      setMessage(LANG === 'ur' ? 'محفوظ ہو گیا۔' : 'Saved.');
      await refresh();
      onClose();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'khata', onClick: e => e.stopPropagation() },
      h('header', { className: 'khata-head' },
        h('div', null, h('p', { className: 'eyebrow' }, t('udharKhataEyebrow')), h('h2', null, `${t('editLabel')}: ${customer.name}`)),
        h('span', { className: `badge ${Number(customer.balance) > 0 ? 'warning' : 'success'}` }, Number(customer.balance) > 0 ? `${t('udharBadge')} ${money(customer.balance)}` : t('clearBadge'))),
      message && h('div', { className: 'notice' }, message),
      h('form', { className: 'edit-form', onSubmit: save },
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hName')), h('input', { value: form.name, onChange: e => setForm({ ...form, name: e.target.value }), required: true })),
          h('div', null, h('label', null, t('hPhone')), h('input', { value: form.phone, onChange: e => setForm({ ...form, phone: e.target.value }) })),
          h('div', null, h('label', null, t('hCnic')), h('input', { value: form.cnic, placeholder: customer.cnicMasked || t('phCnicOptional'), onChange: e => setForm({ ...form, cnic: e.target.value }) }))),
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('phAddressOptional')), h('input', { value: form.address, onChange: e => setForm({ ...form, address: e.target.value }) })),
          h('div', null, h('label', null, 'Credit Limit'), h('input', { type: 'number', min: '0', value: form.creditLimit, onChange: e => setForm({ ...form, creditLimit: e.target.value }) }))),
        canEditUdhar && h('div', { className: 'section-label' }, t('udharKhataEyebrow')),
        canEditUdhar && h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hTotalCredit')), h('input', { type: 'number', min: '0', value: form.udhaarTotal, onChange: e => setForm({ ...form, udhaarTotal: e.target.value }) })),
          h('div', null, h('label', null, t('hTotalPaid')), h('input', { type: 'number', min: '0', value: form.udhaarPaid, onChange: e => setForm({ ...form, udhaarPaid: e.target.value }) })),
          h('div', { className: 'remaining-row' }, h('label', null, t('remaining')), h('strong', null, money(remaining)))),
        canEditUdhar && h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hPaymentDate')), h('input', { type: 'date', value: form.paymentDate, onChange: e => setForm({ ...form, paymentDate: e.target.value }) })),
          h('div', null, h('label', null, t('hPaymentTime')), h('input', { type: 'time', value: form.paymentTime, onChange: e => setForm({ ...form, paymentTime: e.target.value }) }))),
        canEditUdhar && h('p', { className: 'hint' }, LANG === 'ur'
          ? 'نوٹ: ادائیگی درج کرنے کے لیے کھاتہ کھولیں۔ اُدھار رقم اور آخری ادائیگی کی تاریخ یہاں تبدیل کی جا سکتی ہے۔'
          : 'Record payments from the Khata. Edit total / paid amounts and the last payment date/time here.'),
        h('div', { className: 'form-actions' },
          h('button', { className: 'primary', disabled: busy }, t('saveLabel')),
          h('button', { type: 'button', className: 'secondary', onClick: onClose }, t('cancelLabel')))))),
    document.body);
}

function ProductEditModal({ product, client, refresh, onClose }) {
  const init = {
    name: product.name || '',
    sku: product.sku || '',
    barcode: product.barcode || '',
    category: product.category || '',
    cost: product.cost ?? '',
    price: product.price ?? '',
    stock: product.stock ?? '',
    reorderLevel: product.reorderLevel ?? 0,
    unit: product.unit || 'pcs',
    active: product.active !== false && product.status !== 'inactive'
  };
  const [form, setForm] = useState(init);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      await client.put(`/api/products/${product.id}`, {
        name: form.name,
        sku: form.sku,
        barcode: form.barcode,
        category: form.category,
        cost: Number(form.cost) || 0,
        price: Number(form.price) || 0,
        stock: Number(form.stock) || 0,
        reorderLevel: Number(form.reorderLevel) || 0,
        unit: form.unit,
        active: form.active,
        status: form.active ? 'active' : 'inactive'
      });
      setMessage(LANG === 'ur' ? 'محفوظ ہو گیا۔' : 'Saved.');
      await refresh();
      onClose();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'khata', onClick: e => e.stopPropagation() },
      h('header', { className: 'khata-head' },
        h('div', null, h('p', { className: 'eyebrow' }, t('management')), h('h2', null, `${t('editLabel')}: ${product.name}`))),
      message && h('div', { className: 'notice' }, message),
      h('form', { className: 'edit-form', onSubmit: save },
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hProduct')), h('input', { value: form.name, onChange: e => setForm({ ...form, name: e.target.value }), required: true })),
          h('div', null, h('label', null, t('hCategory')), h('input', { value: form.category, onChange: e => setForm({ ...form, category: e.target.value }) })),
          h('div', null, h('label', null, t('hSku')), h('input', { value: form.sku, onChange: e => setForm({ ...form, sku: e.target.value }) }))),
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, 'Barcode'), h('input', { value: form.barcode, onChange: e => setForm({ ...form, barcode: e.target.value }) })),
          h('div', null, h('label', null, t('hCost')), h('input', { type: 'number', min: '0', value: form.cost, onChange: e => setForm({ ...form, cost: e.target.value }) })),
          h('div', null, h('label', null, t('hPrice')), h('input', { type: 'number', min: '0', value: form.price, onChange: e => setForm({ ...form, price: e.target.value }) }))),
        h('div', { className: 'section-label' }, LANG === 'ur' ? 'اسٹاک اور یونٹ' : 'Stock and Unit'),
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hStock')), h('input', { type: 'number', step: 'any', min: '0', value: form.stock, onChange: e => setForm({ ...form, stock: e.target.value }) })),
          h('div', null, h('label', null, t('phLowAlertAt')), h('input', { type: 'number', min: '0', value: form.reorderLevel, onChange: e => setForm({ ...form, reorderLevel: e.target.value }) })),
          h('div', null, h('label', null, `${t('hStock')} ${LANG === 'ur' ? 'اکائی' : 'Unit'}`), h('select', { value: form.unit, onChange: e => setForm({ ...form, unit: e.target.value }) }, UNITS.map(unit => h('option', { key: unit.value, value: unit.value }, unit.urdu))))),
        h('div', { className: 'edit-form-row' },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 } },
            h('input', { type: 'checkbox', checked: form.active, onChange: e => setForm({ ...form, active: e.target.checked }) }),
            form.active ? t('activeBadge') : t('inactiveBadge'))),
        h('div', { className: 'form-actions' },
          h('button', { className: 'primary', disabled: busy }, t('saveLabel')),
          h('button', { type: 'button', className: 'secondary', onClick: onClose }, t('cancelLabel')))))),
    document.body);
}

function WarehouseEditModal({ item, client, refresh, onClose }) {
  const init = {
    name: item.name || '',
    sku: item.sku || '',
    barcode: item.barcode || '',
    category: item.category || '',
    unit: item.unit || 'pcs',
    stock: item.stock ?? '',
    reorderLevel: item.reorderLevel ?? 0,
    location: item.location || '',
    supplier: item.supplier || '',
    active: item.active !== false && item.status !== 'inactive'
  };
  const [form, setForm] = useState(init);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      await client.put(`/api/warehouses/${item.id}`, {
        name: form.name,
        sku: form.sku,
        barcode: form.barcode,
        category: form.category,
        unit: form.unit,
        stock: Number(form.stock) || 0,
        reorderLevel: Number(form.reorderLevel) || 0,
        location: form.location,
        supplier: form.supplier,
        active: form.active,
        status: form.active ? 'active' : 'inactive'
      });
      setMessage(LANG === 'ur' ? 'محفوظ ہو گیا۔' : 'Saved.');
      await refresh();
      onClose();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'khata', onClick: e => e.stopPropagation() },
      h('header', { className: 'khata-head' },
        h('div', null, h('p', { className: 'eyebrow' }, t('whEyebrow')), h('h2', null, `${t('editLabel')}: ${item.name}`))),
      message && h('div', { className: 'notice' }, message),
      h('form', { className: 'edit-form', onSubmit: save },
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hProduct')), h('input', { value: form.name, onChange: e => setForm({ ...form, name: e.target.value }), required: true })),
          h('div', null, h('label', null, t('hCategory')), h('input', { value: form.category, onChange: e => setForm({ ...form, category: e.target.value }) })),
          h('div', null, h('label', null, t('hSku')), h('input', { value: form.sku, onChange: e => setForm({ ...form, sku: e.target.value }) }))),
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, 'Barcode'), h('input', { value: form.barcode, onChange: e => setForm({ ...form, barcode: e.target.value }) })),
          h('div', null, h('label', null, t('whLocation')), h('input', { value: form.location, onChange: e => setForm({ ...form, location: e.target.value }) })),
          h('div', null, h('label', null, t('whSupplier')), h('input', { value: form.supplier, onChange: e => setForm({ ...form, supplier: e.target.value }) }))),
        h('div', { className: 'section-label' }, LANG === 'ur' ? 'اسٹاک اور یونٹ' : 'Stock and Unit'),
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hStock')), h('input', { type: 'number', step: 'any', min: '0', value: form.stock, onChange: e => setForm({ ...form, stock: e.target.value }) })),
          h('div', null, h('label', null, t('phLowAlertAt')), h('input', { type: 'number', min: '0', value: form.reorderLevel, onChange: e => setForm({ ...form, reorderLevel: e.target.value }) })),
          h('div', null, h('label', null, `${t('hStock')} ${LANG === 'ur' ? 'اکائی' : 'Unit'}`), h('select', { value: form.unit, onChange: e => setForm({ ...form, unit: e.target.value }) }, UNITS.map(unit => h('option', { key: unit.value, value: unit.value }, unit.urdu))))),
        h('div', { className: 'edit-form-row' },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 } },
            h('input', { type: 'checkbox', checked: form.active, onChange: e => setForm({ ...form, active: e.target.checked }) }),
            form.active ? t('activeBadge') : t('inactiveBadge'))),
        h('div', { className: 'form-actions' },
          h('button', { className: 'primary', disabled: busy }, t('saveLabel')),
          h('button', { type: 'button', className: 'secondary', onClick: onClose }, t('cancelLabel')))))),
    document.body);
}

function SupplierEditModal({ supplier, client, refresh, onClose }) {
  const init = {
    name: supplier.name || '',
    phone: supplier.phone || '',
    address: supplier.address || '',
    active: supplier.active !== false && supplier.status !== 'inactive'
  };
  const [form, setForm] = useState(init);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      await client.put(`/api/suppliers/${supplier.id}`, {
        name: form.name,
        phone: form.phone,
        address: form.address,
        active: form.active,
        status: form.active ? 'active' : 'inactive'
      });
      setMessage(LANG === 'ur' ? 'محفوظ ہو گیا۔' : 'Saved.');
      await refresh();
      onClose();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'khata', onClick: e => e.stopPropagation() },
      h('header', { className: 'khata-head' },
        h('div', null, h('p', { className: 'eyebrow' }, t('suppliersEyebrow')), h('h2', null, `${t('editLabel')}: ${supplier.name}`))),
      message && h('div', { className: 'notice' }, message),
      h('form', { className: 'edit-form', onSubmit: save },
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hName')), h('input', { value: form.name, onChange: e => setForm({ ...form, name: e.target.value }), required: true })),
          h('div', null, h('label', null, t('hPhone')), h('input', { value: form.phone, onChange: e => setForm({ ...form, phone: e.target.value }) })),
          h('div', null, h('label', null, t('phAddressOptional')), h('input', { value: form.address, onChange: e => setForm({ ...form, address: e.target.value }) }))),
        h('div', { className: 'edit-form-row' },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 } },
            h('input', { type: 'checkbox', checked: form.active, onChange: e => setForm({ ...form, active: e.target.checked }) }),
            form.active ? t('activeBadge') : t('inactiveBadge'))),
        h('div', { className: 'form-actions' },
          h('button', { className: 'primary', disabled: busy }, t('saveLabel')),
          h('button', { type: 'button', className: 'secondary', onClick: onClose }, t('cancelLabel')))))),
    document.body);
}

function ReturnsPage({ data, client, refresh }) {
  const [search, setSearch] = useState('');
  const [lookup, setLookup] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function findInvoice(event) {
    if (event) event.preventDefault();
    setMessage('');
    setLookup(null);
    setQuantities({});
    try {
      const result = await client.get(`/api/sales/lookup?invoiceNo=${encodeURIComponent(search.trim())}`);
      setLookup(result);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  function setQty(item, value) {
    const max = Number(item.eligibleQty);
    let qty = Number(value || 0);
    if (qty > max) qty = max;
    if (qty < 0) qty = 0;
    setQuantities(old => ({ ...old, [item.productId || item.name]: qty }));
  }
  async function submitReturn(complete) {
    if (!lookup) return;
    const items = lookup.items
      .filter(item => Number(quantities[item.productId || item.name]) > 0)
      .map(item => ({ productId: item.productId, name: item.name, qty: Number(quantities[item.productId || item.name]) }));
    const label = complete
      ? (LANG === 'ur' ? `پورا بل ${lookup.sale.invoiceNo} واپس کریں؟` : `Return the COMPLETE bill ${lookup.sale.invoiceNo}?`)
      : (LANG === 'ur' ? 'واپسی کی تصدیق کریں؟' : 'Confirm return?');
    const detail = complete
      ? (LANG === 'ur' ? 'تمام باقی مقدار دوبارہ اسٹاک میں شامل ہوگی اور بل مکمل واپس شدہ لگ جائے گا۔' : 'All remaining quantities will go back to stock and the invoice will be marked fully returned.')
      : `${LANG === 'ur' ? 'اشیاء' : 'Products'}: ${items.map(item => `${item.name} x${item.qty}`).join(', ') || (LANG === 'ur' ? 'کوئی منتخب نہیں' : 'None selected')}\n${LANG === 'ur' ? 'واپس آیا مال اسٹاک میں شامل ہوگا۔' : 'Returned stock goes back to inventory.'}`;
    if (!await askConfirm(label, `${detail}\n\n${LANG === 'ur' ? 'یہ واپس نہیں ہو سکتا۔' : 'This cannot be undone.'}`)) return;
    if (!complete && !items.length) { setMessage(LANG === 'ur' ? 'کم از کم ایک پروڈکٹ کی مقدار منتخب کریں۔' : 'Select at least one product quantity to return.'); return; }
    setBusy(true);
    setMessage('');
    try {
      const record = await client.post('/api/returns', { saleId: lookup.sale.id, items: complete ? undefined : items, complete, reason });
      setMessage(LANG === 'ur'
        ? `${record.invoiceNo} کی واپس محفوظ۔ رقم روپے ${record.total.toLocaleString('en-PK')}`
          + (record.udharAdjustment > 0 ? ` (اُدھار کم ہو کر روپے ${record.udharAdjustment.toLocaleString('en-PK')}` : '')
          + (record.cashRefund > 0 ? `، نقد واپسی روپے ${record.cashRefund.toLocaleString('en-PK')})` : record.udharAdjustment > 0 ? ')' : '') + '. اسٹاک اپڈیٹ ہو گیا۔'
        : `Return saved for ${record.invoiceNo}. Refund Rs ${record.total.toLocaleString('en-PK')}` +
          (record.udharAdjustment > 0 ? ` (Udhar reduced by Rs ${record.udharAdjustment.toLocaleString('en-PK')}` : '') +
          (record.cashRefund > 0 ? `, cash refund Rs ${record.cashRefund.toLocaleString('en-PK')})` : record.udharAdjustment > 0 ? ')' : '') + '. Stock updated.');
      const result = await client.get(`/api/sales/lookup?saleId=${encodeURIComponent(lookup.sale.id)}`);
      setLookup(result);
      setQuantities({});
      setReason('');
      await refresh();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  const sale = lookup && lookup.sale;
  const canVoid = data.user.role === 'Admin' || data.user.role === 'Manager';
  async function voidBill() {
    if (!sale) return;
    if (!await askConfirm(t('voidBillConfirm'), t('voidBillDetail'))) return;
    setBusy(true);
    setMessage('');
    try {
      await client.post(`/api/sales/${sale.id}/void`, {});
      setMessage(t('voidBillSuccess'));
      const result = await client.get(`/api/sales/lookup?saleId=${encodeURIComponent(sale.id)}`);
      setLookup(result);
      await refresh();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return h('div', { className: 'page' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, t('saleReturnsEyebrow')), h('h1', null, t('nav_returns')), h('p', { className: 'subtitle' }, t('returnsSubtitle')))),
    message && h('div', { className: 'notice' }, message),
    h('form', { className: 'return-search inline-form', onSubmit: findInvoice },
      h('input', { placeholder: t('enterBillId'), value: search, onChange: e => setSearch(e.target.value), required: true }),
      h('button', { className: 'primary' }, t('findInvoice'))),
    !lookup && !message && h('p', { className: 'empty-copy' }, t('noInvoiceLoaded')),
    lookup && sale.voided && h('div', { className: 'notice danger' }, t('voidedBlocked')),
    lookup && !sale.voided && h('article', { className: 'panel' },
      h('div', { className: 'panel-head' },
        h('div', null,
          h('h2', null, `${t('invoiceWord')} ${sale.invoiceNo}`),
          h('p', null, `${new Date(sale.createdAt).toLocaleString()} - ${t('cashierLabel')} ${sale.createdByName || '-'}`),
          h('p', null, `${t('customerLabel')} ${lookup.customer ? `${lookup.customer.name} (${lookup.customer.phone || (LANG === 'ur' ? 'فون نہیں' : 'no phone')})` : t('walkIn')} - ${t('paymentLabel')} ${sale.paymentType}`),
          h('p', null, `${t('thTotal')} ${money(sale.total)} - ${t('paidLabel')} ${money(sale.paidAmount)}${sale.dueAmount > 0 ? ` - ${t('udharDueLabel')} ${money(sale.dueAmount)}` : ''}${sale.returnStatus !== 'none' ? ` - ${t('returnStatusLabel')} ${sale.returnStatus}` : ''}`))),
      h('div', { className: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, [t('hProduct'), t('hPurchased'), t('hAlreadyReturned'), t('hCanStillReturn'), t('hReturnNow')].map((label, index) => h('th', { key: index }, label)))),
        h('tbody', null, lookup.items.map(item => h('tr', { key: item.productId || item.name },
          h('td', null, h('strong', null, item.name)),
          h('td', null, `${item.qty} ${unitLabel(item.unit)}`),
          h('td', null, String(item.returnedQty)),
          h('td', null, h('strong', null, String(item.eligibleQty))),
          h('td', null, item.eligibleQty > 0
            ? h('input', { className: 'qty-input', type: 'number', min: '0', max: item.eligibleQty, step: isWeightUnit(item.unit) ? '0.25' : '1', value: quantities[item.productId || item.name] ?? '', onChange: e => setQty(item, e.target.value) })
            : h(Badge, { tone: 'neutral' }, t('fullyReturned')))))))),
      h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px' } },
        h('input', { placeholder: t('reasonOptional'), value: reason, onChange: e => setReason(e.target.value), style: { maxWidth: '260px' } }),
        h('button', { className: 'secondary', disabled: busy, onClick: () => submitReturn(false) }, t('returnSelected')),
        h('button', { className: 'danger-btn', disabled: busy || lookup.items.every(item => item.eligibleQty <= 0), onClick: () => submitReturn(true) }, t('returnComplete')),
        canVoid && h('button', { className: 'danger-btn', disabled: busy, onClick: voidBill }, t('voidBill')))),
    lookup && lookup.previousReturns.length > 0 && h('article', { className: 'panel' },
      h('h2', null, t('previousReturns')),
      lookup.previousReturns.map(record => h('div', { className: 'stock-row', key: record.id },
        h('div', null,
          h('strong', null, record.items.map(item => `${item.name} x${item.qty}`).join(', ')),
          h('small', null, `${new Date(record.createdAt).toLocaleString()} - ${record.createdByName || '-'} - ${record.reason}`)),
        h('b', { className: 'amount-paid' }, `- ${money(record.total)}`)))));
}

function UsersAdmin({ client }) {
  const [users, setUsers] = useState(null);
  const [logs, setLogs] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'Cashier', password: '' });
  const [message, setMessage] = useState('');
  async function load() {
    try { setUsers(await client.get('/api/users')); } catch (err) { setMessage(friendlyError(err)); }
    try { setLogs(await client.get('/api/audit-logs')); } catch (_) {}
  }
  useEffect(() => { load(); }, [client]);
  async function addUser(event) {
    event.preventDefault();
    setMessage('');
    try {
      await client.post('/api/users', form);
      setForm({ name: '', email: '', phone: '', role: 'Cashier', password: '' });
      setMessage(LANG === 'ur' ? 'یوزر بن گیا۔' : 'User created.');
      await load();
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  async function toggleActive(user) {
    if (!await askConfirm(LANG === 'ur' ? `${user.name} کا اکاؤنٹ ${user.active ? 'بند' : 'چالو'} کریں؟` : `${user.active ? 'Deactivate' : 'Activate'} account?`, LANG === 'ur' ? `${user.name}` : `${user.name} (${user.email})`)) return;
    try { await client.put(`/api/users/${user.id}`, { active: !user.active }); await load(); }
    catch (err) { setMessage(friendlyError(err)); }
  }
  async function changeRole(user) {
    const role = window.prompt(LANG === 'ur' ? `${user.name} کا نیا عہدہ (Admin, Manager یا Cashier):` : `New role for ${user.name} (Admin, Manager or Cashier):`, user.role);
    if (!role || role === user.role) return;
    try { await client.put(`/api/users/${user.id}`, { role }); await load(); }
    catch (err) { setMessage(friendlyError(err)); }
  }
  async function resetPassword(user) {
    const password = window.prompt(LANG === 'ur' ? `${user.name} کا نیا پاس ورڈ (کم از کم 8 حروف+اعداد):` : `New password for ${user.name} (min 8 chars, letters + numbers):`);
    if (!password) return;
    try { await client.put(`/api/users/${user.id}`, { password }); setMessage(LANG === 'ur' ? `${user.name} کا پاس ورڈ بدل گیا۔` : `Password reset for ${user.name}.`); }
    catch (err) { setMessage(friendlyError(err)); }
  }
  return h('div', { className: 'page' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, t('administration')), h('h1', null, t('usersRolesAudit')), h('p', { className: 'subtitle' }, t('onlyAdminManages')))),
    message && h('div', { className: 'notice' }, message),
    users !== null && h('article', { className: 'panel' },
      h('h2', null, t('userAccounts')),
      h('div', { className: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, [t('hName'), t('hEmail'), t('hPhone'), t('hRole'), t('thStatus'), t('hActions')].map((label, index) => h('th', { key: index }, label)))),
        h('tbody', null, users.map(user => h('tr', { key: user.id },
          h('td', null, h('strong', null, user.name)),
          h('td', null, user.email),
          h('td', null, user.phone),
          h('td', null, h('button', { className: 'secondary khata-btn', onClick: () => changeRole(user) }, user.role + ' ' + t('changeSuffix'))),
          h('td', null, user.active ? h(Badge, { tone: 'success' }, t('activeBadge')) : h(Badge, { tone: 'danger' }, t('inactiveBadge'))),
          h('td', null,
            h('button', { className: 'secondary khata-btn', onClick: () => toggleActive(user) }, user.active ? t('disable') : t('enable')),
            ' ', h('button', { className: 'secondary khata-btn', onClick: () => resetPassword(user) }, t('resetPassword'))))))))),
    h('form', { className: 'inline-form user-form', onSubmit: addUser },
      h('input', { placeholder: t('phFullName'), value: form.name, onChange: e => setForm({ ...form, name: e.target.value }), required: true }),
      h('input', { type: 'email', placeholder: t('phEmailLogin'), value: form.email, onChange: e => setForm({ ...form, email: e.target.value }), required: true }),
      h('input', { placeholder: t('phPhoneLogin'), value: form.phone, onChange: e => setForm({ ...form, phone: e.target.value }), required: true }),
      h('select', { value: form.role, onChange: e => setForm({ ...form, role: e.target.value }) }, ['Admin', 'Manager', 'Cashier'].map(role => h('option', { key: role, value: role }, role))),
      h('input', { type: 'password', placeholder: t('phPasswordMin8'), value: form.password, onChange: e => setForm({ ...form, password: e.target.value }), required: true }),
      h('button', { className: 'primary' }, t('addUser'))),
    h('article', { className: 'panel data-panel' },
      h('div', { className: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, [t('hTime'), t('hUser'), t('hAction'), t('hEntity'), t('hDetails')].map((label, index) => h('th', { key: index }, label)))),
          h('tbody', null, logs.map(log => h('tr', { key: log.id },
            h('td', null, new Date(log.at).toLocaleString()),
            h('td', null, log.actorName),
            h('td', null, log.action),
            h('td', null, log.entity),
            h('td', null, JSON.stringify(log.details || {})))))))));
}

function Purchases({ data, client, refresh }) {
  const [item, setItem] = useState({ supplierId: data.suppliers[0]?.id, productId: data.products[0]?.id, qty: 1, cost: '' });
  const [supp, setSupp] = useState({ name: '', phone: '', address: '' });
  const [editSupplier, setEditSupplier] = useState(null);
  const [message, setMessage] = useState('');
  const [suppMessage, setSuppMessage] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      await client.post('/api/purchases', { supplierId: item.supplierId, items: [{ productId: item.productId, qty: Number(item.qty), cost: Number(item.cost) }] });
      await refresh();
      setMessage(t('purchaseDone'));
    } catch (err) {
      setMessage(err.message);
    }
  }
  async function addSupplier(event) {
    event.preventDefault();
    setSuppMessage('');
    try {
      await client.post('/api/suppliers', supp);
      setSupp({ name: '', phone: '', address: '' });
      await refresh();
      setSuppMessage(LANG === 'ur' ? 'سپلائر شامل ہو گیا۔' : 'Supplier added.');
    } catch (err) {
      setSuppMessage(friendlyError(err));
    }
  }
  async function confirmDeleteSupplier(row) {
    const ok = await askConfirm(LANG === 'ur'
      ? `"${row.name}" سپلائر ڈیلیٹ کریں؟`
      : `Delete supplier "${row.name}"?`,
      LANG === 'ur' ? 'اس کی خریداری کی تاریخ نہ ہونے پر حذف ہو گا۔' : 'Deletes only if it has no purchase history.');
    if (!ok) return;
    setSuppMessage('');
    try {
      await client.del(`/api/suppliers/${row.id}`);
      await refresh();
      setSuppMessage(LANG === 'ur' ? `"${row.name}" ڈیلیٹ ہو گیا۔` : `"${row.name}" deleted.`);
    } catch (err) {
      setSuppMessage(friendlyError(err));
    }
  }
  return h('div', { className: 'page' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, t('suppliersEyebrow')), h('h1', null, t('nav_purchases'))), h('button', { className: 'secondary', onClick: () => client.exportCsv('/api/reports/export.csv', 'sales-report.csv') }, 'Export CSV')),
    message && h('div', { className: 'notice' }, message),
    h('form', { className: 'inline-form', onSubmit: submit },
      h('select', { value: item.supplierId, onChange: e => setItem({ ...item, supplierId: e.target.value }) }, data.suppliers.map(s => h('option', { value: s.id, key: s.id }, s.name))),
      h('select', { value: item.productId, onChange: e => setItem({ ...item, productId: e.target.value }) }, data.products.map(p => h('option', { value: p.id, key: p.id }, p.name))),
      h('input', { type: 'number', min: '0.01', step: 'any', value: item.qty, onChange: e => setItem({ ...item, qty: e.target.value }) }),
      h('input', { type: 'number', min: '1', placeholder: t('phCostPerUnit'), value: item.cost, onChange: e => setItem({ ...item, cost: e.target.value }) }),
      h('button', { className: 'primary' }, t('receiveStock'))),
    h('article', { className: 'panel data-panel', style: { marginTop: '18px' } },
      h('h2', null, t('suppliersEyebrow')),
      suppMessage && h('div', { className: 'notice' }, suppMessage),
      h('form', { className: 'inline-form', onSubmit: addSupplier },
        h('input', { key: 'name', placeholder: t('phName'), value: supp.name || '', onChange: e => setSupp({ ...supp, name: e.target.value }), required: true }),
        h('input', { key: 'phone', placeholder: t('hPhone'), value: supp.phone || '', onChange: e => setSupp({ ...supp, phone: e.target.value }) }),
        h('input', { key: 'address', placeholder: t('phAddressOptional'), value: supp.address || '', onChange: e => setSupp({ ...supp, address: e.target.value }) }),
        h('button', { key: 'save', className: 'primary' }, t('addSupplier'))),
      h('div', { className: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, [t('hName'), t('hPhone'), t('phAddressOptional'), t('thStatus'), t('hActions')].map((label, i) => h('th', { key: i }, label)))),
        h('tbody', null, (data.suppliers || []).map(row => h('tr', { key: row.id },
          h('td', null, h('strong', null, row.name)),
          h('td', null, row.phone || ''),
          h('td', null, row.address || ''),
          h('td', null, row.active === false || row.status === 'inactive' ? h(Badge, { tone: 'neutral' }, t('inactiveBadge')) : h(Badge, { tone: 'success' }, t('activeBadge'))),
          h('td', null,
            h('button', { className: 'secondary small', onClick: () => setEditSupplier(row) }, t('editLabel')),
            h('button', { className: 'secondary danger-btn small', onClick: () => confirmDeleteSupplier(row) }, t('delete'))))))))),
    editSupplier && h(SupplierEditModal, { supplier: editSupplier, client, refresh, onClose: () => setEditSupplier(null) }));
}

function Reports({ data, client }) {
  return h('div', { className: 'page' }, h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, t('pnlEyebrow')), h('h1', null, t('nav_reports'))), h('button', { className: 'secondary', onClick: () => client.exportCsv('/api/reports/export.csv', 'sales-report.csv') }, 'Export CSV')),
    h('section', { className: 'metrics' }, ['day', 'month', 'year'].map(period => {
      const report = data.reports[period] || {};
      const periodLabel = LANG === 'ur' ? { day: 'روزانہ', month: 'ماہانہ', year: 'سالانہ' }[period] : period;
      return h(Metric, { key: period, title: `${periodLabel} ${t('netSalesToday').replace(/^آج کی /, '')}`, value: money(report.netSales), note: `${t('profitNote')} ${money(report.grossProfit)} - ${t('refundsNote')} ${money(report.refunds)}` });
    })),
    h('article', { className: 'panel' }, h('h2', null, t('reportDefinitions')), h('p', { className: 'subtitle' }, t('reportDefinitionsNote'))));
}

function AuditLogs({ client }) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { client.get('/api/audit-logs').then(setLogs).catch(err => setError(friendlyError(err))); }, [client]);
  return h('div', { className: 'page' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, 'SECURITY'), h('h1', null, 'Users and Audit Logs')), h('button', { className: 'secondary', onClick: () => client.exportCsv('/api/reports/export.csv', 'sales-report.csv') }, 'Export CSV')),
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
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [message, setMessage] = useState('');
  const [printerCfg, setPrinterCfg] = useState(() => loadJson(printerConfigKey, { autoPrint: false, paperSize: '80' }));
  async function loadBackups() {
    try { setBackups(await client.get('/api/backups')); } catch (err) { setMessage(friendlyError(err)); }
  }
  async function createBackup() {
    try {
      await client.post('/api/backups', {});
      setMessage(LANG === 'ur' ? 'بیک اپ بن گیا۔' : 'Backup created. POS does not provide deletion.');
      await loadBackups();
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  async function restoreBackup(file) {
    const confirmed = await askConfirm(LANG === 'ur' ? `بیک اپ بحال کریں؟` : `Restore backup?`, LANG === 'ur' ? `بیک اپ ${file} بحال کریں؟ پہلے حفاظتی بیک اپ بن جائے گا۔` : `Restore backup ${file}? A safety backup will be created first.`);
    if (!confirmed) return;
    try {
      await client.post(`/api/backups/${encodeURIComponent(file)}/restore`, {});
      setMessage(LANG === 'ur' ? 'بیک اپ بحال۔ ڈیٹا ریفریش ہو رہا ہے۔' : 'Backup restored. Refreshing POS data now.');
      window.location.reload();
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  async function changePassword(event) {
    event.preventDefault();
    setMessage('');
    try {
      await client.post('/api/auth/password', passwordForm);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage(LANG === 'ur' ? 'پاس ورڈ بدل گیا۔ اگلی بار نیا پاس ورڈ استعمال کریں۔' : 'Password changed. Use the new password next time you sign in.');
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  function savePrinterSetting(key, value) {
    const next = { ...printerCfg, [key]: value };
    setPrinterCfg(next);
    saveJson(printerConfigKey, next);
    setMessage(LANG === 'ur' ? 'سیٹنگز محفوظ ہو گئیں۔' : 'Printer settings saved.');
  }
  async function resetShop() {
    if (!await askConfirm(LANG === 'ur' ? 'نیا آغاز؟' : 'START FRESH?',
      LANG === 'ur'
      ? 'اس سے تمام سیلز، اُدھار کھاتہ، ادائیگیاں اور گاہک ریکارڈ مستقل ڈیلیٹ ہوں گے۔ جاری رکھیں؟'
      : 'This permanently deletes ALL sales, udhar khata, payments and customer records. Continue?')) return;
    const clearProducts = await askConfirm(LANG === 'ur' ? 'پروڈکٹس بھی؟' : 'Also delete products?',
      LANG === 'ur'
      ? 'OK = پروڈکٹس بھی ڈیلیٹ، Cancel = پروڈکٹس رہنے دیں'
      : 'OK = delete all products too, Cancel = keep products');
    try {
      const result = await client.post('/api/reset', { clearProducts });
      setMessage(result.warning || (LANG === 'ur' ? 'ڈیٹا صاف۔ نیا آغاز تیار - ری لوڈ ہو رہا ہے...' : 'Shop data cleared. Fresh start ready - reloading...'));
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  useEffect(() => { loadBackups(); }, [client]);
  return h('div', { className: 'page' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, t('storeSettings')), h('h1', null, data.settings.storeName), h('p', { className: 'subtitle' }, `${data.settings.address} - ${t('taxWord')} ${(data.settings.taxRate * 100).toFixed(0)}%`)), h('button', { className: 'primary', onClick: createBackup }, t('createBackup'))),
    message && h('div', { className: 'notice' }, message),
    h('section', { className: 'settings-grid' },
      h('article', { className: 'panel' },
        h('h2', null, t('printerSettings')),
        h('div', { className: 'printer-settings' },
          h('label', { className: 'toggle-row' },
            h('input', { type: 'checkbox', checked: printerCfg.autoPrint, onChange: e => savePrinterSetting('autoPrint', e.target.checked) }),
            h('span', null, h('strong', null, t('autoPrint')), h('small', null, t('autoPrintNote')))),
          h('div', { className: 'setting-row' },
            h('strong', null, t('paperSize')),
            h('select', { value: printerCfg.paperSize, onChange: e => savePrinterSetting('paperSize', e.target.value) },
              h('option', { value: '58' }, t('paper58')),
              h('option', { value: '80' }, t('paper80')),
              h('option', { value: 'a4' }, t('paperA4')))),
          h('div', { className: 'setting-row' },
            h('div', null,
              h('strong', null, t('scanMode')),
              h('small', null, t('scanModeNote'))),
            h('div', { className: 'scan-info' },
              h(Badge, { tone: 'success' }, t('scanModeAlways')),
              h('small', null, 'F3 = ' + (LANG === 'ur' ? 'اسکینر فوکس' : 'Focus scanner input'), ' | F2 = ' + (LANG === 'ur' ? 'چارج' : 'Charge'), ' | F4 = ' + (LANG === 'ur' ? 'پرنٹ' : 'Print')))))),
      h('article', { className: 'panel' },
        h('h2', null, t('changePasswordHeading')),
        h('form', { className: 'password-form', onSubmit: changePassword },
          h('label', null, t('currentPassword')),
          h('input', { type: 'password', value: passwordForm.currentPassword, autoComplete: 'current-password', onChange: event => setPasswordForm({ ...passwordForm, currentPassword: event.target.value }), required: true }),
          h('label', null, t('newPassword')),
          h('input', { type: 'password', minLength: 8, value: passwordForm.newPassword, autoComplete: 'new-password', onChange: event => setPasswordForm({ ...passwordForm, newPassword: event.target.value }), required: true }),
          h('label', null, t('confirmNewPassword')),
          h('input', { type: 'password', minLength: 8, value: passwordForm.confirmPassword, autoComplete: 'new-password', onChange: event => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value }), required: true }),
          h('button', { className: 'primary', type: 'submit' }, t('updatePassword')))),
      h('article', { className: 'panel' },
        h('h2', null, t('backupsHeading')),
        h('p', { className: 'subtitle' }, t('backupsNote')),
        backups.map(backup => h('div', { className: 'stock-row', key: backup.file }, h('strong', null, backup.file), h('button', { className: 'secondary', onClick: () => restoreBackup(backup.file) }, t('restore'))))),
      h('article', { className: 'panel' },
        h('h2', null, t('startFresh')),
        h('p', { className: 'subtitle' }, t('startFreshNote')),
        h('button', { className: 'danger-btn', onClick: resetShop }, t('resetShopData')))));
}

function App() {
  const [session, setSession] = useState(() => loadJson(stateKey, null));
  const [data, setData] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [dataWarning, setDataWarning] = useState('');
  const [cloudSync, setCloudSync] = useState(null);
  const [storageNotice, setStorageNotice] = useState('');
  const [langTick, bumpLang] = useState(0);
  const client = useMemo(() => apiClient(session?.token, setOnline), [session?.token]);

  useEffect(() => {
    if (!session?.token) return undefined;
    let stopped = false;
    async function poll() {
      try {
        const status = await client.get('/api/sync-status');
        if (!stopped) {
          setCloudSync(status);
          setStorageNotice(status.mode === 'cloud' && !status.cloudConfigured
            ? 'DEMO STORAGE: this website has no cloud database connected yet, so data resets periodically and does not sync with the shop laptop. Connect Supabase to enable live data.'
            : '');
        }
      } catch (_) {}
    }
    poll();
    const timer = setInterval(poll, 20000);
    return () => { stopped = true; clearInterval(timer); };
  }, [client]);

  async function refresh() {
    if (!session?.token) return;
    try {
      setError('');
      const payload = await client.get('/api/bootstrap');
      const cached = loadJson(bootstrapCacheKey, null);
      if (cached && cached.meta && payload.meta && cached.meta.createdAt !== payload.meta.createdAt && (cached.sales?.length || 0) > 0 && payload.sales.length === 0) {
        setDataWarning('Store data on the server was reset (storage loss detected). Restore the newest backup from Settings and Backups.');
      } else {
        setDataWarning('');
      }
      setData(payload);
      saveJson(bootstrapCacheKey, payload);
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CACHE_BOOTSTRAP', payload: payload });
      }
    } catch (err) {
      if (String(err.message || '').includes('401') || String(err.message || '').includes('Authentication')) {
        if (session.token !== 'offline-token') {
          localStorage.removeItem(stateKey);
          setSession(null);
          return;
        }
      }
      var cached = loadJson(bootstrapCacheKey, null);
      if (cached) {
        setData(cached);
        setOnline(false);
        setError(t('offlineCached'));
      } else {
        setOnline(false);
        setError(t('offlineNoCache'));
      }
    }
  }

  useEffect(() => { refresh(); }, [session?.token]);
  useEffect(() => {
    const onOnline = () => { setOnline(true); refresh(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [session?.token]);

  if (!session) return h(Login, { onLogin: setSession, langTick, bumpLang });
  if (!data) return h('main', { className: 'loading' }, error || t('loadingData'));
  const role = data.user.role;
  const visiblePages = pages.filter(([id]) => canSee(data.user, id));
  const activePage = visiblePages.some(([id]) => id === page) ? page : (visiblePages[0] || ['dashboard'])[0];
  return h('main', { className: 'app-shell', dir: LANG === 'ur' ? 'rtl' : 'ltr' },
    h('aside', { className: 'sidebar' }, h('div', { className: 'brand' }, h('span', { className: 'brand-logo' }, 'F'), h('div', null, h('strong', null, 'Faislabadi'), h('small', null, 'GENERAL STORE'))), h('nav', null, visiblePages.map(([id]) => h('button', { key: id, className: activePage === id ? 'nav-item active' : 'nav-item', onClick: () => setPage(id) }, h('span', null, t('nav_' + id)))), h(LangToggle, { tick: bumpLang })), h('div', { className: 'sidebar-footer' }, h('div', { className: 'avatar' }, data.user.name.split(' ').map(part => part[0]).join('').slice(0, 2)), h('div', null, h('strong', null, data.user.name), h('small', null, role)), h('button', { className: 'more', onClick: () => { try { client.post('/api/auth/logout', {}).catch(() => {}); } catch (_) {} localStorage.removeItem(stateKey); setSession(null); } }, t('logout')))),
    h('section', { className: 'main-area' }, h('header', { className: 'topbar' }, h('div', { className: 'crumb' }, 'Faislabadi General Store / ', h('strong', null, t('nav_' + activePage))), h('div', { className: 'top-actions' },
      cloudSync && cloudSync.enabled && h('span', { className: cloudSync.lastError ? 'sync-status offline' : 'sync-status', title: cloudSync.lastSuccessAt ? `${t('cloudSyncedAt')} ${new Date(cloudSync.lastSuccessAt).toLocaleTimeString()}` : t('waitingFirstSync') }, cloudSync.lastError ? t('cloudPending') : (cloudSync.lastSuccessAt ? t('cloudSynced') : t('cloudConnecting'))),
      h('span', { className: online ? 'sync-status' : 'sync-status offline' }, online ? t('online') : t('offline')), h('button', { className: 'secondary', onClick: refresh }, t('refresh')), h(LangToggle, { tick: bumpLang }))), dataWarning && h('div', { className: 'notice danger', style: { margin: '12px 20px 0' } }, dataWarning), storageNotice && h('div', { className: 'notice warning', style: { margin: '12px 20px 0' } }, storageNotice),     activePage === 'dashboard' ? h(Dashboard, { data, go: setPage, client }) : activePage === 'pos' ? h(POS, { client, data, refresh, online, setOnline, go: setPage }) : activePage === 'users' ? h(UsersAdmin, { client }) : activePage === 'returns' ? h(ReturnsPage, { data, client, refresh }) : activePage === 'reports' ? h(Reports, { data, client }) : activePage === 'purchases' ? h(Purchases, { data, client, refresh }) : activePage === 'settings' ? h(Settings, { data, client }) : activePage === 'warehouse' ? h(WarehousePage, { data, client, refresh }) : h(DataPage, { page: activePage, data, client, refresh })));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').then(function() {
      console.log('Service Worker registered');
    }).catch(function(err) {
      console.log('Service Worker failed:', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
