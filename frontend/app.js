/* global React, ReactDOM */
const APP_VERSION = 'v37';
const APP_CHECKSUM = 'customer-product-qty-unit-logo-v28';
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
// Udhaar payments, new udhaar entries and returns recorded while offline. Same idea as the sales
// queue: keep the entry on this device, hand it to /api/sync when the network is back. Every entry
// carries a clientId so the server records it once even if it is sent twice.
const actionQueueKey = 'faislabadi-pos-offline-actions';
const usersCacheKey = 'faislabadi-pos-users-cache';
const bootstrapCacheKey = 'faislabadi-pos-bootstrap-cache';
const printerConfigKey = 'faislabadi-pos-printer';
const money = value => `Rs ${Math.round(Number(value || 0)).toLocaleString('en-PK')}`;
// A per-unit rate can land well under one rupee once a kg price is shown per gram (Rs 100/kg is
// Rs 0.10/g), so bill and receipt lines show up to two decimals instead of rounding to whole rupees.
const moneyRate = value => `Rs ${(Math.round(Number(value || 0) * 100) / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
const UNITS = [
  { value: 'kg', urdu: 'کلو', en: 'KG' },
  { value: 'gram', urdu: 'گرام', en: 'Gram' },
  { value: 'litre', urdu: 'لیٹر', en: 'Litre' },
  { value: 'pcs', urdu: 'عدد', en: 'Adad' },
  { value: 'pack', urdu: 'پیک', en: 'Pack' },
  { value: 'box', urdu: 'باکس', en: 'Box' },
  { value: 'dozen', urdu: 'درجن', en: 'Dozen' },
  { value: 'meter', urdu: 'میٹر', en: 'Meter' },
  { value: 'boree', urdu: 'بوری', en: 'Boree' }
];
const unitLabel = unit => (UNITS.find(item => item.value === unit) || {}).urdu || unit || '';
const unitName = unit => (UNITS.find(item => item.value === unit) || {}).en || unit || '';
const isWeightUnit = unit => ['kg', 'gram', 'litre', 'boree'].includes(unit);

// How many base units one unit is worth, matching the server's table exactly. Stock lives in the
// product's own unit, so billing in grams on a kg product has to move the qty one way and the rate
// the other way - otherwise the line total silently changes when the UOM dropdown is used.
const UNIT_FACTORS = { kg: 1, gram: 0.001, litre: 1, meter: 1, pcs: 1, pack: 1, box: 1, dozen: 1, boree: 1 };
// Same grouping as the server. Only units of the same kind have a known conversion, so the UOM
// dropdown can hide units that would otherwise be silently treated as 1:1.
const UNIT_DIMENSIONS = { kg: 'weight', gram: 'weight', litre: 'volume', meter: 'length', pcs: 'count', pack: 'count', box: 'count', dozen: 'count', boree: 'count' };
const unitDimension = unit => {
  const key = String(unit == null ? '' : unit).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UNIT_DIMENSIONS, key) ? UNIT_DIMENSIONS[key] : null;
};
// Units the cashier may pick for something kept in `baseUnit`. A line with no product unit (manual
// entry) can use any unit.
const unitsForBase = baseUnit => {
  const dimension = unitDimension(baseUnit);
  if (!dimension) return UNITS;
  const allowed = UNITS.filter(unit => unitDimension(unit.value) === dimension);
  // A product in an odd unit must still be able to keep its own unit in the list.
  return allowed.some(unit => unit.value === baseUnit) ? allowed : UNITS;
};
const unitToBase = (unit, baseUnit) => {
  const from = UNIT_FACTORS[String(unit == null ? '' : unit).trim().toLowerCase()];
  const to = UNIT_FACTORS[String(baseUnit == null ? '' : baseUnit).trim().toLowerCase()];
  if (!from || !to) return 1;
  return from / to;
};
  // Rate per `unit`. One unit is `unitToBase(unit, baseUnit)` base units and the rate scales the
  // same way the quantity does, so Rs 100/kg becomes Rs 0.1/gram. Kept at six decimals so a cheap
  // per-gram rate such as Rs 0.006 is not rounded away.
  const rateForUnit = (baseRate, unit, baseUnit) => {
    return Math.round((Number(baseRate) || 0) * unitToBase(unit, baseUnit) * 1e6) / 1e6;
  };
  // The same conversion in reverse: a rate typed in `unit` lifted back to the product's base unit.
  const rateToBase = (rate, unit, baseUnit) => {
    const factor = unitToBase(unit, baseUnit);
    return Math.round((Number(rate) || 0) / (factor || 1) * 1e6) / 1e6;
  };
const pad2 = n => String(n).padStart(2, '0');
const initialsOf = name => String(name || '?').trim().split(/\s+/).map(word => word[0] || '').join('').slice(0, 2).toUpperCase();
const customerProductsList = customer => {
  const list = (customer && customer.products) || [];
  if (Array.isArray(list) && list.length) return list;
  return customer && customer.profileProduct ? [customer.profileProduct] : [];
};
const productQtyLabel = product => {
  const qty = Number((product && product.qty) || 1);
  const unit = product && typeof product.unit === 'string' ? product.unit.trim() : '';
  if (qty === 1 && !unit) return '';
  return ` ×${qty}${unit ? ' ' + unitLabel(unit) : ''}`;
};
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
    netSalesToday: 'Sales today', invoicesCount: 'invoices', grossProfit: 'Gross profit', grossProfitNote: 'After product cost and discounts',
    creditSales: 'Credit sales', creditSalesNote: 'Added to Udhar balances', lowStockItems: 'Low stock items', lowStockNote: 'At or below reorder level',
    recentInvoices: 'Recent invoices', latestSales: 'Latest persisted sales', lowStockAlert: 'Low stock alert', needsRestock: 'Products needing replenishment',
    remainingReorder: 'remaining, reorder at', noLowStock: 'No low stock items.',
    thInvoice: 'Invoice', thCustomer: 'Customer', thPayment: 'Payment', thDate: 'Date', thTotal: 'Total', thStatus: 'Status',
    walkIn: 'Walk-in Customer', voided: 'Voided', posted: 'Posted', noSalesYet: 'No sales recorded yet.',
    counterOnline: 'COUNTER ONLINE', counterOffline: 'COUNTER OFFLINE', synced: 'Synced', queued: 'queued', revertBill: 'Revert / Return bill',
    searchPlaceholder: 'Scan barcode or search product name', looseItem: 'Loose item (کھلا مال)', productName: 'Product name',
    ratePer: 'Rate per', weightQty: 'Weight/Qty', add: 'Add', qtyAdd: 'Qty', available: 'available', currentInvoice: 'CURRENT INVOICE', cart: 'Cart',
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
    payFullAmount: 'Pay full amount', udharNeedsManager: 'Only Admin or Manager can receive or clear udhar. Ask them to record this payment.',
    addLabel: 'Add',     addNewUdhaar: 'Add New Udhaar', udhaarAmount: 'Amount', udhaarNote: 'Description / Note',
    udhaarReference: 'Reference (optional)', udhaarSaved: 'New udhaar added to the khata.', previousBalance: 'Previous balance',
    newBalance: 'New balance', udhaarEntry: 'Udhaar', prevBillLabel: 'Previous bill', dateTimeLabel: 'Date / Time',
    creditSaleEntry: 'Credit sale', paymentReceived: 'Payment received', close: 'Close',
    addNewUdhar: 'Add New Udhaar', closeAddUdhar: 'Close', saveUdharBtn: 'Save Udhaar',
    udharAmountPh: 'Udhar amount (Rs)', udharNotePh: 'What was taken / note',
    udharReferencePh: 'Reference (optional)', udharDateTitle: 'Udhar date', udharTimeTitle: 'Udhar time',
    udharEntryLabel: 'New udhar', refPrefix: 'Ref',
    allMonths: 'All months', reverseBill: 'Reverse bill', reversePayment: 'Reverse payment', balanceForCustomer: 'Balance:',
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
    phTransferQty: 'Quantity', transferDone: 'Stock transferred successfully.', linkedProduct: 'Linked Product', linkProduct: 'Link product', unlinkProduct: 'Unlink',
    searchProductsToLink: 'Search product by name, SKU or category...', noProductFound: 'No product found.',
    productLabel: 'Product', addProductManually: '+ Add Product Manually', searchProducts: 'Search products...',
    noMatchingProducts: 'No matching products.', clearProduct: 'Remove product',
    productPickHint: 'Only saved on this customer - it does not create a new product in the Products tab.',
    voucherNo: 'Voucher No', pendingInvoice: 'Pending - assigned on save', dateLabel: 'Date', paymentTerms: 'Payment Terms',
    referenceLabel: 'Reference', customerLabelShort: 'Customer', selectCustomerPh: 'Search customer by name or phone...',
    addNewCustomer: 'Add new customer', addCustomerHelp: 'Tap to create and use straight away',
    customerNamePh: 'Customer name', phoneLabel: 'Phone', optionalWord: 'optional',
    quickAddNote: 'Name and phone only. CNIC, address and credit limit can be added later from the Customers page.',
    saveAndUse: 'Save & Use', savingWord: 'Saving...',
    scanCamera: 'Scan with camera', amountReceived: 'Amount received', changeLabel: 'Change',
    balanceChangeLabel: 'Balance / Change', additionalDiscount: 'Additional Discount', totalQtyLabel: 'Total Qty',
    totalPacksLabel: 'Total Packs', grandTotalLabel: 'Grand Total', saveDraft: 'Save Draft', draftsLabel: 'Drafts',
    printInvoice: 'Print Invoice', completeSale: 'Complete Sale', completeAndPrint: 'Complete & Print',
    cancelSale: 'Cancel', cameraScanTitle: 'Scan barcode with camera', cameraUnsupported: 'Camera barcode scanning is not supported in this browser.',
    cameraDenied: 'Camera access was denied. Allow camera access and try again, or type the barcode below.',
    noCamera: 'No camera found on this device.',
    typeBarcodeLabel: 'Type or scan barcode', closeScan: 'Close', startScanning: 'Start camera', stopScanning: 'Stop camera',
    partialPayment: 'Partial', udhaarPayment: 'Credit / Udhaar', deliveryInfo: 'Additional / Delivery Information',
    deliveryInfoNote: 'Optional - shown on the printed invoice', deliverTo: 'Deliver To', deliverAddress: 'Deliver Address',
    clearDelivery: 'Clear Delivery',
    transport: 'Transport', trNo: 'TR #', noCases: 'No. of Cases', freightCharges: 'Freight Charges',
    deliveryDate: 'Delivery Date', orderTaker: 'Order Taker', salesPerson: 'Sales Person', packedBy: 'Packed By',
    preparedBy: 'Prepared By', checkedBy: 'Checked By', locationLabel: 'Location', removeLabel: 'Remove',
    amountWord: 'Amount', quantityWord: 'Quantity', qtyShort: 'Qty', unitLabelWord: 'UOM', rateLabel: 'Rate',
    totalWord: 'Total', draftSavedMsg: 'Draft saved.', draftDeletedMsg: 'Draft deleted.', draftLoadedMsg: 'Draft loaded.',
    billWord: 'bills', whatsappBill: 'WhatsApp Bill', noWhatsapp: 'No WhatsApp number',
    unavailable: 'Unavailable', notSavedPreview: 'PREVIEW - NOT SAVED', loadingDrafts: 'Load', openDrafts: 'Open draft',
    saveDraftFirst: 'Save a draft first', noDrafts: 'No drafts saved yet.', createdBy2: 'By', itemsShort: 'items',
    newSaleConfirm: 'Start a new sale? Current bill will be cleared.', cancelSaleConfirm: 'Cancel current bill? Items will be cleared.',
    printPreviewNote: 'The bill below is a preview. Complete the sale to assign an invoice number.',
    refreshHint: 'Press F2 to complete, F3 to scan, F4 to print',
    cameraNote: 'Position the barcode inside the frame', deleteDraftConfirm: 'Delete this draft?',
    balanceForCustomer: 'Udhar balance', discountOn: 'Discount', walkInCustomer: 'Walk-in',
    completeSaleBlockedCart: 'Add at least one item before completing the sale.',
    cashNeedsFull: 'Amount received is less than the total. Enter the full amount or switch to Partial/Credit.',
    partialNeedsCustomer: 'Select a registered customer before leaving a balance as udhar.',
    quantityTooHigh: 'Only {stock} {unit} of {name} available in stock',
    todayLabel: 'Today', saleCompleteMessage: 'Sale completed successfully.',
    reverseBillTitle: 'Reverse bill', reverseBillHelp: 'Return the whole bill, or reverse only some items from it. Stock and udhar update automatically.',
    reverseWholeBill: 'Reverse whole bill', reverseSelectedItems: 'Reverse selected items', reverseItems: 'Reverse items',
    canStillReturn: 'Can return', alreadyReversed: 'Already reversed', reverseNoItems: 'Select at least one item to reverse.',
    reverseDone: 'Bill reversed and stock updated.', openKhata: 'Open Khata', openKhataHelp: 'Date, time, amount and products of this customer', whatsappSendHelp: 'Send this bill on WhatsApp',
    printBill: 'Print bill', printBillHelp: 'Print the designed bill', billReversedBadge: 'Reversed',
    searchLowStock: 'Search low stock items...', loadMore: 'Load more', showingCount: 'Showing',
    addStock: 'Add stock', addStockTitle: 'Add stock', addStockQty: 'Quantity to add', addStockDone: 'Stock added and inventory updated.',
    setStockExact: 'Set exact stock', stockNow: 'Stock now', stockAfter: 'Stock after', inBoree: 'In boree', inCarton: 'In carton',
    totalProductsLabel: 'Total products', totalUdharLabel: 'Total udhar', udharCustomersLabel: 'Udhar customers', todayBillsLabel: 'Bills today',
    todayCreditNote: 'Billed today, still to be collected', netSalesNote: 'Cash and card only', cashCollectedLabel: 'Cash/card collected',
    whKgPerBoree: 'Kg per boree', whPcsPerCarton: 'Pcs per carton', whBores: 'Bores', whAddToProduct: 'Add to product',
    whConvertNote: 'Add bores from the warehouse - it comes off the warehouse and goes into product + inventory.',
    whNoLink: 'Link a product first', kgPerBoreePh: 'Kg in 1 boree', pcsPerCartonPh: 'Pcs in 1 carton',
    kgPerBoreeLabel: 'Kg per boree', pcsPerCartonLabel: 'Pcs per carton', packSpec: 'Pack size',
    stockAddedMsg: 'Stock added to product and inventory.', noUdharYet: 'No udhar yet.',
    showUdharFirst: 'Udhar customers', selectCustomerToBill: 'Select a customer to make a bill',
    allBills: 'All bills', recentBillsOnly: 'Recent', searchBills: 'Search invoice or customer...'
  },
  ur: {
    nav_dashboard: 'ڈیش بورڈ', nav_pos: 'نئی فروخت', nav_products: 'پروڈکٹس', nav_warehouse: 'گودام', nav_inventory: 'اسٹاک',
    nav_purchases: 'خریداری', nav_customers: 'گاہک اور اُدھار', nav_returns: 'پروڈکٹ واپسی',
    nav_reports: 'رپورٹس', nav_users: 'یوزرز اور آڈٹ', nav_settings: 'سیٹنگز اور بیک اپ',
    secureLogin: 'محفوظ لاگ ان', signInToPos: 'پی او ایس میں سائن کریں', emailOrPhone: 'ای میل یا موبائل نمبر', password: 'پاس ورڈ',
    signIn: 'سائن ان', offlineModeNotice: 'آف لائن موڈ - محفوظ شدہ پرانا ڈیٹا',
    loginNoServer: 'اس ڈیوائس سے پی او ایس سرور تک رسائی نہیں مل رہی۔ چیک کریں کہ آپ دکان کے کمپیوٹر والے وائی فائی پر ہیں (یا ویب سائٹ کا پتہ استعمال کریں) پھر دوبارہ کوشش کریں۔ پہلی بار لاگ ان کے لیے انٹرنیٹ ضروری ہے۔',
    liveStoreOverview: 'لائیو اسٹور', dashSubtitle: 'فروخت، اسٹاک، اُدھار اور کم اسٹاک کی اطلاعات۔', newSale: 'نئی سیل',
    netSalesToday: 'آج کی کل فروخت', invoicesCount: 'بل', grossProfit: 'کل منافع', grossProfitNote: 'لاگت اور رعایت کے بعد',
    creditSales: 'اُدھار فروخت', creditSalesNote: 'گاہکوں کے اُدھار میں شامل', lowStockItems: 'کم اسٹاک اشیاء', lowStockNote: 'دوبارہ آرڈر کی سطح پر یا اس سے کم',
    recentInvoices: 'حالیہ بل', latestSales: 'تازہ ترین فروخت', lowStockAlert: 'کم اسٹاک الرٹ', needsRestock: 'جو اشیاء دوبارہ منگوانی ہیں',
    remainingReorder: 'باقی، دوبارہ آرڈر پر', noLowStock: 'کوئی کم اسٹاک چیز نہیں۔',
    thInvoice: 'بل نمبر', thCustomer: 'گاہک', thPayment: 'ادائیگی', thDate: 'تاریخ', thTotal: 'کل', thStatus: 'حالت',
    walkIn: 'عمومی گاہک', voided: 'منسوخ', posted: 'درج', noSalesYet: 'ابھی کوئی فروخت نہیں ہوئی۔',
    counterOnline: 'کاؤنٹر آن لائن', counterOffline: 'کاؤنٹر آف لائن', synced: 'سنک', queued: 'زیرِ انتظار', revertBill: 'بل واپسی / ریٹرن',
    searchPlaceholder: 'بارکوڈ اسکین کریں یا پروڈکٹ کا نام لکھیں', looseItem: 'کھلا مال', productName: 'پروڈکٹ کا نام',
    ratePer: 'ریٹ فی', weightQty: 'وزن/تعداد', add: 'شامل کریں', qtyAdd: 'تعداد', available: 'موجود', currentInvoice: 'موجودہ بل', cart: 'کارٹ',
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
    payFullAmount: 'پوری رقم دیں', udharNeedsManager: 'اُدھار وصول یا کلیر صرف ایڈمن یا منیجر کر سکتا ہے۔ ان سے کہیں کہ ادائیگی درج کریں۔',
    addLabel: 'شامل کریں', addNewUdhaar: 'نیا اُدھار درج کریں', udhaarAmount: 'رقم', udhaarNote: 'تفصیل / نوٹ',
    udhaarReference: 'حوالہ (اختیاری)', udhaarSaved: 'نیا اُدھار کھاتے میں شامل ہو گیا۔', previousBalance: 'پچھلا بیلنس',
    newBalance: 'نیا بیلنس', udhaarEntry: 'اُدھار', prevBillLabel: 'پچھلا بل', dateTimeLabel: 'تاریخ / وقت',
    creditSaleEntry: 'اُدھار سیل', paymentReceived: 'ادائیگی موصول', close: 'بند کریں',
    addNewUdhar: 'نیا اُدھار درج کریں', closeAddUdhar: 'بند کریں', saveUdharBtn: 'اُدھار محفوظ کریں',
    udharAmountPh: 'اُدھار کی رقم (روپے)', udharNotePh: 'کیا لیا / تفصیل',
    udharReferencePh: 'حوالہ (اختیاری)', udharDateTitle: 'تاریخ', udharTimeTitle: 'وقت',
    udharEntryLabel: 'نیا اُدھار', refPrefix: 'حوالہ',
    allMonths: 'تمام مہینے', reverseBill: 'بل واپس لوٹائیں', reversePayment: 'ادائیگی واپس', balanceForCustomer: 'بقیہ:',
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
    phTransferQty: 'تعداد', transferDone: 'اسٹاک منتقل ہو گیا۔', linkedProduct: 'لنکڈ پروڈکٹ', linkProduct: 'لنک کریں', unlinkProduct: 'لنک ہٹائیں',
    searchProductsToLink: 'پروڈکٹ نام، SKU یا کیٹیگری سے تلاش کریں...', noProductFound: 'کوئی پروڈکٹ نہیں ملی۔',
    productLabel: 'پروڈکٹ', addProductManually: '+ پروڈکٹ خود لکھیں', searchProducts: 'پروڈکٹ تلاش کریں...',
    noMatchingProducts: 'کوئی پروڈکٹ نہیں ملی۔', clearProduct: 'پروڈکٹ ہٹائیں',
    productPickHint: 'صرف اس گاہک پر محفوظ ہوتا ہے - پروڈکٹس ٹیب میں کوئی نئی پروڈکٹ نہیں بنتی۔',
    voucherNo: 'واؤچر نمبر', pendingInvoice: 'زیرِ التوا - سیل محفوظ ہونے پر ملے گا', dateLabel: 'تاریخ', paymentTerms: 'ادائیگی کی شرائط',
    referenceLabel: 'حوالہ', customerLabelShort: 'گاہک', selectCustomerPh: 'گاہک کا نام یا موبائل تلاش کریں...',
    addNewCustomer: 'نیا گاہک شامل کریں', addCustomerHelp: 'دبانے کے لیے چھوئیں',
    customerNamePh: 'گاہک کا نام', phoneLabel: 'موبائل', optionalWord: 'اختیاری',
    quickAddNote: 'صرف نام اور موبائل۔ شناختی کارڈ، پتہ اور حد اس سے بعد میں گاہک صفحے سے بڑھایا جا سکتا ہے۔',
    saveAndUse: 'محفوظ اور استعمال', savingWord: 'محفوظ ہو رہا ہے...',
    scanCamera: 'کیمرے سے اسکین', amountReceived: 'موصول شدہ رقم', changeLabel: 'باقی رقم',
    balanceChangeLabel: 'باقی رقم / تبدیلی', additionalDiscount: 'اضافی رعایت', totalQtyLabel: 'کل تعداد',
    totalPacksLabel: 'کل پیک', grandTotalLabel: 'کل رقم', saveDraft: 'ڈرافٹ محفوظ کریں', draftsLabel: 'ڈرافٹس',
    printInvoice: 'بل پرنٹ کریں', completeSale: 'سیل مکمل کریں', completeAndPrint: 'مکمل کریں اور پرنٹ',
    cancelSale: 'منسوخ', cameraScanTitle: 'کیمرے سے بارکوڈ اسکین کریں', cameraUnsupported: 'اس براؤزر میں کیمرے سے بارکوڈ اسکیننگ دستیاب نہیں۔',
    cameraDenied: 'کیمرے تک رسائی سے انکار ہوا۔ کیمرے کی اجازت دیں اور دوبارہ کوشش کریں، یا نیچے بارکوڈ لکھیں۔',
    noCamera: 'اس ڈیوائس پر کوئی کیمرہ نہیں ملا۔',
    typeBarcodeLabel: 'بارکوڈ لکھیں یا اسکین کریں', closeScan: 'بند کریں', startScanning: 'کیمرہ شروع کریں', stopScanning: 'کیمرہ بند کریں',
    partialPayment: 'جزوی ادائیگی', udhaarPayment: 'اُدھار', deliveryInfo: 'اضافی / ڈیلیوری معلومات',
    deliveryInfoNote: 'اختیاری - پرنٹ شدہ بل پر دکھائی جائے گی', deliverTo: 'ڈیلیور کس کو', deliverAddress: 'ڈیلیوری کا پتہ',
    clearDelivery: 'ڈیلیوری صاف کریں',
    transport: 'ٹرانسپورٹ', trNo: 'ٹی آر نمبر', noCases: 'کیسز کی تعداد', freightCharges: 'فریٹ چارجز',
    deliveryDate: 'ڈیلیوری کی تاریخ', orderTaker: 'آرڈر لینے والا', salesPerson: 'سیلز پرسن', packedBy: 'پیک کرنے والا',
    preparedBy: 'تیار کرنے والا', checkedBy: 'چیک کرنے والا', locationLabel: 'لوکیشن', removeLabel: 'ہٹائیں',
    amountWord: 'رقم', quantityWord: 'تعداد', qtyShort: 'تعداد', unitLabelWord: 'اکائی', rateLabel: 'ریٹ',
    totalWord: 'کل', draftSavedMsg: 'ڈرافٹ محفوظ ہو گیا۔', draftDeletedMsg: 'ڈرافٹ ڈیلیٹ ہو گیا۔', draftLoadedMsg: 'ڈرافٹ لوڈ ہو گیا۔',
    billWord: 'بل', whatsappBill: 'واٹس ایپ بل', noWhatsapp: 'واٹس ایپ نمبر نہیں',
    unavailable: 'دستیاب نہیں', notSavedPreview: 'پری ویو - محفوظ نہیں', loadingDrafts: 'کھولیں', openDrafts: 'ڈرافٹ کھولیں',
    saveDraftFirst: 'پہلے ڈرافٹ محفوظ کریں', noDrafts: 'ابھی کوئی ڈرافٹ محفوظ نہیں۔', createdBy2: 'بذریعہ', itemsShort: 'آئٹمز',
    newSaleConfirm: 'نئی سیل شروع کریں؟ موجودہ بل صاف ہو جائے گا۔', cancelSaleConfirm: 'موجودہ بل منسوخ کریں؟ آئٹمز صاف ہو جائیں گے۔',
    printPreviewNote: 'نیچے بل ایک پری ویو ہے۔ انوائس نمبر کے لیے سیل مکمل کریں۔',
    refreshHint: 'F2 مکمل، F3 اسکین، F4 پرنٹ',
    cameraNote: 'بارکوڈ کو فریم کے اندر رکھیں', deleteDraftConfirm: 'یہ ڈرافٹ ڈیلیٹ کریں؟',
    balanceForCustomer: 'اُدھار بیلنس', discountOn: 'رعایت', walkInCustomer: 'عمومی گاہک',
    completeSaleBlockedCart: 'سیل مکمل کرنے سے پہلے کم از کم ایک آئٹم شامل کریں۔',
    cashNeedsFull: 'موصول شدہ رقم کل رقم سے کم ہے۔ پوری رقم درج کریں یا جزوی/اُدھار منتخب کریں۔',
    partialNeedsCustomer: 'اُدھار چھوڑنے سے پہلے رجسٹرڈ گاہک منتخب کریں۔',
    quantityTooHigh: 'صرف {stock} {unit} {name} اسٹاک میں موجود ہیں',
    todayLabel: 'آج', saleCompleteMessage: 'سیل کامیابی سے مکمل ہوئی۔',
    reverseBillTitle: 'بل واپس لوٹائیں', reverseBillHelp: 'پورا بل واپس کریں، یا صرف کچھ اشیاء واپس کریں۔ اسٹاک اور اُدھار خود بخود اپڈیٹ ہو جائیں گے۔',
    reverseWholeBill: 'پورا بل واپس کریں', reverseSelectedItems: 'منتخب اشیاء واپس کریں', reverseItems: 'اشیاء واپس',
    canStillReturn: 'ابھی واپس ہو سکتا', alreadyReversed: 'پہلے واپس شدہ', reverseNoItems: 'کم از کم ایک آئٹمن واپس کرنے کے لیے منتخب کریں۔',
    reverseDone: 'بل واپس ہو گیا اور اسٹاک اپڈیٹ ہو گیا۔', openKhata: 'کھاتہ کھولیں', openKhataHelp: 'اس گاہک کی تاریخ، وقت، رقم اور اشیاء', whatsappSendHelp: 'یہ بل واٹس ایپ پر بھیجیں',
    printBill: 'بل پرنٹ کریں', printBillHelp: 'ڈیزائن شدہ بل پرنٹ کریں', billReversedBadge: 'واپس شدہ',
    searchLowStock: 'کم اسٹاک اشیاء تلاش کریں...', loadMore: 'مزید دکھائیں', showingCount: 'دکھایا جا رہا ہے',
    addStock: 'اسٹاک شامل کریں', addStockTitle: 'اسٹاک شامل کریں', addStockQty: 'شامل کرنے کی تعداد', addStockDone: 'اسٹاک شامل ہو گیا اور انوینٹری اپڈیٹ ہو گئی۔',
    setStockExact: 'اسٹاک مکمل طے کریں', stockNow: 'موجودہ اسٹاک', stockAfter: 'اس کے بعد', inBoree: 'بوریوں میں', inCarton: 'کارٹنوں میں',
    totalProductsLabel: 'کل پروڈکٹس', totalUdharLabel: 'کل اُدھار', udharCustomersLabel: 'اُدھار گاہک', todayBillsLabel: 'آج کے بل',
    todayCreditNote: 'آج کا بل، ابھی وصول ہونا باقی ہے', netSalesNote: 'صرف نقد اور کارڈ', cashCollectedLabel: 'نقد/کارڈ وصول شدہ',
    whKgPerBoree: 'فی بوری کلو', whPcsPerCarton: 'فی کارٹن عدد', whBores: 'بوریاں', whAddToProduct: 'پروڈکٹ میں شامل کریں',
    whConvertNote: 'گودام سے بوریاں شامل کریں - گودام سے کم ہوں گی اور پروڈکٹ اور اسٹاک میں شامل ہوں گی۔',
    whNoLink: 'پہلے پروڈکٹ لنک کریں', kgPerBoreePh: 'ایک بوری میں کلو', pcsPerCartonPh: 'ایک کارٹن میں عدد',
    kgPerBoreeLabel: 'فی بوری کلو', pcsPerCartonLabel: 'فی کارٹن عدد', packSpec: 'پیک سائز',
    stockAddedMsg: 'اسٹاک پروڈکٹ اور انوینٹری میں شامل ہو گیا۔', noUdharYet: 'ابھی کوئی اُدھار نہیں۔',
    showUdharFirst: 'اُدھار والے گاہک', selectCustomerToBill: 'بل بنانے کے لیے گاہک منتخب کریں',
    allBills: 'تمام بل', recentBillsOnly: 'حالیہ', searchBills: 'انوائس یا گاہک تلاش کریں...'
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

// --- Offline queue for udhaar payments, new udhaar entries and returns -----------------
// These are recorded on the device while the internet is down, kept here, and handed to /api/sync
// once the network returns. Every entry carries a clientId, and the server skips any clientId it
// has already recorded, so a payment can never be taken twice and a return can never restock twice.
// True when the request never reached the server (no internet, server asleep, request aborted).
// A response with a status is a real answer from the server, even a failing one.
const isNetworkFailure = err => !err || err.status === undefined;
const actionQueueListeners = new Set();
function readActionQueue() {
  const list = loadJson(actionQueueKey, []);
  return Array.isArray(list) ? list : [];
}
function writeActionQueue(list) {
  saveJson(actionQueueKey, list);
  for (const listener of actionQueueListeners) listener(list.length);
}
function queuedActionCount() {
  return readActionQueue().length;
}
function useQueuedActionCount() {
  const [count, setCount] = useState(queuedActionCount);
  useEffect(() => {
    actionQueueListeners.add(setCount);
    setCount(queuedActionCount());
    return () => { actionQueueListeners.delete(setCount); };
  }, []);
  return count;
}
// Returns true when the entry was stored, false when an identical one is already waiting, so a
// repeated tap on the same open form cannot queue the same money twice.
function queueAction(type, body) {
  const list = readActionQueue();
  const signatureBody = { ...body };
  delete signatureBody.clientId;
  const signature = `${type}|${JSON.stringify(signatureBody)}`;
  if (list.some(item => item.signature === signature)) return false;
  list.push({
    type,
    body: { ...body, clientId: `offline_${Date.now()}_${Math.floor(Math.random() * 1e6)}` },
    signature,
    at: new Date().toISOString()
  });
  writeActionQueue(list);
  return true;
}
// Sends everything waiting. Entries the server applied (or recognised as already recorded) are
// dropped. An entry the server refused for a real reason is reported and dropped too, otherwise it
// would retry forever and hold up the entries behind it. A network failure keeps the whole queue.
async function flushActionQueue(client) {
  const list = readActionQueue();
  if (!list.length) return { synced: 0, remaining: 0, errors: [] };
  const body = { udharEntries: [], payments: [], returns: [], customers: [] };
  for (const item of list) {
    if (item.type === 'udhar') body.udharEntries.push(item.body);
    else if (item.type === 'payment') body.payments.push(item.body);
    else if (item.type === 'return') body.returns.push(item.body);
    else if (item.type === 'customer') body.customers.push(item.body);
  }
  try {
    const result = await client.post('/api/sync', body);
    const statuses = new Map(((result && result.results) || []).map(row => [`${row.type}|${row.clientId}`, row]));
    const errors = [];
    const remaining = [];
    for (const item of list) {
      const row = statuses.get(`${item.type}|${item.body.clientId}`);
      if (row && row.status === 'failed') errors.push(friendlyError(row.error || 'Rejected by server'));
      else if (!row) remaining.push(item);
    }
    writeActionQueue(remaining);
    return { synced: list.length - remaining.length, remaining: remaining.length, errors };
  } catch (err) {
    if (isNetworkFailure(err)) return { synced: 0, remaining: list.length, errors: [] };
    return { synced: 0, remaining: list.length, errors: [friendlyError(err)] };
  }
}
function friendlyErrorQueued(count, errors) {
  const reason = errors.filter(Boolean).join(' ');
  if (reason) return `${count} offline entr${count === 1 ? 'y' : 'ies'} could not be applied: ${reason}`;
  return `${count} offline entr${count === 1 ? 'y is' : 'ies are'} waiting to sync.`;
}
// Shown after an action was stored on the device instead of the server, so the cashier knows the
// entry is safe and will appear on its own.
function offlineSavedMessage(amount, kind) {
  const what = kind === 'payment' ? (LANG === 'ur' ? 'وصولی' : 'Payment') : kind === 'return' ? (LANG === 'ur' ? 'واپسی' : 'Return') : (LANG === 'ur' ? 'اُدھار' : 'Udhar');
  const saved = LANG === 'ur' ? `${what} محفوظ ہو گئی۔ یہ انترنت آنے پر خودکار طور پر سنک ہو گئی۔` : `${what} saved on this device. It will sync automatically when the internet returns.`;
  return Number(amount) > 0 ? `${money(amount)} — ${saved}` : saved;
}
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
    if (!response.ok) {
      // The status tells the offline queue apart from a real refusal: a failed fetch has no status
      // (keep the entry queued), while a 4xx/5xx answer is the server saying no.
      const error = new Error(payload.message || payload.error || 'Request failed');
      error.status = response.status;
      throw error;
    }
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
      h('div', { className: 'brand login-brand' }, h('img', { className: 'brand-logo', src: 'logo.png?v=27', alt: '' }), h('div', null, h('strong', null, 'Faislabadi'), h('small', null, 'GENERAL STORE POS'))),
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

function Metric({ title, value, note, sub, tone }) {
  return h('article', { className: 'metric-card' + (tone ? ' ' + tone : '') }, h('p', null, title), h('h3', null, value), note ? h('small', null, note) : null, sub ? h('small', { className: 'metric-sub' }, sub) : null);
}

const LOW_STOCK_PAGE = 15;
const BILLS_PAGE = 10;

function stockPackLabel(product) {
  const bits = [];
  if (Number(product.kgPerBoree) > 0) bits.push(`${product.kgPerBoree} ${LANG === 'ur' ? 'کلو' : 'kg'}/${LANG === 'ur' ? 'بوری' : 'boree'}`);
  if (Number(product.pcsPerCarton) > 0) bits.push(`${product.pcsPerCarton} ${LANG === 'ur' ? 'عدد' : 'pcs'}/${LANG === 'ur' ? 'کارٹن' : 'carton'}`);
  return bits;
}

function StockAddModal({ product, client, refresh, onClose }) {
  const [qty, setQty] = useState('');
  const [convert, setConvert] = useState('none');
  const [mode, setMode] = useState('add');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const qtyNum = Number(qty) || 0;
  const factor = convert === 'boree' ? Number(product.kgPerBoree || 0) : convert === 'carton' ? Number(product.pcsPerCarton || 0) : 1;
  const willAdd = Math.round(qtyNum * factor * 1000) / 1000;
  const after = mode === 'set' ? willAdd : Math.round((Number(product.stock || 0) + willAdd) * 1000) / 1000;
  async function save() {
    if (!(qtyNum > 0)) { setMessage(LANG === 'ur' ? 'ٹھیک تعداد لکھیں۔' : 'Enter a quantity greater than 0.'); return; }
    if (convert !== 'none' && !(factor > 0)) { setMessage(LANG === 'ur' ? 'پہلے پروڈکٹ میں فی بوری کلو / فی کارٹن عدد لکھیں۔' : 'Set kg per boree / pcs per carton on this product first.'); return; }
    setBusy(true);
    setMessage('');
    try {
      await client.post(`/api/products/${product.id}/stock`, { qty: qtyNum, convert, mode, note: note.trim() });
      await refresh();
      onClose();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'khata stock-modal', onClick: e => e.stopPropagation() },
      h('header', { className: 'khata-head' },
        h('div', null, h('p', { className: 'eyebrow' }, t('hStock')), h('h2', null, `${t('addStock')}: ${product.name}`))),
      message && h('div', { className: 'notice danger' }, message),
      h('div', { className: 'stock-now-line' },
        h('span', null, `${t('stockNow')}: `), h('strong', null, `${product.stock} ${unitLabel(product.unit)}`)),
      h('div', { className: 'edit-form' },
        h('div', { className: 'edit-form-row' },
          h('div', null,
            h('label', null, t('addStockQty')),
            h('input', { type: 'number', step: 'any', min: '0', value: qty, onChange: e => setQty(e.target.value), autoFocus: true })),
          h('div', null,
            h('label', null, LANG === 'ur' ? 'پیک کی قسم' : 'Pack unit'),
            h('select', { value: convert, onChange: e => setConvert(e.target.value) },
              h('option', { value: 'none' }, unitLabel(product.unit)),
              Number(product.kgPerBoree) > 0 && h('option', { value: 'boree' }, `${t('inBoree')} (${product.kgPerBoree} ${LANG === 'ur' ? 'کلو' : 'kg'})`),
              Number(product.pcsPerCarton) > 0 && h('option', { value: 'carton' }, `${t('inCarton')} (${product.pcsPerCarton})`))),
          h('div', null,
            h('label', null, LANG === 'ur' ? 'طریقہ' : 'Mode'),
            h('select', { value: mode, onChange: e => setMode(e.target.value) },
              h('option', { value: 'add' }, t('addStock')),
              h('option', { value: 'set' }, t('setStockExact'))))),
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('reasonOptional')), h('input', { value: note, onChange: e => setNote(e.target.value) }))),
        qtyNum > 0 && h('div', { className: 'stock-preview' },
          h('span', null, `${qtyNum} ${convert === 'boree' ? t('whBores') : convert === 'carton' ? 'carton' : unitLabel(product.unit)} × ${factor} = `),
          h('strong', null, `${willAdd} ${unitLabel(product.unit)}`),
          h('span', { className: 'stock-preview-after' }, `${t('stockAfter')}: ${after} ${unitLabel(product.unit)}`)),
        h('div', { className: 'form-actions' },
          h('button', { className: 'primary', disabled: busy, onClick: save }, t('addStock')),
          h('button', { className: 'secondary', onClick: onClose }, t('close')))))),
    document.body);
}

function ReverseBillModal({ sale, customers, client, refresh, onClose }) {
  const [lookup, setLookup] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const customer = (customers || []).find(item => item.id === sale.customerId);
  const canVoid = true;
  useEffect(() => {
    let stopped = false;
    client.get(`/api/sales/lookup?saleId=${encodeURIComponent(sale.id)}`)
      .then(payload => { if (!stopped) setLookup(payload); })
      .catch(err => { if (!stopped) setMessage(friendlyError(err)); });
    return () => { stopped = true; };
  }, [sale.id, client]);
  function setQty(item, value) {
    const max = Number(item.eligibleQty);
    let qty = Number(value || 0);
    if (qty > max) qty = max;
    if (qty < 0) qty = 0;
    setQuantities(old => ({ ...old, [item.productId || item.name]: qty }));
  }
  async function reverse(complete) {
    if (!lookup) return;
    const items = lookup.items
      .filter(item => Number(quantities[item.productId || item.name]) > 0)
      .map(item => ({ productId: item.productId, name: item.name, qty: Number(quantities[item.productId || item.name]) }));
    if (!complete && !items.length) { setMessage(t('reverseNoItems')); return; }
    const label = complete ? t('reverseWholeBill') : t('reverseSelectedItems');
    const detail = complete
      ? (LANG === 'ur' ? 'تمام باقی مقدار دوبارہ اسٹاک میں شامل ہوگی اور اُدھار کم ہو جائے گا۔' : 'All remaining quantities will go back to stock and any udhar on this bill will be reduced.')
      : `${LANG === 'ur' ? 'اشیاء' : 'Products'}: ${items.map(item => `${item.name} x${item.qty}`).join(', ')}\n${LANG === 'ur' ? 'واپس آیا مال اسٹاک میں شامل ہوگا۔' : 'Returned stock goes back to inventory and udhar.'}`;
    if (!await askConfirm(label, `${detail}\n\n${LANG === 'ur' ? 'یہ واپس نہیں ہو سکتا۔' : 'This cannot be undone.'}`)) return;
    setBusy(true);
    setMessage('');
    try {
      const record = await client.post('/api/returns', { saleId: lookup.sale.id, items: complete ? undefined : items, complete, reason });
      setMessage(LANG === 'ur'
        ? `${record.invoiceNo} واپس ہو گیا۔ رقم روپے ${Number(record.total || 0).toLocaleString('en-PK')}۔ اسٹاک اپڈیٹ ہو گیا۔`
        : `${record.invoiceNo} reversed. Refund ${money(record.total)}. Stock and udhar updated.`);
      setQuantities({});
      setLookup(await client.get(`/api/sales/lookup?saleId=${encodeURIComponent(lookup.sale.id)}`));
      await refresh();
    } catch (err) {
      if (isNetworkFailure(err)) {
        // The return is kept on this device and sent when the network is back. Stock and udhar are
        // only moved once the server applies it, so nothing is counted twice.
        queueAction('return', { saleId: lookup.sale.id, items: complete ? undefined : items, complete, reason });
        setQuantities({});
        setMessage(offlineSavedMessage(0, 'return'));
      } else {
        setMessage(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  }
  async function voidBill() {
    if (!lookup) return;
    if (!await askConfirm(t('voidBillConfirm'), t('voidBillDetail'))) return;
    setBusy(true);
    setMessage('');
    try {
      await client.post(`/api/sales/${lookup.sale.id}/void`, {});
      setMessage(t('voidBillSuccess'));
      setLookup(await client.get(`/api/sales/lookup?saleId=${encodeURIComponent(lookup.sale.id)}`));
      await refresh();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  const selectedCount = lookup ? lookup.items.filter(item => Number(quantities[item.productId || item.name]) > 0).length : 0;
  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'khata reverse-modal', onClick: e => e.stopPropagation() },
      h('header', { className: 'khata-head profile-head' },
        h('div', { className: 'profile-top' },
          h('div', { className: 'profile-title' },
            h('p', { className: 'eyebrow' }, t('reverseBillTitle')),
            h('h2', null, `${t('invoiceWord')} ${sale.invoiceNo}`),
            h('p', { className: 'subtitle' }, `${new Date(sale.createdAt).toLocaleString('en-PK')} - ${customer ? customer.name : t('walkIn')} - ${money(sale.total)}`))),
        h('span', { className: `badge ${sale.voided ? 'danger' : sale.paymentType === 'Credit' ? 'warning' : 'success'}` },
          sale.voided ? t('voided') : paymentMethodLabel(sale.paymentType))),
      h('p', { className: 'reverse-help' }, t('reverseBillHelp')),
      message && h('div', { className: 'notice' }, message),
      !lookup && !message && h('p', { className: 'empty-copy' }, t('loading')),
      lookup && h('div', { className: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, [t('hProduct'), t('hPurchased'), t('hAlreadyReturned'), t('hCanStillReturn'), t('hReturnNow')].map((label, index) => h('th', { key: index }, label)))),
        h('tbody', null, lookup.items.map(item => h('tr', { key: item.productId || item.name },
          h('td', null, h('strong', null, item.name)),
          h('td', null, `${item.qty} ${unitLabel(item.unit)}`),
          h('td', null, String(item.returnedQty)),
          h('td', null, h('strong', null, String(item.eligibleQty))),
          h('td', null, item.eligibleQty > 0
            ? h('input', { className: 'qty-input', type: 'number', min: '0', max: item.eligibleQty, step: isWeightUnit(item.unit) ? '0.25' : '1', value: quantities[item.productId || item.name] ?? '', onChange: e => setQty(item, e.target.value) })
            : h(Badge, { tone: 'neutral' }, t('fullyReturned'))))))),
      lookup && h('div', { className: 'reverse-actions' },
        h('input', { placeholder: t('reasonOptional'), value: reason, onChange: e => setReason(e.target.value), className: 'reverse-reason' }),
        h('button', { className: 'secondary', disabled: busy || !selectedCount, onClick: () => reverse(false) },
          `${t('reverseSelectedItems')} (${selectedCount})`),
        h('button', { className: 'danger-btn', disabled: busy || lookup.items.every(item => item.eligibleQty <= 0), onClick: () => reverse(true) }, t('reverseWholeBill')),
        canVoid && h('button', { className: 'danger-btn', disabled: busy, onClick: voidBill }, t('voidBill')),
        h('button', { className: 'secondary', onClick: onClose }, t('close')))))),
    document.body);
}

function Dashboard({ data, go, client, refresh }) {
  const report = data.reports?.day || {};
  const stats = data.stats || {};
  const [lowQuery, setLowQuery] = useState('');
  const [lowLimit, setLowLimit] = useState(LOW_STOCK_PAGE);
  const [billQuery, setBillQuery] = useState('');
  const [billLimit, setBillLimit] = useState(BILLS_PAGE);
  const [reverseSale, setReverseSale] = useState(null);
  const [stockProduct, setStockProduct] = useState(null);
  const [stockMessage, setStockMessage] = useState('');

  // The daily figures, udhar totals and low-stock list all come from the server's own totals, and a
  // completed bill only patches the products, customers and sale list on screen. Without pulling
  // fresh data when the dashboard is actually opened, "sales today" kept showing the numbers from
  // before the last bill - walk-in bills included. Fetching here instead of after every sale keeps
  // the counter quick and still shows the true day so far.
  useEffect(() => {
    if (refresh) refresh();
  }, []);

  const allSales = data.sales || [];
  const billQ = billQuery.trim().toLowerCase();
  const filteredSales = billQ
    ? allSales.filter(sale => {
      const name = ((data.customers || []).find(item => item.id === sale.customerId) || {}).name || '';
      return `${sale.invoiceNo || ''} ${name} ${sale.paymentType || ''}`.toLowerCase().includes(billQ);
    })
    : allSales;
  const recentSales = filteredSales.slice(0, billLimit);

  const lowQ = lowQuery.trim().toLowerCase();
  const allLow = data.lowStock || [];
  const filteredLow = lowQ
    ? allLow.filter(product => `${product.name} ${product.sku || ''} ${product.category || ''}`.toLowerCase().includes(lowQ))
    : allLow;
  const lowItems = filteredLow.slice(0, lowLimit);

  const lowStockTotal = allLow.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const totalProducts = stats.totalProducts !== undefined ? stats.totalProducts : (data.products || []).length;

  return h('div', { className: 'page dashboard' },
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, t('liveStoreOverview')), h('h1', null, t('nav_dashboard')), h('p', { className: 'subtitle' }, t('dashSubtitle'))), h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, h('button', { className: 'primary', onClick: () => go('pos') }, t('newSale')), h('button', { className: 'secondary', onClick: () => client.exportCsv('/api/reports/export.csv', 'sales-report.csv') }, 'Export CSV'))),
    h('section', { className: 'metrics' },
      h(Metric, { title: t('netSalesToday'), value: money(report.netSales), note: `${report.salesCount || 0} ${t('invoicesCount')}`, sub: (report.refunds || 0) > 0 ? `${t('refundsNote')} ${money(report.refunds)}` : '' }),
      h(Metric, { title: t('totalProductsLabel'), value: totalProducts, note: `${stats.lowStockCount !== undefined ? stats.lowStockCount : allLow.length} ${t('lowBadge')} · ${stats.warehouseItems || 0} ${t('nav_warehouse')}` }),
      h(Metric, { title: t('totalUdharLabel'), value: money(stats.totalUdhar || 0), note: `${stats.udharCustomers || 0} ${t('udharCustomersLabel')}`, tone: (stats.totalUdhar || 0) > 0 ? 'warn' : '' }),
      h(Metric, { title: t('lowStockItems'), value: allLow.length, note: `${lowStockTotal} ${t('hStock').toLowerCase()} ${t('remainingReorder')}` })),
    h('section', { className: 'metrics metrics-sub' },
      h(Metric, { title: t('grossProfit'), value: money(report.grossProfit), note: t('grossProfitNote') }),
      h(Metric, { title: t('cashCollectedLabel'), value: money(report.cashSales || 0), note: `${report.cashCount || 0} ${t('billWord')} · ${t('netSalesNote')}` }),
      h(Metric, { title: t('creditSales'), value: money(report.creditSales), note: `${report.creditCount || 0} ${t('billWord')} · ${t('todayCreditNote')}` }),
      h(Metric, { title: t('todayBillsLabel'), value: report.salesCount || 0, note: `${t('todayLabel')} · ${t('invoicesCount')}` })),
    stockMessage && h('div', { className: 'notice' }, stockMessage),
    h('section', { className: 'dashboard-grid' },
      h('article', { className: 'panel dash-invoices' },
        h('div', { className: 'panel-head' },
          h('div', null, h('h2', null, t('recentInvoices')), h('p', null, t('latestSales'))),
          h('label', { className: 'search dash-search' },
            h('input', { type: 'search', value: billQuery, onChange: e => { setBillQuery(e.target.value); setBillLimit(BILLS_PAGE); }, placeholder: t('searchBills') }))),
        h(SalesTable, { sales: recentSales, customers: data.customers, onReverse: setReverseSale }),
        recentSales.length < filteredSales.length
          ? h('button', { className: 'secondary load-more-btn', onClick: () => setBillLimit(n => n + BILLS_PAGE) }, `${t('loadMore')} (${filteredSales.length - recentSales.length})`)
          : null),
      h('article', { className: 'panel dash-lowstock' },
        h('div', { className: 'panel-head' },
          h('div', null, h('h2', null, t('lowStockAlert')), h('p', null, t('needsRestock'))),
          h('label', { className: 'search dash-search' },
            h('input', { type: 'search', value: lowQuery, onChange: e => { setLowQuery(e.target.value); setLowLimit(LOW_STOCK_PAGE); }, placeholder: t('searchLowStock') }))),
        filteredLow.length
          ? h('div', { className: 'low-stock-list' },
            lowItems.map(product => {
              const pack = stockPackLabel(product);
              return h('div', { className: 'stock-row low-stock-row', key: product.id },
                h('div', { className: 'low-stock-info' },
                  h('strong', null, product.name),
                  h('small', null, `${product.stock} ${unitLabel(product.unit)} ${t('remainingReorder')} ${product.reorderLevel}`),
                  pack.length ? h('small', { className: 'low-stock-pack' }, pack.join(' · ')) : null),
                h('div', { className: 'low-stock-actions' },
                  h(Badge, { tone: 'danger' }, t('lowBadge')),
                  h('button', { className: 'secondary small low-stock-add', title: t('addStock'), onClick: () => { setStockMessage(''); setStockProduct(product); } }, `+ ${t('addStock')}`)));
            }))
          : h('p', { className: 'empty-copy' }, lowQ ? t('noMatchingProducts') : t('noLowStock')),
        filteredLow.length > lowItems.length
          ? h('button', { className: 'secondary load-more-btn', onClick: () => setLowLimit(n => n + LOW_STOCK_PAGE) }, `${t('loadMore')} (${filteredLow.length - lowItems.length})`)
          : null,
        filteredLow.length > 0 && h('small', { className: 'muted low-stock-count' }, `${t('showingCount')} ${lowItems.length} / ${filteredLow.length}`))),
    reverseSale && h(ReverseBillModal, { sale: reverseSale, customers: data.customers, client, refresh, onClose: () => setReverseSale(null) }),
    stockProduct && h(StockAddModal, {
      product: stockProduct,
      client,
      refresh,
      onClose: () => { setStockMessage(t('addStockDone')); setStockProduct(null); }
    }));
}

function SalesTable({ sales, customers, onReverse }) {
  return h('div', { className: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, [t('thInvoice'), t('thCustomer'), t('thPayment'), t('thDate'), t('thTotal'), t('thStatus'), ''].map((label, index) => h('th', { key: index }, label)))),
    h('tbody', null, sales.length ? sales.map(sale => {
      const customer = customers.find(item => item.id === sale.customerId);
      return h('tr', { key: sale.id },
        h('td', null, h('strong', null, sale.invoiceNo)),
        h('td', null, customer?.name || t('walkIn')),
        h('td', null, h(Badge, { tone: sale.paymentType === 'Credit' ? 'warning' : 'success' }, paymentMethodLabel(sale.paymentType))),
        h('td', null, new Date(sale.createdAt).toLocaleString()),
        h('td', null, h('strong', null, money(sale.total))),
        h('td', null, sale.voided ? h(Badge, { tone: 'danger' }, t('voided'))
          : sale.returnStatus === 'full' ? h(Badge, { tone: 'danger' }, t('billReversedBadge'))
          : sale.returnStatus === 'partial' ? h(Badge, { tone: 'warning' }, t('hAlreadyReturned'))
          : h(Badge, { tone: 'success' }, t('posted'))),
        h('td', { className: 'row-actions' }, onReverse && !sale.voided
          ? h('button', { className: 'secondary small reverse-btn', onClick: () => onReverse(sale) }, t('reverseItems'))
          : null));
    }) : h('tr', null, h('td', { colSpan: 7 }, t('noSalesYet'))))));
}

function round3(value) { return Math.round((Number(value) || 0) * 1000) / 1000; }
const EMPTY_DELIVERY = () => ({ deliverTo: '', deliverAddress: '', transport: '', trNo: '', cases: '', freight: '', deliveryDate: '', orderTaker: '', salesPerson: '', packedBy: '', preparedBy: '', checkedBy: '' });
const DELIVERY_FIELDS = [
  ['deliverTo', 'deliverTo'], ['deliverAddress', 'deliverAddress'], ['transport', 'transport'],
  ['trNo', 'trNo'], ['cases', 'noCases'], ['freight', 'freightCharges'], ['deliveryDate', 'deliveryDate'],
  ['orderTaker', 'orderTaker'], ['salesPerson', 'salesPerson'], ['packedBy', 'packedBy'],
  ['preparedBy', 'preparedBy'], ['checkedBy', 'checkedBy']
];
const DELIVERY_LABELS = { deliverTo: 'deliverTo', deliverAddress: 'deliverAddress', transport: 'transport', trNo: 'trNo', cases: 'noCases', freight: 'freightCharges', deliveryDate: 'deliveryDate', orderTaker: 'orderTaker', salesPerson: 'salesPerson', packedBy: 'packedBy', preparedBy: 'preparedBy', checkedBy: 'checkedBy' };
const paymentMethodLabel = type => ({ Cash: 'cash', Card: 'card', Credit: 'udhaarPayment', Partial: 'partialPayment' }[type] ? t({ Cash: 'cash', Card: 'card', Credit: 'udhaarPayment', Partial: 'partialPayment' }[type]) : type);

const waNumber = phone => {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('92') && digits.length === 12 && !digits.startsWith('920')) return digits;
  if (digits.startsWith('0') && digits.length === 11) return '92' + digits.slice(1);
  return digits;
};
const waLink = (phone, text) => {
  const number = waNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text || '')}` : null;
};

// --- Bill as a picture for WhatsApp --------------------------------------------------
// The bill used to go as a long block of text. It is now drawn on a canvas and shared as an image,
// so the customer receives the same bill the printer produced. Drawing it here rather than
// screenshotting the page keeps the result identical on every phone and needs no extra library, so
// it also works with no internet.
const BILL_WIDTH = 720;
const BILL_PAD = 34;

// Shortens a line so it cannot run into the column beside it. The amount is always kept.
function ellipsize(ctx, text, maxWidth) {
  const value = String(text == null ? '' : text);
  if (ctx.measureText(value).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(cut + '...').width > maxWidth) cut = cut.slice(0, -1);
  return cut.trimEnd() + '...';
}

function drawBillImage(sale, settings, customer, labels) {
  const t = key => (labels && labels[key] != null ? labels[key] : key);
  const storeName = (settings && settings.storeName) || 'Faislabadi General Store';
  const storePhone = (settings && settings.phone) || '';
  const storeAddress = (settings && settings.address) || '';
  const saleDate = new Date(sale.createdAt || Date.now());
  const dateStr = saleDate.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = saleDate.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  const isCredit = sale.paymentType === 'Credit';
  const isPartial = isCredit && Number(sale.paidAmount) > 0 && Number(sale.paidAmount) < Number(sale.total);
  const methodLabel = isPartial ? t('partialPayment') : isCredit ? t('udhaarPayment') : sale.paymentType === 'Card' ? t('card') : t('cash');
  const due = Math.max(0, Number(sale.total) - Number(sale.paidAmount));
  const handed = Math.max(Number(sale.paidAmount), Number(sale.receivedAmount) || 0);
  const change = !isCredit ? Math.max(0, handed - Number(sale.total)) : 0;
  const delivery = sale.delivery && typeof sale.delivery === 'object' ? sale.delivery : null;
  const baseBalance = Number.isFinite(Number(sale.previousBalance)) ? Number(sale.previousBalance) : Number(customer && customer.balance) || 0;
  const items = (sale.items || []).map(item => ({
    name: item.name,
    qty: Number(item.qty) || 0,
    unit: unitLabel(item.unit),
    price: Number(item.price) || 0,
    line: (Number(item.price) || 0) * (Number(item.qty) || 0)
  }));

  const meta = [
    [t('invoiceWord'), sale.invoiceNo || t('pendingInvoice')],
    [t('dateLabel'), dateStr],
    [t('hPaymentTime'), timeStr],
    [t('cashierLabel'), sale.createdBy || '-'],
    [t('customerLabel'), (customer && customer.name) || t('walkIn')],
    [t('paymentLabel'), methodLabel]
  ];
  if (sale.reference) meta.push([t('referenceLabel'), sale.reference]);
  if (sale.offlineDraft) meta.push(['Status', 'OFFLINE - WILL SYNC']);

  const totals = [[t('subtotal'), money(sale.subtotal)]];
  if (Number(sale.discount) > 0) totals.push([t('discount'), '- ' + money(sale.discount)]);
  if (Number(sale.additionalDiscount) > 0) totals.push([t('additionalDiscount'), '- ' + money(sale.additionalDiscount)]);
  if (Number(sale.tax) > 0) totals.push([t('taxWord') + ' (' + (settings && settings.taxRate ? (settings.taxRate * 100).toFixed(0) : '18') + '%)', money(sale.tax)]);
  totals.push([t('grandTotalLabel'), money(sale.total)]);
  if (handed > 0) totals.push([t('amountReceived'), money(handed)]);
  if (change > 0) totals.push([t('changeLabel'), money(change)]);
  if (due > 0) totals.push([t('udharRemaining'), money(due)]);
  if (due > 0) totals.push([t('balanceForCustomer'), money(baseBalance + (sale.preview ? due : 0))]);

  // Measured in two passes: lay the bill out on a throwaway canvas to learn its height, then draw
  // it for real on a canvas of exactly that size. No guessing, so nothing is ever cut off.
  const measure = document.createElement('canvas').getContext('2d');
  const canvas = document.createElement('canvas');
  canvas.width = BILL_WIDTH;
  const build = ctx => {
    let y = BILL_PAD;
    // `align` is passed in because every helper below needs to right-align against a column edge,
    // and the canvas keeps whatever align it was last given.
    const text = (value, size, weight, colour, indent = 0, align = 'left') => {
      ctx.font = `${weight || '400'} ${size || 17}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = colour || '#111';
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(value, BILL_PAD + indent, y);
    };
    const rightMargin = BILL_WIDTH - BILL_PAD * 2;
    const centred = (value, size, weight, colour) => {
      ctx.font = `${weight || '400'} ${size || 17}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = colour || '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(value, BILL_WIDTH / 2, y);
      ctx.textAlign = 'left';
    };
    // Centred text that is wider than the paper is split into several lines instead of running off
    // the edge, and each line steps down the page so the lines cannot sit on top of one another.
    const centredLines = (value, size, weight, colour, lineStep) => {
      const step = lineStep || Math.round((size || 17) * 1.45);
      ctx.font = `${weight || '400'} ${size || 17}px "Segoe UI", system-ui, sans-serif`;
      const maxWidth = rightMargin;
      const lines = [];
      for (const paragraph of String(value == null ? '' : value).split('\n')) {
        let current = '';
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
          const next = current ? current + ' ' + word : word;
          if (current && ctx.measureText(next).width > maxWidth) {
            lines.push(current);
            current = word;
          } else {
            current = next;
          }
        }
        lines.push(current);
      }
      for (const line of lines) {
        if (line) centred(line, size, weight, colour);
        y += step;
      }
    };
    const divider = () => {
      ctx.strokeStyle = '#d8d8d8';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(BILL_PAD, Math.round(y) + 0.5);
      ctx.lineTo(BILL_WIDTH - BILL_PAD, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      y += 18;
    };
    const pair = (left, right, size, weight, colour) => {
      y += size || 20;
      text(left, size, weight, colour);
      text(right, size, weight, colour, rightMargin, 'right');
    };

    // Header
    centredLines(storeName, 27, '700', '#111', 34);
    if (storeAddress) centredLines(storeAddress, 15, '400', '#444', 21);
    if (storePhone) centredLines(storePhone, 15, '400', '#444', 21);
    y += 12;
    divider();

    // Meta
    for (const [left, right] of meta) pair(left, right, 18, '400', '#111');
    y += 6;
    divider();

    // Item columns
    const nameX = BILL_PAD;
    const qtyX = BILL_PAD + 330;
    const priceX = BILL_PAD + 430;
    const totalX = BILL_WIDTH - BILL_PAD;
    y += 20;
    text(t('hProduct'), 15, '700', '#333');
    text(t('qtyShort'), 15, '700', '#333', qtyX - nameX, 'right');
    text(t('rateLabel'), 15, '700', '#333', priceX - nameX, 'right');
    text(t('totalWord'), 15, '700', '#333', totalX - nameX, 'right');
    y += 4;
    divider();
    for (const item of items) {
      y += 24;
      text(ellipsize(ctx, item.name, 320), 17, '400');
      text(`${item.qty} ${item.unit}`, 17, '400', '#333', qtyX - nameX, 'right');
      text(moneyRate(item.price), 17, '400', '#333', priceX - nameX, 'right');
      text(moneyRate(item.line), 17, '600', '#111', totalX - nameX, 'right');
      // A long name is given its own line rather than being squeezed into the columns.
      if (ctx.measureText(String(item.name)).width > 320) y += 21;
    }
    y += 8;
    divider();

    // Totals
    for (const [left, right] of totals) pair(left, right, 18, left === t('grandTotalLabel') ? '700' : '400');
    y += 6;
    divider();

    // Delivery
    if (delivery && DELIVERY_FIELDS.some(([key]) => delivery[key])) {
      pair(t('deliveryInfo'), '', 18, '700', '#333');
      for (const [key, labelKey] of DELIVERY_FIELDS) {
        if (delivery[key]) pair(t(labelKey), delivery[key], 17, '400', '#333');
      }
      y += 6;
      divider();
    }

    // Footer, same wording as the printed bill
    y += 22;
    centred('Thank you for shopping with us!', 17, '400');
    y += 24;
    centred('Goods once sold will not be exchanged or returned', 15, '400', '#444');
    y += 30;
    centred('Designed and Developed By', 14, '400', '#777');
    y += 20;
    centred('Sohaib Ali', 16, '700', '#333');
    y += 20;
    centred('Mobile No: 03074224449', 14, '400', '#777');
    y += BILL_PAD;
    return y;
  };

  const height = build(measure);
  canvas.height = Math.max(320, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  build(ctx);
  return canvas;
}

// Shares the bill as a picture. Phones that support sharing files get the image attached to the
// message straight from the share sheet; anywhere else the picture is saved so it can be attached by
// hand. Either way the customer receives the bill itself, not a wall of text.
async function shareBillImage(sale, settings, customer, labels) {
  const canvas = drawBillImage(sale, settings, customer, labels);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not create the bill image');
  const safeInvoice = String(sale.invoiceNo || 'bill').replace(/[^a-z0-9-]+/gi, '-');
  const file = new File([blob], `${safeInvoice}.png`, { type: 'image/png' });
  const caption = `${(settings && settings.storeName) || 'Faislabadi General Store'} - ${sale.invoiceNo || ''}`.trim();
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

// Same thing for the screens that only need a button: the outcome is reported in that screen's own
// message line, so the cashier can see whether the picture was sent or saved.
async function shareBillAsImage(sale, settings, customer, report) {
  try {
    const outcome = await shareBillImage(sale, settings, customer, STRINGS[LANG] || STRINGS.en);
    if (!report) return;
    if (outcome === 'shared') {
      report(LANG === 'ur' ? 'بل کی تصویر بھیج دی گئی۔' : 'Bill picture sent.');
    } else {
      report(LANG === 'ur'
        ? 'بل کی تصویر محفوظ ہو گئی۔ اب WhatsApp کھول کر یہ تصویر بھیجیں۔'
        : 'Bill picture saved. Open WhatsApp and send this picture.');
    }
  } catch (err) {
    if (report) report(friendlyError(err));
  }
}
// WhatsApp renders a fenced block as monospace, so the same aligned columns the printed receipt uses
// stay aligned on the phone. This is a real invoice layout, not a "name / qty / price" text dump.
const WA_WIDTH = 32;
const waLine = (left, right) => {
  const l = String(left == null ? '' : left);
  const r = String(right == null ? '' : right);
  if (!l) return r;
  if (!r) return l;
  const gap = Math.max(1, WA_WIDTH - l.length - r.length);
  return l + ' '.repeat(gap) + r;
};
const waRow = (left, right) => ('  ' + waLine(left, right)).slice(0, 64);
// Rules carry the same two-space indent as the rows, so the divider lines up with the text above
// and below them instead of ending two characters short.
const waRule = char => '  ' + char.repeat(WA_WIDTH);
const waCenter = text => {
  const pad = Math.max(0, Math.floor((WA_WIDTH - String(text).length) / 2));
  return ' '.repeat(pad) + text;
};
const waDateOnly = value => {
  const d = value ? new Date(value) : null;
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
};
const waDate = value => {
  const d = value ? new Date(value) : null;
  if (!d || isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`;
};
const plain = value => String(value == null ? '' : value).replace(/[*_`#]/g, '');
// Ledger rows carry the running balance of every entry. Handing the bill text the "before" figure
// lets a shared bill show previous balance -> this bill -> new balance, with no extra request.
const withPrevBalance = entry => (entry && Number.isFinite(Number(entry.balanceBefore))
  ? { ...entry, previousBalance: Number(entry.balanceBefore) }
  : entry);

function waHeader(settings) {
  const storeName = plain((settings && settings.storeName) || 'Faislabadi General Store');
  const rows = [waCenter('*' + storeName + '*')];
  if (settings && settings.address) rows.push(waCenter(plain(settings.address)));
  if (settings && settings.phone) rows.push(waCenter(plain(settings.phone)));
  return rows;
}
function waFooter(settings) {
  const rows = [waRule('-')];
  if (settings && settings.address) rows.push(waCenter(plain(settings.address)));
  if (settings && settings.phone) rows.push(waCenter('Tel: ' + plain(settings.phone)));
  rows.push(waCenter(LANG === 'ur' ? 'شکریہ! دوبارہ تشریف لائیں۔' : 'Thank you! Please visit again.'));
  return rows;
}
// Walks the same blocks the printed receipt shows, in the same order and with the same wording, so
// the WhatsApp message is a readable copy of the printed bill rather than a separate format.
function saleBillText(sale, settings) {
  const rows = [];
  const total = Number(sale.total != null ? sale.total : sale.amount) || 0;
  const paid = Number(sale.paidAmount != null ? sale.paidAmount : (sale.paidAtBilling || 0)) || 0;
  const due = Math.max(0, total - paid);
  const handed = Math.max(paid, Number(sale.receivedAmount) || 0);
  const change = Math.max(0, handed - total);
  const prevBalance = Number(sale.previousBalance);
  const created = new Date(sale.createdAt || sale.at || 0);
  const timeText = isNaN(created.getTime()) ? '' : created.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  const methodLabel = sale.paymentType === 'Credit'
    ? (paid > 0 && paid < total ? t('partialPayment') : t('udhaarPayment'))
    : (sale.paymentType === 'Card' ? t('card') : t('cash'));

  // --- Receipt header ---
  rows.push(...waHeader(settings));
  rows.push(waRule('-'));
  // --- Receipt meta, in printed order ---
  rows.push(waRow(t('invoiceWord'), sale.invoiceNo || t('pendingInvoice')));
  rows.push(waRow(t('dateLabel'), waDateOnly(sale.createdAt || sale.at)));
  rows.push(waRow(t('hPaymentTime'), timeText));
  rows.push(waRow(t('cashierLabel'), plain(sale.createdBy) || '-'));
  rows.push(waRow(t('customerLabel'), plain(sale.customerNameAtBilling || sale.customerName) || t('walkIn')));
  rows.push(waRow(t('paymentLabel'), methodLabel));
  if (sale.reference) rows.push(waRow(t('referenceLabel'), plain(sale.reference)));
  if (sale.offlineDraft) rows.push(waRow('Status', 'OFFLINE - WILL SYNC'));
  rows.push(waRule('-'));
  // --- Item table: name / qty+unit / rate / amount, the four printed columns ---
  rows.push(waRow('  ' + t('hProduct'), t('qtyShort')));
  rows.push(waRow('  ' + t('rateLabel'), t('totalWord')));
  rows.push(waRule('-'));
  (sale.items || []).forEach(item => {
    const qty = Number(item.qty) || 0;
    const price = Number(item.price) || 0;
    const amount = item.amount != null ? Number(item.amount) : qty * price;
    rows.push(waRow('  ' + plain(item.name), `${qty}${item.unit ? ' ' + unitName(item.unit) : ''}`));
    rows.push(waRow(`    @ ${moneyRate(price)}`, moneyRate(amount)));
  });
  rows.push(waRule('-'));
  // --- Totals block, same rows as the printed receipt ---
  const subtotal = Number(sale.subtotal) || (total + (Number(sale.discount) || 0) - (Number(sale.tax) || 0));
  rows.push(waRow(t('subtotal'), money(subtotal)));
  if (Number(sale.discount) > 0) rows.push(waRow(t('discount'), '- ' + money(sale.discount)));
  if (Number(sale.additionalDiscount) > 0) rows.push(waRow(t('additionalDiscount'), '- ' + money(sale.additionalDiscount)));
  if (Number(sale.tax) > 0) rows.push(waRow(t('taxWord'), money(sale.tax)));
  rows.push(waRow('*' + t('grandTotalLabel') + '*', '*' + money(total) + '*'));
  if (handed > 0) rows.push(waRow(t('amountReceived'), money(handed)));
  if (change > 0) rows.push(waRow(t('changeLabel'), money(change)));
  if (due > 0) rows.push(waRow(t('udharRemaining'), money(due)));
  if (due > 0 && !Number.isNaN(prevBalance)) {
    rows.push(waRow(t('previousBalance'), money(prevBalance)));
    rows.push(waRow('*' + t('newBalance') + '*', '*' + money(prevBalance + due) + '*'));
  }
  if (sale.delivery && typeof sale.delivery === 'object') {
    const shown = DELIVERY_FIELDS.filter(([key]) => sale.delivery[key]);
    if (shown.length) {
      rows.push(waRule('-'));
      rows.push(waCenter(t('deliveryInfo')));
      shown.forEach(([key, labelKey]) => rows.push(waRow('  ' + t(labelKey), plain(sale.delivery[key]))));
    }
  }
  rows.push(waRule('-'));
  rows.push(waCenter('[' + methodLabel + ']'));
  rows.push(...waFooter(settings));
  rows.push(waCenter('Designed and Developed By'));
  rows.push(waCenter('Sohaib Ali - 03074224449'));
  return '```\n' + rows.join('\n') + '\n```';
}
// One ledger row's effect on the outstanding balance. Sales and manually entered udhar add, payments
// subtract. Used for the WhatsApp running balance so the statement always adds up to the real one.
const entryDelta = entry => {
  const amount = Number(entry && entry.amount) || 0;
  if (entry && entry.type === 'payment') return -amount;
  if (entry && entry.type === 'sale') return amount - (Number(entry.paidAtBilling) || 0);
  return amount;
};
function khataStatementText(customer, entries, balance, settings) {
  const rows = [];
  const all = entries || [];
  // Opening balance = the balance that is left once every stored transaction is taken out again, so
  // it stays correct no matter how many rows the statement shows.
  const opening = Math.max(0, (Number(balance) || 0) - all.reduce((sum, entry) => sum + entryDelta(entry), 0));
  rows.push(...waHeader(settings));
  rows.push(waRule('='));
  rows.push(waRow(LANG === 'ur' ? 'کھاتہ' : 'KHATA', plain(customer && customer.name)));
  rows.push(waRow(LANG === 'ur' ? 'گاہک نمبر' : 'Customer ID', '#' + plain(customer && customer.id)));
  if (customer && customer.phone) rows.push(waRow(LANG === 'ur' ? 'موبائل' : 'Mobile', plain(customer.phone)));
  rows.push(waRow(LANG === 'ur' ? 'کھاتہ بند' : 'Statement date', waDate(new Date().toISOString())));
  rows.push(waRule('-'));
  rows.push(waRow(LANG === 'ur' ? 'پچھلا بیلنس' : 'Previous balance', money(opening)));
  rows.push(waCenter(LANG === 'ur' ? 'نئی لین ڈار این ٹری' : 'NEW TRANSACTIONS'));
  rows.push(waRule('-'));
  rows.push(waRow(LANG === 'ur' ? 'تاریخ / وقت' : 'Date / Time', LANG === 'ur' ? 'رقم / بیلنس' : 'Amount / Balance'));
  rows.push(waRule('-'));
  // The ledger arrives newest first; walk it oldest first so the running balance reads correctly.
  const shown = all.slice(0, 40).slice().reverse();
  let running = opening;
  shown.forEach(entry => {
    running = Math.max(0, running + entryDelta(entry));
    const isCredit = entry.type !== 'payment';
    const heading = entry.type === 'sale'
      ? (LANG === 'ur' ? 'اُدھار بل' : 'Credit bill') + (entry.invoiceNo ? ' ' + plain(entry.invoiceNo) : '')
      : entry.type === 'udhar'
        ? (LANG === 'ur' ? 'نیا اُدھار' : 'New udhar') + (entry.note ? ' - ' + plain(entry.note) : '')
        : (LANG === 'ur' ? 'ادائیگی موصول' : 'Payment received') + (entry.invoiceNo ? ' (' + plain(entry.invoiceNo) + ')' : (entry.note ? ' - ' + plain(entry.note) : ''));
    const shownAmount = entry.type === 'sale' ? Number(entry.amount || 0) - (Number(entry.paidAtBilling) || 0) : Number(entry.amount) || 0;
    rows.push(waRow('  ' + heading, (isCredit ? '+' : '-') + money(shownAmount)));
    rows.push(waRow('    ' + waDate(entry.at), (LANG === 'ur' ? 'بیلنس ' : 'Bal ') + money(running)));
    (entry.items || []).forEach(item => {
      rows.push(waRow('    - ' + plain(item.name), `${item.qty}${item.unit ? ' ' + unitName(item.unit) : ''} x ${money(item.price)} = ${money(item.amount)}`));
    });
    if (entry.reference) rows.push(waRow('    ' + (LANG === 'ur' ? 'حوالہ' : 'Ref'), plain(entry.reference)));
    if (entry.createdBy) rows.push(waRow('    ' + (LANG === 'ur' ? 'بذریعہ' : 'By'), plain(entry.createdBy)));
  });
  if (all.length > shown.length) {
    rows.push(waRow('  ' + (LANG === 'ur' ? 'اور پرانی لین ڈار این ٹری شامل ہیں' : 'plus ' + (all.length - shown.length) + ' earlier transactions'), ''));
  }
  rows.push(waRule('-'));
  rows.push(waRow('*' + (LANG === 'ur' ? 'کل باقی اُدھار' : 'TOTAL OUTSTANDING') + '*', '*' + money(balance) + '*'));
  rows.push(...waFooter(settings));
  return '```\n' + rows.join('\n') + '\n```';
}

function ScanCamera({ onCode, onClose }) {
  const videoRef = React.useRef(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  useEffect(() => {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(t('cameraUnsupported'));
      return undefined;
    }
    let cancelled = false;
    let raf = 0;
    function stopTracks() {
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    }
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        videoRef.current.srcObject = stream;
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          if (videoRef.current.readyState >= 2) {
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes && codes.length && codes[0].rawValue) {
                stopTracks();
                onCode(String(codes[0].rawValue));
                return;
              }
            } catch (_) {}
          }
          raf = requestAnimationFrame(tick);
        };
        try { await videoRef.current.play(); } catch (_) {}
        raf = requestAnimationFrame(tick);
      } catch (err) {
        if (err && err.name === 'NotAllowedError') setError(t('cameraDenied'));
        else if (err && err.name === 'NotFoundError') setError(t('noCamera'));
        else setError(t('cameraUnsupported'));
      }
    }
    start();
    return () => { cancelled = true; stopTracks(); cancelAnimationFrame(raf); };
  }, []);
  function submitManual(event) {
    event.preventDefault();
    const code = manual.trim();
    if (!code) return;
    onCode(code);
  }
  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'scan-card', onClick: function(e) { e.stopPropagation(); } },
      h('header', { className: 'khata-head' }, h('div', null, h('p', { className: 'eyebrow' }, t('cameraScanTitle')), h('h2', null, t('scanCamera')))),
      h('div', { className: 'scan-feed' }, h('video', { ref: videoRef, className: 'scan-video', autoPlay: true, playsInline: true, muted: true })),
      error && h('div', { className: 'notice' }, error),
      !error && h('p', { className: 'scan-hint' }, t('cameraNote')),
      h('form', { className: 'scan-manual', onSubmit: submitManual },
        h('input', { value: manual, onChange: e => setManual(e.target.value), placeholder: t('typeBarcodeLabel'), autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }),
        h('button', { className: 'primary', type: 'submit' }, t('add'))),
      h('div', { className: 'success-actions' }, h('button', { className: 'secondary', onClick: onClose }, t('closeScan'))))),
    document.body);
}

function DraftsModal({ drafts, customers, onLoad, onDelete, onClose }) {
  const nameOf = id => (customers.find(c => c.id === id) || {}).name || t('walkInCustomer');
  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('section', { className: 'draft-modal', onClick: function(e) { e.stopPropagation(); } },
      h('header', { className: 'khata-head' }, h('div', null, h('p', { className: 'eyebrow' }, t('draftsLabel')), h('h2', null, t('openDrafts'))), h('button', { className: 'secondary small', onClick: onClose }, t('close'))),
      drafts.length ? h('div', { className: 'draft-list' }, drafts.map(draft => {
        const count = (draft.items || []).length;
        const estimate = (draft.items || []).reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
        const when = new Date(draft.updatedAt || draft.createdAt).toLocaleString();
        return h('div', { className: 'draft-row', key: draft.id },
          h('div', { className: 'draft-info' },
            h('strong', null, `${count} ${t('itemsShort')} - ${money(estimate)}`),
            h('small', null, `${nameOf(draft.customerId)} - ${when}${draft.createdByName ? ` - ${t('createdBy2')} ${draft.createdByName}` : ''}`)),
          h('div', { className: 'draft-actions' },
            h('button', { className: 'secondary small', onClick: () => onLoad(draft) }, t('loadingDrafts')),
            h('button', { className: 'secondary small danger-btn', onClick: () => onDelete(draft) }, t('delete'))));
      })) : h('div', { className: 'empty' }, h('h3', null, t('noDrafts'))),
      h('div', { className: 'success-actions' }, h('button', { className: 'primary', onClick: onClose }, t('close'))))),
    document.body);
}

function POS({ client, data, refresh, applySale, online, setOnline, go }) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(-1);
  // Hover is a purely visual pointer state and is cleared as soon as the pointer leaves the list.
  // searchIndex is the real keyboard selection, so moving the mouse can never make a row look
  // selected - and Enter always acts on the keyboard selection only.
  const [searchHover, setSearchHover] = useState(-1);
  const [cart, setCart] = useState([]);
  // Which bill row the pointer/focus is on. Visual only - it never changes what is billed.
  const [focusIndex, setFocusIndex] = useState(-1);
  const [draftId, setDraftId] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerIdx, setCustomerIdx] = useState(-1);
  const [customerHover, setCustomerHover] = useState(-1);
  const [customerId, setCustomerId] = useState('cus_walkin');
  // The name the cashier typed into the customer box that did not match anyone. Offered as a
  // one-tap "add this customer" so billing never has to stop and go to the customers page.
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [paymentType, setPaymentType] = useState('Cash');
  const [receivedInput, setReceivedInput] = useState('');
  const [discount, setDiscount] = useState('');
  const [additionalDiscount, setAdditionalDiscount] = useState('');
  const [reference, setReference] = useState('');
  const [delivery, setDelivery] = useState(EMPTY_DELIVERY());
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ name: '', price: '', qty: '1', unit: 'pcs' });
  const [receipt, setReceipt] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [draftsModal, setDraftsModal] = useState(false);
  const [khataOpen, setKhataOpen] = useState(false);
  // When a bill is completed for a named customer, their khata is the natural next screen. It is opened
  // once the receipt is dismissed so the printed bill is the last thing on screen while it prints.
  const [khataAfterReceipt, setKhataAfterReceipt] = useState(false);
  const [message, setMessage] = useState('');
  const [profile, setProfile] = useState(null);
  const [profileTick, setProfileTick] = useState(0);
  const [charging, setCharging] = useState(false);
  const chargingRef = React.useRef(false);
  const profileFor = React.useRef('');
  // Last allowed stock per product id, in the product's own base unit. The server is still the
  // authority, but this lets the qty box warn before a round trip when a line is billed in grams.
  const stockLimits = React.useRef({});
  const searchRef = React.useRef(null);
  const customerInputRef = React.useRef(null);
  const billRef = React.useRef(null);
  const printerCfg = loadJson(printerConfigKey, { autoPrint: false, paperSize: '80' });
  const activeProducts = (data.products || []).filter(product => product.active && product.status !== 'inactive');
  const barcodeMap = React.useMemo(() => {
    const map = {};
    activeProducts.forEach(product => {
      if (product.barcode) map[String(product.barcode).toLowerCase()] = product;
      if (product.sku) map[String(product.sku).toLowerCase()] = map[String(product.sku).toLowerCase()] || product;
    });
    return map;
  }, [data.products]);
  const q = query.trim().toLowerCase();
  const shown = q
    ? activeProducts.filter(product => `${product.name} ${product.sku} ${product.barcode || ''} ${product.category || ''} ${product.nameUrdu || ''} ${product.urduName || ''}`.toLowerCase().includes(q))
    : [];
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const discountNum = Math.max(0, Number(discount) || 0);
  const addDiscNum = Math.max(0, Number(additionalDiscount) || 0);
  const mainD = Math.min(discountNum, subtotal);
  const extraD = Math.min(addDiscNum, Math.max(0, subtotal - mainD));
  const combinedD = Math.round(mainD + extraD);
  const total = Math.max(0, Math.round(subtotal) - combinedD);
  const isCredit = paymentType === 'Credit' || paymentType === 'Partial';
  let receivedNum = Math.max(0, Math.round(Number(receivedInput) || 0));
  if (!isCredit && receivedInput === '') receivedNum = total;
  if (isCredit) receivedNum = Math.min(total, receivedNum);
  const paidNow = isCredit ? receivedNum : total;
  const dueAmount = Math.max(0, total - paidNow);
  const changeAmount = !isCredit ? Math.max(0, receivedNum - total) : 0;
  const selectedCustomer = data.customers.find(item => item.id === customerId);
  const totalQty = cart.reduce((sum, item) => sum + Number(item.qty), 0);
  const totalPacks = cart.filter(item => ['pack', 'dozen', 'boree'].includes(item.unit)).reduce((sum, item) => sum + Number(item.qty), 0);
  const hasDelivery = (delivery && Object.keys(delivery).some(key => String(delivery[key] || '').trim() !== '')) || false;

  function flash(text) { setMessage(text); setTimeout(() => { setMessage(m => (m === text ? '' : m)); }, 2600); }

  function addProduct(product) {
    setCart(items => {
         const old = items.find(item => item.productId === product.id);
         if (old) return items.map(item => item.productId === product.id ? { ...item, qty: round3(Number(item.qty) + (isWeightUnit(item.unit) ? 0.25 : 1)) } : item);
         // productUnit/basePrice let a later UOM change on this row convert the qty and the rate.
         return [...items, { productId: product.id, name: product.name, sku: product.sku || '', price: Number(product.price), basePrice: Number(product.price), productUnit: product.unit, qty: 1, unit: product.unit, manual: false, customRate: false, mode: 'qty' }];
    });
    flash(LANG === 'ur' ? `${product.name} شامل ہو گئی۔` : `${product.name} added.`);
  }

  function addFromSearch(product) {
    addProduct(product);
    setQuery('');
    setSearchOpen(false);
    setSearchIndex(-1);
    if (searchRef.current) searchRef.current.focus();
  }

  function addProductQty(product, qty) {
    const addQty = isWeightUnit(product.unit) ? round3(Number(qty)) : Math.max(1, Math.round(Number(qty) || 1));
    setCart(items => {
         const old = items.find(item => item.productId === product.id);
         if (old) return items.map(item => item.productId === product.id ? { ...item, qty: round3(Number(item.qty) + addQty) } : item);
         return [...items, { productId: product.id, name: product.name, sku: product.sku || '', price: Number(product.price), basePrice: Number(product.price), productUnit: product.unit, qty: addQty, unit: product.unit, manual: false, customRate: false, mode: 'qty' }];
    });
    flash(LANG === 'ur' ? `${product.name} ${addQty} ${unitLabel(product.unit)} شامل ہوئی۔` : `${addQty} ${unitLabel(product.unit)} of ${product.name} added.`);
    if (searchRef.current) searchRef.current.focus();
  }

  function addManualItem(event) {
    event.preventDefault();
    const price = Number(manual.price);
    const qty = Number(manual.qty);
    if (!manual.name.trim() || price <= 0 || qty <= 0) { flash(LANG === 'ur' ? 'نام، قیمت اور تعداد درست لکھیں۔' : 'Enter a valid name, price and quantity.'); return; }
    setCart(items => [...items, { productId: null, name: manual.name.trim(), sku: '', price, qty, unit: manual.unit, manual: true, mode: 'qty' }]);
    setManual({ name: '', price: '', qty: '1', unit: 'pcs' });
    flash(`${manual.name.trim()} ${LANG === 'ur' ? 'شامل ہوئی۔' : 'added.'}`);
  }

  function changeQty(index, delta) {
    setCart(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, qty: round3((Number(item.qty) || 0) + delta) } : item).filter(item => Number(item.qty) > 0));
  }

  function setLineQty(index, value) {
    setCart(items => items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const price = Number(item.price) || 0;
      // Qty is kept in the unit shown on the row; the server converts it to the product's base unit
      // for stock, so the cashier can enter 500 gram on a kg product.
      const qty = Math.max(0, round3(Number(value) || 0));
      return { ...item, qty, amount: round3(price * qty) };
    }));
  }

  function setLineAmount(index, value) {
    setCart(items => items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const price = Number(item.price) || 0;
      const amount = Math.max(0, round3(Number(value) || 0));
      return { ...item, amount, qty: price ? round3(amount / price) : 0 };
    }));
  }

  function setLinePrice(index, value) {
    // The rate is the source of truth, so editing it returns the row to rate x qty. customRate marks
    // the line so a later UOM change re-prices from here instead of snapping back to list price.
    setCart(items => items.map((item, itemIndex) => (itemIndex === index
      ? { ...item, price: Math.max(0, round3(Number(value) || 0)), customRate: true, mode: 'qty' }
      : item)));
  }

  function setLineUnit(index, value) {
    // Keep the physical amount the same and re-price it: 2 kg at Rs 100/kg becomes 2000 gram at
    // Rs 0.05/g, so switching the UOM never changes what the customer owes. The rate is derived from
    // the product's own rate unless the cashier typed a custom one for this line.
    setCart(items => items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const from = item.unit;
      if (from === value) return item;
      const baseUnit = item.productUnit || from;
      // Nothing sensible to convert between different kinds of unit (gram of a litre product), so
      // leave the numbers alone instead of guessing. The dropdown only offers these anyway.
      if (unitDimension(from) && unitDimension(baseUnit) && unitDimension(value)
        && !(unitDimension(value) === unitDimension(baseUnit))) return item;
      const qty = Number(item.qty) || 0;
      const factor = unitToBase(from, baseUnit);
      const nextFactor = unitToBase(value, baseUnit);
      const newQty = round3(qty * (factor / (nextFactor || 1)));
      // A typed rate belongs to the unit it was typed in, so lift it to the product's base unit
      // first. Without this, a custom Rs 120/kg typed in kilo would be read as Rs 120 per gram
      // base and jump by a factor of 1000.
      const baseRate = item.customRate
        ? rateToBase((Number(item.price) || 0), from, baseUnit)
        : (Number(item.basePrice) || Number(item.price) || 0);
      const price = rateForUnit(baseRate, value, baseUnit);
      const amount = item.mode === 'amt' ? round3(price * newQty) : undefined;
      return { ...item, unit: value, qty: newQty, price, amount: amount === undefined ? item.amount : amount };
    }));
  }

  function toggleLineMode(index) {
    setCart(items => items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const price = Number(item.price) || 0;
      const qty = Number(item.qty) || 1;
      const amount = Number(item.amount) || round3(price * qty) || 0;
      if (item.mode === 'qty') return { ...item, mode: 'amt', amount: round3(price * qty) };
      return { ...item, mode: 'qty', qty: price ? round3(amount / price) : qty };
    }));
  }

  function removeLine(index) {
    setCart(items => items.filter((_, itemIndex) => itemIndex !== index));
  }

  const customers = (data.customers || []).filter(customer => {
    const customerQ = customerSearch.trim().toLowerCase();
    if (!customerQ) return false;
    return `${customer.name || ''} ${customer.phone || ''}`.toLowerCase().includes(customerQ);
  });

  // Only offer to create a customer when the typed text is not already someone in the list. Offering
  // it next to an exact match is how two accounts for one person end up on the same khata.
  const typedName = customerSearch.trim();
  const canAddTypedCustomer = Boolean(typedName) && !customerQExact(typedName);
  function customerQExact(name) {
    const q = name.trim().toLowerCase();
    return (data.customers || []).some(customer => String(customer.name || '').trim().toLowerCase() === q);
  }

  function selectCustomer(customer) {
    setCustomerId(customer.id);
    setCustomerSearch(customer.id === 'cus_walkin' ? '' : customer.name);
    setCustomerOpen(false);
    setCustomerIdx(-1);
    // Naming a customer means the goods go on their khata, so default the bill to udhar.
    // Tapping Cash/Card (or Full) switches it back to a paid sale.
    setPaymentType(customer.id === 'cus_walkin' ? 'Cash' : 'Credit');
    setReceivedInput(customer.id === 'cus_walkin' ? '' : '0');
  }

  useEffect(() => {
    let stopped = false;
    if (!customerId || customerId === 'cus_walkin') {
      profileFor.current = '';
      setProfile(null);
      return undefined;
    }
    // Only blank the panel when the cashier actually switches customer. Refreshing the same
    // customer's ledger keeps the old rows on screen, so the bill just completed never disappears
    // and never leaves an empty "loading" panel behind.
    if (profileFor.current !== customerId) {
      profileFor.current = customerId;
      setProfile(null);
    }
    client.get(`/api/customers/${customerId}/ledger`)
      .then(payload => { if (!stopped) setProfile(payload); })
      .catch(() => {});
    return () => { stopped = true; };
  }, [customerId, client, data.user && data.user.role, profileTick]);

  function resetSale(options) {
    const keepCustomerId = (options && options.keepCustomerId) || 'cus_walkin';
    setCart([]);
    setFocusIndex(-1);
    setDraftId(null);
    setCustomerId(keepCustomerId);
    if (keepCustomerId === 'cus_walkin') setCustomerSearch('');
    setCustomerOpen(false);
    setCustomerIdx(-1);
    // Keep the same udhar-by-default rule for a customer who is still selected.
    setPaymentType(keepCustomerId === 'cus_walkin' ? 'Cash' : 'Credit');
    setReceivedInput(keepCustomerId === 'cus_walkin' ? '' : '0');
    setDiscount('');
    setAdditionalDiscount('');
    setReference('');
    setDelivery(EMPTY_DELIVERY());
    setManualOpen(false);
    setManual({ name: '', price: '', qty: '1', unit: 'pcs' });
    setSearchOpen(false);
    setSearchIndex(-1);
    setQuery('');
  }

  async function syncQueuedSales() {
    const queued = loadJson(queueKey, []);
    if (!queued.length) return;
    try {
      await client.post('/api/sync', { sales: queued });
      saveJson(queueKey, []);
      flash(LANG === 'ur' ? 'آف لائن سیلز سنک ہو گئیں۔' : 'Offline sales synced.');
      await refresh();
    } catch (_) {
      setOnline(false);
    }
  }

  function sanitizedDelivery() {
    const cleaned = {};
    DELIVERY_FIELDS.forEach(([key]) => {
      const value = delivery && delivery[key];
      if (String(value || '').trim()) cleaned[key] = String(value).trim();
    });
    return Object.keys(cleaned).length ? cleaned : null;
  }

  function buildPayload() {
    const payload = {
      // Built once per cart and reused by any retry of that same cart, so the server can recognise a
      // repeat and answer with the bill it already saved. The random tail keeps two bills completed
      // in the same millisecond from being mistaken for one.
      clientId: `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      customerId,
      paymentType: paymentType === 'Partial' ? 'Credit' : paymentType,
      discount: mainD,
      additionalDiscount: extraD,
      items: cart.map(item => ({ ...item })),
      taxRate: 0,
      reference: reference.trim(),
      delivery: sanitizedDelivery()
    };
    if (isCredit) payload.paidAmount = paidNow;
    return payload;
  }

  function previewSale() {
    if (!cart.length || cart.some(item => !(Number(item.qty) > 0))) {
      flash(t('completeSaleBlockedCart'));
      return;
    }
    if (dueAmount > 0 && (!selectedCustomer || customerId === 'cus_walkin')) {
      flash(t('partialNeedsCustomer'));
      return;
    }
    setReceipt({
      preview: true,
      invoiceNo: null,
      createdAt: new Date().toISOString(),
      createdBy: (data.user && data.user.name) || '',
      customerId,
      paymentType,
      source: 'preview',
      items: cart.map(item => ({ ...item, manual: !item.productId })),
      subtotal: Math.round(subtotal),
      discount: combinedD,
      additionalDiscount: extraD,
      tax: 0,
      taxRate: 0,
      total,
      paidAmount: isCredit ? paidNow : total,
      dueAmount: isCredit ? dueAmount : 0,
      reference: reference.trim(),
      delivery: sanitizedDelivery(),
      returnStatus: 'none'
    });
  }

  async function charge(printAfter) {
    // Guard against a double tap / double F2 sending the same cart twice and billing the customer
    // for two identical invoices.
    if (chargingRef.current) return;
    if (!cart.length || cart.some(item => !(Number(item.qty) > 0))) {
      setMessage(t('completeSaleBlockedCart'));
      return;
    }
    if (dueAmount > 0 && (!selectedCustomer || customerId === 'cus_walkin')) {
      setMessage(t('partialNeedsCustomer'));
      return;
    }
    if (!isCredit && receivedNum < total) {
      setMessage(t('cashNeedsFull'));
      return;
    }
    let warnNoStock = false;
    for (const item of cart) {
      if (item.manual || !item.productId) continue;
      const product = activeProducts.find(p => p.id === item.productId);
      if (!product) continue;
      // Compare in the product's base unit, because that is how stock is stored. Billing 2000 gram
      // against a 0.5 kg product must not be read as 2000 kg.
      const baseQty = round3(Number(item.qty) * unitToBase(item.unit, product.unit));
      // Only enforce the limit when a real stock figure was entered. Most products here have never
      // been given one and read as 0, and treating that as "none left" made Complete & Print refuse
      // the whole bill, so the counter simply could not sell.
      const onHand = Number(product.stock || 0);
      if (onHand > 0 && baseQty > onHand + 1e-9) {
        setMessage(t('quantityTooHigh').replace('{stock}', String(round3(product.stock))).replace('{unit}', unitLabel(product.unit)).replace('{name}', product.name));
        return;
      }
      if (onHand <= 0) warnNoStock = true;
    }
    const payload = buildPayload();
    chargingRef.current = true;
    setCharging(true);
    try {
      const response = await client.post('/api/sales', payload);
      // The response carries the saved invoice plus the customer's recalculated row. The receipt and
      // the khata only need the invoice, so the extra row is kept out of the stored sale.
      const sale = response.customer ? { ...response, customer: undefined } : response;
      // Snapshot the balance from before the bill, so the invoice and the WhatsApp bill can show
      // previous balance / new balance without any extra request.
      const prevBalance = Number((selectedCustomer && selectedCustomer.balance) || 0);
      // Keep the customer on the bill after a completed sale, whether or not udhar was left. Dropping them
      // back to Walk-in meant the next bill for the same person went nowhere near their khata.
      const keepCustomerId = customerId !== 'cus_walkin' ? customerId : null;
      setReceipt({ ...sale, previousBalance: prevBalance, customerNameAtBilling: (selectedCustomer && selectedCustomer.name) || '' });
      // Every bill for a named customer lands on their khata straight away, product names included,
      // instead of only the ones that left udhar.
      if (keepCustomerId) showSaleInProfile(sale, prevBalance);
      if (keepCustomerId) setKhataAfterReceipt(true);
      resetSale({ keepCustomerId });
      setMessage(warnNoStock
        ? t('saleCompleteMessage') + ' — ' + (LANG === 'ur'
          ? 'ان چیزوں کا stock درج نہیں تھا۔ Settings → Stock سے stock لگا لیں۔'
          : 'Stock was not set for some items. Please enter their stock in Settings -> Stock.')
        : t('saleCompleteMessage'));
      // Print as soon as the receipt is on screen (next painted frame) instead of waiting on the
      // background refresh - no artificial delay, and still never before the receipt is rendered.
      if (printAfter || printerCfg.autoPrint) schedulePrint();
      if (draftId) {
        // Fire and forget: clearing the draft must not hold up the receipt.
        client.del(`/api/drafts/${draftId}`).catch(() => {});
      }
      // The save response already carries the saved invoice, so the screen is patched from it here
      // rather than pulling the whole store down again. A full /api/bootstrap fetch after every bill
      // was a second round trip the cashier waited through before the next one could start.
      applySale(response);
      if (keepCustomerId) setProfileTick(n => n + 1);
      // The low-stock list and the day's totals are not part of the save response, so pull them in the
      // background a moment later. It is deliberately not awaited: the cashier already has the receipt
      // and can start the next bill while this runs, and the dashboards reload themselves on open.
      setTimeout(() => { if (typeof refresh === 'function') refresh(); }, 1200);
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
          items: cart.map(item => ({ productId: item.productId, name: item.name, sku: item.sku || '', unit: item.unit, qty: Number(item.qty), price: Number(item.price), cost: 0, manual: !item.productId })),
          subtotal: Math.round(subtotal),
          discount: combinedD,
          additionalDiscount: extraD,
          tax: 0,
          taxRate: 0,
          total,
          paidAmount: isCredit ? paidNow : total,
          dueAmount: isCredit ? dueAmount : 0,
          reference: reference.trim(),
          delivery: sanitizedDelivery(),
          returnStatus: 'none'
        });
        resetSale();
        setOnline(false);
        // The offline receipt is built and shown on exactly the same path as an online one, so it
        // must print the same way too. Without this the cashier got the bill on screen but the
        // printer stayed silent whenever the request could not reach the server.
        if (printAfter || printerCfg.autoPrint) schedulePrint();
        setMessage(LANG === 'ur'
          ? 'آف لائن محفوظ ہو گیا۔ رسید نیچے پرنٹ کریں - انٹرنیٹ آنے پر سیل خود بخود سنک ہو جائے گی۔'
          : 'Saved OFFLINE. Receipt printed below - sale will sync automatically when internet returns.');
      } else {
        setMessage(friendlyError(err));
      }
    } finally {
      chargingRef.current = false;
      setCharging(false);
    }
  }

  const chargeRef = React.useRef(null);
  chargeRef.current = () => charge(false);

  // Printing the receipt modal where it sits was the reason the printer kept getting a blank sheet: the
  // modal is a portal inside a fixed, scrollable overlay, and phones and tablets snapshot the page
  // before it is laid out. So the finished receipt is copied into a dedicated #print-root that sits
  // outside the app, the copy is what gets printed, and the on-screen modal is left alone.
  function schedulePrint() {
    let waited = 0;
    (function printWhenReady() {
      const node = document.querySelector('.receipt-modal .receipt');
      const printRoot = document.getElementById('print-root');
      if (node && printRoot) {
        printRoot.innerHTML = '';
        const copy = node.cloneNode(true);
        copy.removeAttribute('style');
        printRoot.appendChild(copy);
        // Give the browser one paint with the copy in place, then hand over to the print dialog.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.print();
          // Clean up after the dialog closes so the next bill starts from a clean page.
          setTimeout(() => { printRoot.innerHTML = ''; }, 1000);
        }));
        return;
      }
      if (waited >= 60) {
        window.print();
        return;
      }
      waited += 1;
      setTimeout(printWhenReady, 16);
    })();
  }

  // Put the just-completed bill into the on-screen khata immediately. The ledger is still refetched
  // in the background for accuracy, but the new transaction is visible without waiting for it.
  function showSaleInProfile(sale, prevBalance) {
    const paid = Math.round(Number(sale.paidAmount) || 0);
    const due = Math.max(0, Math.round(Number(sale.total) || 0) - paid);
    setProfile(old => {
      const base = old || {};
      const entry = {
        type: 'sale',
        id: sale.id,
        at: sale.createdAt,
        invoiceNo: sale.invoiceNo,
        amount: sale.total,
        paidAtBilling: paid,
        paidInFull: due <= 0,
        udharAdded: due,
        balanceBefore: prevBalance,
        balanceAfter: prevBalance + due,
        products: (sale.items || []).map(item => `${item.name} x${item.qty}`).join(', '),
        items: (sale.items || []).map(item => ({
          name: item.name,
          sku: item.sku || '',
          qty: Number(item.qty) || 0,
          unit: item.unit || 'pcs',
          price: Number(item.price) || 0,
          amount: Math.round((Number(item.price) || 0) * (Number(item.qty) || 0))
        })),
        createdBy: sale.createdByName || ''
      };
      return {
        ...base,
        entries: [entry, ...(base.entries || [])],
        balanceAfter: Object.assign({}, base.balanceAfter, { [entry.id]: entry.balanceAfter }),
        balanceBefore: Object.assign({}, base.balanceBefore, { [entry.id]: entry.balanceBefore })
      };
    });
  }

  function addFromCode(code) {
    const target = barcodeMap[String(code).toLowerCase().trim()];
    if (target) {
      addProduct(target);
      setQuery('');
      setSearchOpen(false);
      setSearchIndex(-1);
    } else {
      setQuery(String(code));
      setSearchOpen(true);
      flash(LANG === 'ur' ? `${code} نہیں ملی۔` : `${code} not found.`);
    }
  }

  function onScanCode(code) {
    setCameraOpen(false);
    addFromCode(code);
  }

  async function saveDraft() {
    if (!cart.length || cart.some(item => !(Number(item.qty) > 0))) {
      flash(t('saveDraftFirst'));
      return;
    }
    try {
      const response = await client.post('/api/drafts', {
        ...(draftId ? { id: draftId } : {}),
        clientId: `client_${Date.now()}`,
        customerId,
        paymentType,
        discount: discountNum,
        additionalDiscount: addDiscNum,
        receivedAmount: receivedNum,
        reference,
        delivery: sanitizedDelivery(),
        items: cart
      });
      const saved = response.draft || response;
      setDraftId(saved.id);
      flash(t('draftSavedMsg'));
      await refresh();
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }

  async function deleteDraft(draft) {
    const ok = await askConfirm(LANG === 'ur' ? `یہ ڈرافٹ ڈیلیٹ کریں؟` : t('deleteDraftConfirm'));
    if (!ok) return;
    try {
      await client.del(`/api/drafts/${draft.id}`);
      if (draftId === draft.id) setDraftId(null);
      await refresh();
      flash(t('draftDeletedMsg'));
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }

  function loadDraft(draft) {
    setDraftId(draft.id);
    setCart((draft.items || []).map(item => ({ productId: item.productId || null, name: item.name, sku: item.sku || '', unit: item.unit || 'pcs', price: Number(item.price) || 0, qty: Number(item.qty) || 1, manual: !!item.manual, mode: 'qty' })));
    if (draft.customerId) {
      setCustomerId(draft.customerId);
      setCustomerSearch((data.customers.find(c => c.id === draft.customerId) || {}).name || '');
    }
    setPaymentType(draft.paymentType === 'Credit' || draft.paymentType === 'Partial' ? (draft.paymentType === 'Partial' ? 'Partial' : 'Credit') : (draft.paymentType === 'Card' ? 'Card' : 'Cash'));
    setDiscount(String(draft.discount || ''));
    setAdditionalDiscount(String(draft.additionalDiscount || ''));
    setReceivedInput(draft.receivedAmount ? String(draft.receivedAmount) : '');
    setReference(draft.reference || '');
    setDelivery(Object.assign(EMPTY_DELIVERY(), draft.delivery || {}));
    setDraftsModal(false);
    flash(t('draftLoadedMsg'));
  }

  function setDeliveryField(key, value) {
    setDelivery(d => ({ ...d, [key]: value }));
  }

  function clearDelivery() {
    setDelivery(EMPTY_DELIVERY());
    flash(LANG === 'ur' ? 'ڈیلیوری تفصیل صاف کر دی گئی۔' : 'Delivery details cleared.');
  }

  function currentBillPreview() {
    return {
      invoiceNo: draftId ? `${t('draftsLabel')} #${draftId}` : t('pendingInvoice'),
      at: Date.now(),
      createdAt: new Date().toISOString(),
      customerName: (selectedCustomer && selectedCustomer.name) || '',
      items: cart.map(item => ({ name: item.name, qty: item.qty, unit: item.unit, price: item.price })),
      subtotal: Math.round(subtotal),
      discount: combinedD,
      total,
      amount: total,
      paidAmount: paidNow,
      paidAtBilling: paidNow,
      // So a pending bill can still show previous balance -> new balance when it is shared.
      previousBalance: Number((selectedCustomer && selectedCustomer.balance) || 0)
    };
  }

  useEffect(() => {
    syncQueuedSales();
    const timer = setInterval(syncQueuedSales, 15000);
    return () => clearInterval(timer);
  }, [client]);

  useEffect(() => {
    if (!cart.length) return;
    const scroller = billRef.current ? billRef.current.querySelector('.bill-scroller') : null;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [cart.length]);

  useEffect(() => {
    let buffer = '';
    let bufferTimer = null;
    function handleKey(e) {
      if (e.key === 'F2') {
        e.preventDefault();
        if (cart.length && !receipt && !cameraOpen && !draftsModal) chargeRef.current();
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        if (searchRef.current) searchRef.current.focus();
        return;
      }
      const active = document.activeElement;
      if (active && active.tagName && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        if (buffer.length >= 4) {
          const code = buffer.toLowerCase();
          buffer = '';
          addFromCode(code);
        }
        return;
      }
      if (e.key.length !== 1) return;
      buffer += String(e.key).toLowerCase();
      if (bufferTimer) clearTimeout(bufferTimer);
      bufferTimer = setTimeout(() => { buffer = ''; }, 120);
    }
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); if (bufferTimer) clearTimeout(bufferTimer); };
  }, [cart, receipt, cameraOpen, draftsModal, barcodeMap, client]);

  function handleSearchKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!shown.length) return;
      setSearchIndex(i => (i + 1) % shown.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      setSearchIndex(i => (i - 1 + shown.length) % shown.length);
    } else if (e.key === 'Enter') {
      if (searchOpen && shown.length && searchIndex >= 0 && searchIndex < shown.length) {
        e.preventDefault();
        addFromSearch(shown[searchIndex]);
      }
      setSearchOpen(false);
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
    }
  }

  function handleCustomerKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!customers.length) return;
      setCustomerIdx(i => (i + 1) % customers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!customers.length) return;
      setCustomerIdx(i => (i - 1 + customers.length) % customers.length);
    } else if (e.key === 'Enter') {
      if (customerOpen && customerIdx >= 0 && customers[customerIdx]) {
        e.preventDefault();
        selectCustomer(customers[customerIdx]);
      } else if (customerOpen && canAddTypedCustomer) {
        // Enter on a name nobody matches means "create this customer", which is what the cashier
        // typing a new name into the box intends.
        e.preventDefault();
        setNewCustomerOpen(true);
        setCustomerOpen(false);
      }
    } else if (e.key === 'Escape') {
      setCustomerOpen(false);
    }
  }

  function renderBillRow(item, index) {
    const product = item.productId ? activeProducts.find(p => p.id === item.productId) : null;
    const priceNum = Number(item.price) || 0;
    const amt = item.mode === 'amt' ? (Number(item.amount) || 0) : round3(priceNum * (Number(item.qty) || 0));
    const low = product && Number(item.qty) > Number(product.stock || 0);
    const step = isWeightUnit(item.unit) ? 0.25 : 1;
    const selected = focusIndex === index;
    return h('div', {
      className: 'bill-row' + (low ? ' low-stock' : '') + (selected ? ' hover' : ''),
      key: `${item.productId || item.name}-${index}`,
      onMouseEnter: () => setFocusIndex(index),
      onMouseLeave: () => setFocusIndex(current => (current === index ? -1 : current))
    },
      h('div', { className: 'bill-product' },
        h('strong', null, item.name),
        item.sku ? h('small', null, item.sku) : null,
        low && h('span', { className: 'low-badge' }, t('lowBadge'))),
      h('div', { className: 'bill-qty' },
        h('button', { className: 'step-btn', title: t('removeLabel'), onClick: () => changeQty(index, -step) }, '−'),
        item.mode === 'qty'
          ? h('input', { type: 'number', min: '0', step: isWeightUnit(item.unit) ? '0.25' : '1', value: item.qty, title: t('quantityWord'), onChange: e => setLineQty(index, e.target.value) })
          : h('input', { type: 'number', min: '0', step: 'any', value: Number(item.amount) || 0, title: t('amountWord'), onChange: e => setLineAmount(index, e.target.value) }),
        h('button', { className: 'step-btn', title: t('addLabel'), onClick: () => changeQty(index, step) }, '+'),
        h('button', { className: 'mode-btn', title: item.mode === 'qty' ? t('amountWord') : t('quantityWord') + ' mode', onClick: () => toggleLineMode(index) }, item.mode === 'qty' ? 'Qty' : 'Rs')),
      h('div', { className: 'bill-uom' },
        h('select', { className: 'bill-uom-select', value: item.unit || 'pcs', title: t('unitLabelWord'), onChange: e => setLineUnit(index, e.target.value) },
          !UNITS.some(unit => unit.value === item.unit) && item.unit
            ? h('option', { key: 'custom', value: item.unit }, item.unit)
            : null,
          // Only units of the same kind as the product's own unit, so the rate and stock stay honest.
          unitsForBase(item.productUnit).map(unit => h('option', { key: unit.value, value: unit.value }, LANG === 'ur' ? unit.urdu : unit.en)))),
      h('div', { className: 'bill-rate' },
        h('input', { className: 'bill-rate-input', type: 'number', min: '0', step: 'any', value: priceNum, title: t('rateLabel'), onChange: e => setLinePrice(index, e.target.value) })),
      h('span', { className: 'bill-total' }, money(amt)),
      h('button', { className: 'bill-remove', title: t('removeLabel'), 'aria-label': t('removeLabel'), onClick: () => removeLine(index) }, '×'));
  }

  function renderCustomerPanel() {
    return h('div', null,
      h('div', { className: 'checkout-title' }, h('h3', null, t('customerLabelShort'))),
      h('div', { className: 'customer-combobox' },
        h('input', { ref: customerInputRef, value: customerSearch, onFocus: () => setCustomerOpen(Boolean(customerSearch.trim())), onChange: e => { setCustomerSearch(e.target.value); setCustomerOpen(true); setCustomerIdx(-1); setCustomerHover(-1); }, onKeyDown: handleCustomerKey, placeholder: t('selectCustomerPh'), autoComplete: 'off' }),
        customerOpen && h('div', { className: 'search-dropdown customer-dropdown', onMouseLeave: () => setCustomerHover(-1) },
          h('button', { className: 'search-item walkin-item', onClick: () => selectCustomer({ id: 'cus_walkin', name: t('walkInCustomer') }) },
            h('span', { className: 'search-item-name' }, t('walkInCustomer'))),
          customers.map((customer, index) => h('button', { key: customer.id, className: 'search-item' + (index === customerIdx ? ' active' : '') + (index === customerHover ? ' hover' : ''), onMouseEnter: () => setCustomerHover(index), onClick: () => selectCustomer(customer) },
            h('span', { className: 'search-item-name' }, customer.name),
            h('span', { className: 'search-item-meta' }, customer.phone || ''),
            Number(customer.balance) > 0 ? h('span', { className: 'search-item-price' }, `${t('udharBadge')} ${money(customer.balance)}`) : null)),
          // A customer the shop has never served before is the normal case at the counter, so it is
          // one tap away instead of a trip to the customers page mid-bill.
          canAddTypedCustomer && h('button', {
            className: 'search-item add-customer-item',
            onClick: () => { setNewCustomerOpen(true); setCustomerOpen(false); }
          },
            h('span', { className: 'search-item-name' }, `+ ${t('addNewCustomer')} "${typedName}"`),
            h('span', { className: 'search-item-meta' }, t('addCustomerHelp'))))),
      customerId !== 'cus_walkin' && selectedCustomer && h('div', { className: 'customer-balance' },
        h('span', null, t('balanceForCustomer')),
        h('strong', { style: Number(selectedCustomer.balance) > 0 ? { color: '#c0392b' } : { color: '#267152' } }, money(selectedCustomer.balance)),
        h('button', { className: 'secondary small khata-btn pos-khata-btn', title: t('openKhataHelp'), onClick: () => setKhataOpen(true) }, t('openKhata')),
        (() => {
          if (!selectedCustomer.phone) return h('span', { className: 'wa-na small' }, t('noWhatsapp'));
          if (!billForShare) return null;
          return h('button', { className: 'secondary small wa-btn pos-khata-wa', title: t('whatsappSendHelp'), onClick: () => shareBillAsImage(billForShare, data.settings, selectedCustomer, setMessage) }, t('whatsappBill'));
        })()));
  }

  function renderCustomerProfile() {
    if (!customerId || customerId === 'cus_walkin' || !selectedCustomer) return null;
    const entries = (profile && profile.entries) || [];
    const sales = entries.filter(entry => entry.type === 'sale');
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const recent = sales.filter(entry => new Date(entry.at) >= sixMonthsAgo);
    const byMonth = {};
    recent.forEach(sale => {
      const key = sale.at.slice(0, 7);
      (byMonth[key] = byMonth[key] || []).push(sale);
    });
    const monthKeys = Object.keys(byMonth).sort().reverse();

    function profileSaleRow(sale) {
      const waBtn = selectedCustomer && selectedCustomer.phone
        ? h('button', { className: 'wa-btn', onClick: () => shareBillAsImage(withPrevBalance(sale), data.settings, selectedCustomer, setMessage) }, t('whatsappBill'))
        : h('span', { className: 'wa-na' }, t('noWhatsapp'));
      return h('div', { className: 'cust-sale', key: sale.id },
        h('div', { className: 'cust-sale-meta' },
          h('strong', null, sale.invoiceNo),
          h('span', null, new Date(sale.at).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))),
        (sale.items || []).map((item, idx) => h('div', { className: 'cust-item-row', key: idx },
          h('span', { className: 'cust-item-name' }, `${item.name} ×${item.qty}${item.unit ? ' ' + unitLabel(item.unit) : ''}`),
          h('span', { className: 'cust-item-amt' }, money(item.amount || item.price * item.qty)))),
        h('div', { className: 'cust-sale-foot' },
          h('strong', null, `${t('totalWord')}: ${money(sale.amount)}`),
          waBtn));
    }

    function profileMonth(monthKey) {
      return h('div', { className: 'cust-month', key: monthKey },
        h('div', { className: 'cust-month-head' },
          h('strong', null, new Date(monthKey + '-01').toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })),
          h('span', null, `${byMonth[monthKey].length} ${t('billWord')}`)),
        byMonth[monthKey].map(profileSaleRow));
    }

    return h('div', { className: 'cust-profile' },
      h('div', { className: 'cust-profile-head' },
        h('span', { className: 'avatar' }, initialsOf(selectedCustomer.name)),
        h('div', { className: 'cust-profile-id' },
          h('strong', null, selectedCustomer.name),
          h('small', null, `#${selectedCustomer.id}`)),
        h('span', { className: `badge ${Number(selectedCustomer.balance) > 0 ? 'warning' : 'success'}` },
          Number(selectedCustomer.balance) > 0 ? `${t('udharBadge')} ${money(selectedCustomer.balance)}` : t('clearBadge'))),
      monthKeys.length === 0
        ? h('p', { className: 'profile-empty' }, LANG === 'ur' ? 'پچھلے 6 ماہ میں اُدھار نہیں۔' : 'No udhaar in the last 6 months.')
        : h('div', { className: 'cust-months' }, monthKeys.map(profileMonth)));
  }

  function renderPaymentPanel() {
    return h('div', null,
      h('div', { className: 'checkout-title' }, h('h3', null, t('paymentLabel'))),
      h('div', { className: 'pay-options' },
        ['Cash', 'Card', 'Credit', 'Partial'].map(type => h('button', { key: type, className: 'pay-option' + (paymentType === type ? ' active' : ''), onClick: () => { setPaymentType(type); if (type === 'Cash') setReceivedInput(''); } }, paymentMethodLabel(type)))),
      h('div', { className: 'received-row' },
        h('label', null, t('amountReceived')),
        h('input', { type: 'number', min: '0', step: 'any', value: receivedInput, onChange: e => setReceivedInput(e.target.value), placeholder: isCredit ? '0' : String(total) }),
        isCredit && h('button', { className: 'secondary small', onClick: () => setReceivedInput(String(total)) }, t('full')),
        isCredit && h('button', { className: 'secondary small', onClick: () => setReceivedInput('0') }, t('none'))),
      isCredit && dueAmount > 0 && (!selectedCustomer || customerId === 'cus_walkin') && h('div', { className: 'notice danger', style: { margin: '8px 0 0' } }, t('selectCustomerForUdhar')));
  }

  function renderDiscountPanel() {
    return h('div', null,
      h('div', { className: 'checkout-title' }, h('h3', null, t('discountOn'))),
      h('div', { className: 'discount-fields' },
        h('label', null, t('discount')),
        h('input', { type: 'number', min: '0', step: 'any', value: discount, onChange: e => setDiscount(e.target.value) }),
        h('label', null, t('additionalDiscount')),
        h('input', { type: 'number', min: '0', step: 'any', value: additionalDiscount, onChange: e => setAdditionalDiscount(e.target.value) })));
  }

  function renderSummaryPanel() {
    return h('div', null,
      h('div', { className: 'checkout-title' }, h('h3', null, t('grandTotalLabel'))),
      h('div', { className: 'summary-rows' },
        h('div', { className: 'summary-row' }, h('span', null, t('totalQtyLabel')), h('strong', null, totalQty)),
        h('div', { className: 'summary-row' }, h('span', null, t('totalPacksLabel')), h('strong', null, totalPacks ? totalPacks : '—')),
        h('div', { className: 'summary-row' }, h('span', null, t('subtotal')), h('strong', null, money(subtotal))),
        mainD > 0 && h('div', { className: 'summary-row discount' }, h('span', null, t('discountOn')), h('strong', null, '- ' + money(mainD))),
        extraD > 0 && h('div', { className: 'summary-row discount' }, h('span', null, t('additionalDiscount')), h('strong', null, '- ' + money(extraD))),
        h('div', { className: 'summary-row grand' }, h('span', null, t('grandTotalLabel')), h('strong', null, money(total))),
        h('div', { className: 'summary-row' }, h('span', null, t('amountReceived')), h('strong', null, money(paidNow))),
        isCredit && dueAmount > 0
          ? h('div', { className: 'summary-row due' }, h('span', null, t('udharRemaining')), h('strong', null, money(dueAmount)))
          : h('div', { className: 'summary-row change' }, h('span', null, t('changeLabel')), h('strong', null, money(changeAmount)))));
  }

  function confirmNewSale() {
    if (!cart.length) { resetSale(); return; }
    askConfirm(LANG === 'ur' ? 'نئی سیل شروع کریں؟ موجودہ بل صاف ہو جائے گا۔' : t('newSaleConfirm'))
      .then(ok => { if (ok) resetSale(); });
  }

  function confirmCancelSale() {
    if (!cart.length) return;
    askConfirm(LANG === 'ur' ? 'موجودہ بل منسوخ کریں؟ آئٹمز صاف ہو جائیں گے۔' : t('cancelSaleConfirm'))
      .then(ok => { if (ok) resetSale(); });
  }

  const cameraGlyph = h('svg', { className: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('path', { d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }),
    h('circle', { cx: '12', cy: '13', r: '4' }));

  const invoiceHeader = h('section', { className: 'invoice-header' },
    h('div', { className: 'inv-block' }, h('label', null, t('voucherNo')), h('div', { className: 'inv-value voucher-pending' }, t('pendingInvoice'))),
    h('div', { className: 'inv-block inv-customer' }, h('label', null, t('customerLabelShort')), h('div', { className: 'inv-value' }, selectedCustomer ? selectedCustomer.name : t('walkInCustomer'))),
    h('div', { className: 'inv-block' }, h('label', null, t('dateLabel')), h('div', { className: 'inv-value' }, new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }))),
    h('div', { className: 'inv-block' }, h('label', null, t('paymentTerms')),
      h('select', { value: paymentType, onChange: e => { setPaymentType(e.target.value); if (e.target.value === 'Cash') setReceivedInput(''); } },
        ['Cash', 'Card', 'Credit', 'Partial'].map(type => h('option', { key: type, value: type }, paymentMethodLabel(type))))),
    h('div', { className: 'inv-block inv-reference' }, h('label', null, t('referenceLabel')),
      h('input', { value: reference, onChange: e => setReference(e.target.value), placeholder: '#' })));

  const searchSection = h('section', { className: 'search-section pos-panel' },
    h('div', { className: 'search-row' },
        h('label', { className: 'search' },
          h('input', { ref: searchRef, autoFocus: true, value: query, onChange: e => { setQuery(e.target.value); setSearchOpen(true); setSearchIndex(-1); setSearchHover(-1); }, onFocus: () => setSearchOpen(true), onKeyDown: handleSearchKey, placeholder: t('searchPlaceholder'), autoComplete: 'off', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false })),
      h('button', { className: 'secondary icon-btn', title: t('scanCamera'), onClick: () => setCameraOpen(true) }, cameraGlyph),
      h('button', { className: 'secondary' + (manualOpen ? ' active' : ''), onClick: () => setManualOpen(v => !v) }, t('looseItem')),
      h('button', { className: 'secondary', onClick: () => setDraftsModal(true) }, `${t('draftsLabel')} (${(data.drafts || []).length})`)),
    searchOpen && shown.length ? h('div', { className: 'search-dropdown', onMouseLeave: () => setSearchHover(-1) },
      shown.map((product, index) => h('div', { key: product.id, className: 'search-item' + (index === searchIndex ? ' active' : '') + (index === searchHover ? ' hover' : ''), onMouseEnter: () => setSearchHover(index), onClick: () => addFromSearch(product) },
        h('div', { className: 'search-item-top' },
          h('span', { className: 'search-item-name' }, product.name),
          h('span', { className: 'search-item-meta' }, `${product.sku ? product.sku + ' · ' : ''}${product.stock} ${unitLabel(product.unit)}`),
          isWeightUnit(product.unit)
            ? h('span', { className: 'search-item-price' }, `${money(product.price)}/${unitLabel(product.unit)}`)
            : h('span', { className: 'search-item-price' }, money(product.price))),
        h('div', { className: 'search-item-actions' },
          h('span', { className: 'qty-preset-label' }, t('qtyAdd')),
          [isWeightUnit(product.unit) ? 0.5 : 1, isWeightUnit(product.unit) ? 1 : 2, isWeightUnit(product.unit) ? 2 : 5].map(qty =>
            h('button', { key: qty, className: 'qty-preset', onClick: e => { e.stopPropagation(); addProductQty(product, qty); } }, `${qty}${isWeightUnit(product.unit) ? unitLabel(product.unit) : ''}`)),
          h('button', { className: 'qty-preset add-one', onClick: e => { e.stopPropagation(); addFromSearch(product); } }, t('add'))))))
      : searchOpen && q && h('div', { className: 'search-dropdown' }, h('div', { className: 'search-empty' }, t('noMatchingProducts'))),
    manualOpen && h('form', { className: 'manual-form', onSubmit: addManualItem },
      h('input', { value: manual.name, onChange: e => setManual({ ...manual, name: e.target.value }), placeholder: t('productName'), required: true }),
      h('input', { type: 'number', min: '0', step: 'any', value: manual.price, onChange: e => setManual({ ...manual, price: e.target.value }), placeholder: `${t('ratePer')} ${unitLabel(manual.unit)}`, required: true }),
      h('input', { type: 'number', min: '0', step: 'any', value: manual.qty, onChange: e => setManual({ ...manual, qty: e.target.value }), placeholder: t('weightQty'), required: true }),
      h('select', { value: manual.unit, onChange: e => setManual({ ...manual, unit: e.target.value }) }, UNITS.map(unit => h('option', { key: unit.value, value: unit.value }, unit.urdu))),
      h('button', { className: 'primary', type: 'submit' }, t('add'))));

  const billSection = h('section', { className: 'bill-section pos-panel', ref: billRef },
    h('div', { className: 'panel-head bill-head' },
      h('div', null, h('h2', null, t('currentInvoice')), h('p', null, `${cart.length} ${t('itemsShort')}`)),
      h(Badge, { tone: online ? 'success' : 'warning' }, online ? t('synced') : `${loadJson(queueKey, []).length} ${t('queued')}`)),
    cart.length ? h('div', { className: 'bill-scroller' }, h('div', { className: 'bill-grid' },
      h('div', { className: 'bill-grid-head' },
        ...[h('span', { key: 'p' }, t('hProduct')), h('span', { key: 'q' }, t('qtyShort')), h('span', { key: 'u' }, t('unitLabelWord')), h('span', { key: 'r' }, t('rateLabel')), h('span', { key: 't' }, t('totalWord')), h('span', { key: 'x' }, '')]),
      ...cart.map((item, index) => renderBillRow(item, index))))
      : h('div', { className: 'empty bill-empty' }, h('h3', null, t('cartEmpty')), h('p', null, t('scanOrSelect'))));

  const deliverySection = h('section', { className: 'delivery-section pos-panel' },
    h('div', { className: 'panel-head' },
      h('div', null, h('h2', null, t('deliveryInfo')), h('p', null, t('deliveryInfoNote'))),
      hasDelivery && h('button', { className: 'secondary small delivery-clear', onClick: clearDelivery }, t('clearDelivery'))),
    h('div', { className: 'delivery-grid' },
      DELIVERY_FIELDS.map(([key, labelKey]) => h('div', { className: 'delivery-field', key },
        h('label', null, t(labelKey)),
        key === 'deliveryDate'
          ? h('input', { type: 'date', value: delivery[key] || '', onChange: e => setDeliveryField(key, e.target.value) })
          : h('input', { value: delivery[key] || '', onChange: e => setDeliveryField(key, e.target.value) })))));

  // Declared before checkoutSection because renderCustomerPanel() (used inside it) reads these.
  const canShareBill = customerId !== 'cus_walkin' && Boolean(selectedCustomer && selectedCustomer.phone);
  const currentBillForShare = canShareBill && cart.length ? currentBillPreview() : null;

  // When the cart is empty, fall back to the customer's most recent udhar bill so the WhatsApp
  // button stays useful right after selecting a customer from search.
  const lastProfileSale = ((profile && profile.entries) || []).filter(entry => entry.type === 'sale').slice(-1)[0];
  const billForShare = currentBillForShare || (canShareBill && lastProfileSale ? withPrevBalance(lastProfileSale) : null);


  const checkoutSection = h('section', { className: 'checkout-section pos-panel' },
    renderCustomerProfile(),
    h('div', { className: 'checkout-grid' },
      h('article', { className: 'checkout-panel customer-panel' }, renderCustomerPanel()),
      h('article', { className: 'checkout-panel payment-panel' }, renderPaymentPanel()),
      h('article', { className: 'checkout-panel discount-panel' }, renderDiscountPanel()),
      h('article', { className: 'checkout-panel summary-panel' }, renderSummaryPanel())));

  const actionsSection = h('section', { className: 'actions-section' },
    h('div', { className: 'actions-left' },
      h('button', { className: 'primary', onClick: confirmNewSale }, t('newSale')),
      h('button', { className: 'secondary', onClick: () => saveDraft() }, t('saveDraft')),
      billForShare && h('button', { className: 'secondary wa-btn pos-wa-btn', onClick: () => shareBillAsImage(billForShare, data.settings, selectedCustomer, setMessage) }, t('whatsappBill')),
      h('button', { className: 'secondary danger-btn', onClick: confirmCancelSale }, t('cancelSale')),
      go && h('button', { className: 'secondary', onClick: () => go('returns') }, t('revertBill'))),
    h('div', { className: 'actions-right' },
      h('button', { className: 'secondary', disabled: charging, onClick: previewSale }, t('printInvoice')),
      h('button', { className: 'primary', disabled: charging, onClick: () => charge(true) }, t('completeAndPrint')),
      h('button', { className: 'primary', disabled: charging, onClick: () => charge(false) }, t('completeSale'))));

  return h('div', { className: 'pos-page' },
    message && h('div', { className: 'notice pos-notice' }, message),
    h('main', { className: 'pos-layout' },
      invoiceHeader,
      searchSection,
      billSection,
      deliverySection,
      checkoutSection,
      actionsSection),
    receipt && h(ReceiptModal, { sale: receipt, customers: data.customers, settings: data.settings, onClose: () => {
      setReceipt(null);
      if (khataAfterReceipt) {
        setKhataAfterReceipt(false);
        setKhataOpen(true);
      }
    } }),
    cameraOpen && h(ScanCamera, { onCode: onScanCode, onClose: () => setCameraOpen(false) }),
    newCustomerOpen && h(QuickAddCustomerModal, {
      name: typedName,
      client,
      onSaved: async created => {
        setNewCustomerOpen(false);
        await refresh();
        // Straight onto the new customer's khata, so the bill in progress is billed to them and the
        // cashier can carry on counting instead of searching for the name again.
        selectCustomer(created);
      },
      onClose: () => setNewCustomerOpen(false)
    }),
    khataOpen && selectedCustomer && h(KhataModal, { customer: profile && profile.customer && profile.customer.id === selectedCustomer.id && Object.keys(profile.customer).length > 1 ? { ...selectedCustomer, ...profile.customer } : selectedCustomer, client, settings: data.settings, user: data.user, refresh, onClose: () => setKhataOpen(false) }),
    draftsModal && h(DraftsModal, { drafts: data.drafts || [], customers: data.customers, onLoad: loadDraft, onDelete: deleteDraft, onClose: () => setDraftsModal(false) }));
}

function ReceiptModal({ sale, customers, settings, onClose }) {
  const customer = customers.find(item => item.id === sale.customerId);
  const [shareNote, setShareNote] = useState('');
  const saleDate = new Date(sale.createdAt);
  const dateStr = saleDate.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = saleDate.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  const storeName = (settings && settings.storeName) || 'Faislabadi General Store';
  const storePhone = (settings && settings.phone) || '';
  const storeAddress = (settings && settings.address) || '';
  const printerCfg = loadJson(printerConfigKey, { autoPrint: false, paperSize: '80' });
  const paperClass = 'paper-' + printerCfg.paperSize;
  const isCredit = sale.paymentType === 'Credit';
  const isPartial = isCredit && Number(sale.paidAmount) > 0 && Number(sale.paidAmount) < Number(sale.total);
  const methodLabel = isPartial ? t('partialPayment') : (isCredit ? t('udhaarPayment') : (sale.paymentType === 'Card' ? t('card') : t('cash')));
  const due = Math.max(0, Number(sale.total) - Number(sale.paidAmount));
  const handed = Math.max(Number(sale.paidAmount), Number(sale.receivedAmount) || 0);
  const change = !isCredit ? Math.max(0, handed - Number(sale.total)) : 0;
  const delivery = sale.delivery && typeof sale.delivery === 'object' ? sale.delivery : null;
  // Prefer the balance snapshotted at billing time: the in-memory customer list is still the
  // pre-sale copy for a moment after saving, so using it would print a stale total.
  const baseBalance = Number.isFinite(Number(sale.previousBalance))
    ? Number(sale.previousBalance)
    : (Number(customer && customer.balance) || 0);
  const closingBalance = due > 0 ? money(baseBalance + (sale.preview ? due : 0)) : null;
    useEffect(() => {
      function handlePrintKey(e) { if (e.key === 'F4') { e.preventDefault(); window.print(); } }
      window.addEventListener('keydown', handlePrintKey);
      return () => window.removeEventListener('keydown', handlePrintKey);
    }, []);
    // The bill goes as a picture of the printed receipt, not as text.
    const onWhatsapp = () => shareBillAsImage(sale, settings, customer, setShareNote);
  return ReactDOM.createPortal(h('div', { className: 'modal receipt-modal', onClick: onClose },
    h('section', { className: 'receipt ' + paperClass, onClick: function(e) { e.stopPropagation(); } },
      sale.preview && h('div', { className: 'receipt-banner no-print' }, t('notSavedPreview')),
      h('div', { className: 'receipt-header' },
        h('div', { className: 'receipt-brand' }, h('img', { className: 'receipt-logo', src: 'logo.png?v=27', alt: '' })),
        h('h2', null, storeName),
        storeAddress && h('p', { className: 'receipt-info' }, storeAddress),
        storePhone && h('p', { className: 'receipt-info' }, storePhone)),
      h('div', { className: 'receipt-divider' }),
      h('div', { className: 'receipt-meta' },
        h('div', { className: 'receipt-row' }, h('span', null, t('invoiceWord')), h('span', null, sale.invoiceNo || t('pendingInvoice'))),
        h('div', { className: 'receipt-row' }, h('span', null, t('dateLabel')), h('span', null, dateStr)),
        h('div', { className: 'receipt-row' }, h('span', null, t('hPaymentTime')), h('span', null, timeStr)),
        h('div', { className: 'receipt-row' }, h('span', null, t('cashierLabel')), h('span', null, sale.createdBy || '-')),
        h('div', { className: 'receipt-row' }, h('span', null, t('customerLabel')), h('span', null, (customer && customer.name) || t('walkIn'))),
        h('div', { className: 'receipt-row' }, h('span', null, t('paymentLabel')), h('span', null, methodLabel)),
        sale.reference && h('div', { className: 'receipt-row' }, h('span', null, t('referenceLabel')), h('span', null, sale.reference)),
        sale.offlineDraft && h('div', { className: 'receipt-row receipt-status' }, h('span', null, 'Status'), h('span', null, 'OFFLINE - WILL SYNC'))),
      h('div', { className: 'receipt-divider' }),
      h('div', { className: 'receipt-items-header' },
        h('span', { className: 'ri-name' }, t('hProduct')),
        h('span', { className: 'ri-qty' }, t('qtyShort')),
        h('span', { className: 'ri-price' }, t('rateLabel')),
        h('span', { className: 'ri-total' }, t('totalWord'))),
      h('div', { className: 'receipt-items' },
        sale.items.map(function(item) {
          return h('div', { className: 'receipt-item', key: item.name + '-' + item.qty },
            h('span', { className: 'ri-name' }, item.name),
            h('span', { className: 'ri-qty' }, `${item.qty} ${unitLabel(item.unit)}`),
            h('span', { className: 'ri-price' }, moneyRate(item.price)),
            h('span', { className: 'ri-total' }, moneyRate(item.price * item.qty)));
        })),
      h('div', { className: 'receipt-divider' }),
      h('div', { className: 'receipt-totals' },
        h('div', { className: 'receipt-row' }, h('span', null, t('subtotal')), h('span', null, money(sale.subtotal))),
        Number(sale.discount) > 0 && h('div', { className: 'receipt-row receipt-discount' }, h('span', null, t('discount')), h('span', null, '- ' + money(sale.discount))),
        Number(sale.additionalDiscount) > 0 && h('div', { className: 'receipt-row receipt-discount' }, h('span', null, t('additionalDiscount')), h('span', null, '- ' + money(sale.additionalDiscount))),
        Number(sale.tax) > 0 && h('div', { className: 'receipt-row' }, h('span', null, t('taxWord') + ' (' + (settings && settings.taxRate ? (settings.taxRate * 100).toFixed(0) : '18') + '%)'), h('span', null, money(sale.tax))),
        h('div', { className: 'receipt-row receipt-grand' }, h('span', null, t('grandTotalLabel')), h('span', null, money(sale.total))),
        handed > 0 && h('div', { className: 'receipt-row' }, h('span', null, t('amountReceived')), h('span', null, money(handed))),
        change > 0 && h('div', { className: 'receipt-row receipt-change' }, h('span', null, t('changeLabel')), h('span', null, money(change))),
        due > 0 && h('div', { className: 'receipt-row receipt-due' }, h('span', null, t('udharRemaining')), h('span', null, money(due))),
        closingBalance && h('div', { className: 'receipt-row' }, h('span', null, t('balanceForCustomer')), h('span', null, closingBalance))),
      delivery && h('div', { className: 'receipt-delivery' },
        h('div', { className: 'receipt-row receipt-delivery-head' }, h('span', null, t('deliveryInfo')), h('span', null, '')),
        DELIVERY_FIELDS.filter(([key]) => delivery[key]).map(function([key, labelKey]) {
          return h('div', { className: 'receipt-row', key: key }, h('span', null, t(labelKey)), h('span', null, delivery[key]));
        })),
      h('div', { className: 'receipt-divider' }),
      h('div', { className: 'receipt-paytype' },
        h('span', { className: 'receipt-badge ' + (isCredit ? 'badge-credit' : 'badge-cash') }, methodLabel)),
      h('div', { className: 'receipt-footer' },
        h('p', null, 'Thank you for shopping with us!'),
        h('p', { className: 'receipt-info' }, 'Goods once sold will not be exchanged or returned')),
      h('div', { className: 'receipt-credit' },
        h('p', { className: 'credit-title' }, 'Designed and Developed By'),
        h('p', { className: 'credit-name' }, 'Sohaib Ali'),
        h('p', { className: 'credit-phone' }, 'Mobile No: 03074224449')),
      h('div', { className: 'success-actions no-print' },
        customer && customer.phone
          ? h('button', { className: 'wa-btn', onClick: onWhatsapp }, t('whatsappBill'))
          : null,
        h('button', { className: 'secondary', onClick: function() { window.print(); } }, 'Print (F4)'),
        h('button', { className: 'primary', onClick: onClose }, t('close'))),
      shareNote && h('div', { className: 'receipt-share-note no-print' }, shareNote))),
    document.body);
}

function DataPage({ page, data, client, refresh }) {
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({});
  const [khata, setKhata] = useState(null);
  const [search, setSearch] = useState('');
  const [editCustomer, setEditCustomer] = useState(null);
  const [editProduct, setEditProduct] = useState(null);
  // Balances and stock shown here also come from the server, so reload when the list is opened rather
  // than relying on whatever was last pulled.
  useEffect(() => {
    if (refresh) refresh();
  }, [page]);
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
  if (page === 'reports') return h(Reports, { data, client, refresh });
  if (page === 'purchases') return h(Purchases, { data, client, refresh });
  if (page === 'users') return h(UsersAdmin, { client });
  if (page === 'returns') return h(ReturnsPage, { data, client, refresh });
  if (page === 'settings') return h(Settings, { data, client });

  function customerRow(row) {
    const canManageUdhar = data.user.role === 'Admin' || data.user.role === 'Manager';
    return h('tr', { key: row.id },
      h('td', null, h('strong', null, row.name), h('div', { className: 'row-id' }, `#${row.id}`)),
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
        canManageUdhar && Number(row.balance) > 0 && h('button', { className: 'secondary khata-btn danger-btn small', onClick: () => confirmClearUdhar(row) }, t('clearShort')),
        h('button', { className: 'secondary khata-btn danger-btn small', onClick: () => confirmDeleteCustomer(row) }, t('delete'))));
  }
  async function confirmDeleteCustomer(row) {
    const ok = await askConfirm(LANG === 'ur'
      ? `"${row.name}" کو ڈیلیٹ کریں؟`
      : `Delete customer "${row.name}"?`,
      LANG === 'ur'
      ? `یہ گاہک حذف ہو جائے گا۔ اگر اس کی بِلنگ یا اُدھار تاریخ ہے تو حذف نہیں ہو گا۔`
      : `This customer will be deleted. If the customer has billing or udhaar history, deletion is blocked to keep old bills correct.`);
    if (!ok) return;
    try {
      await client.del(`/api/customers/${row.id}`);
      setMessage(LANG === 'ur' ? `"${row.name}" ڈیلیٹ ہو گیا۔` : `"${row.name}" deleted.`);
      await refresh();
    } catch (err) {
      const msg = String((err && err.error) || (err && err.message) || '');
      if (/CUSTOMER_IN_USE/i.test(msg) || /billing or udhaar history/i.test(msg)) {
        setMessage(LANG === 'ur'
          ? `"${row.name}" کی بِلنگ/اُدھار تاریخ ہے، اس لیے ڈیلیٹ نہیں ہو سکتا۔ پرانے بل محفوظ رکھنے کے لیے رکھا جاتا ہے۔`
          : `"${row.name}" has billing/udhaar history and cannot be deleted. It is kept so old bills stay correct.`);
      } else {
        setMessage(friendlyError(err));
      }
    }
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
    khata && h(KhataModal, { customer: khata, client, settings: data.settings, user: data.user, onClose: () => setKhata(null), refresh }),
    editCustomer && h(CustomerEditModal, { customer: editCustomer, client, refresh, products: data.products || [], canEditUdhar: data.user.role === 'Admin' || data.user.role === 'Manager', onClose: () => setEditCustomer(null) }),
    editProduct && h(ProductEditModal, { product: editProduct, client, refresh, onClose: () => setEditProduct(null) }));
}

function WarehousePage({ data, client, refresh }) {
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({});
  const [search, setSearch] = useState('');
  const [transferModal, setTransferModal] = useState(null);
  const [linkModal, setLinkModal] = useState(null);
  const [linkQuery, setLinkQuery] = useState('');
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

  function packOptions(item) {
    const opts = [];
    if (Number(item.kgPerBoree) > 0) opts.push({ value: 'boree', factor: Number(item.kgPerBoree), label: `${t('whBores')} (1 = ${item.kgPerBoree} kg)` });
    if (Number(item.pcsPerCarton) > 0) opts.push({ value: 'carton', factor: Number(item.pcsPerCarton), label: `Carton (1 = ${item.pcsPerCarton} pcs)` });
    return opts;
  }

  function packPreview() {
    if (!transferModal) return '';
    const opt = packOptions(transferModal.item).find(o => o.value === (transferModal.convert || 'none'));
    if (!opt) return t('packSpec') + ': ' + t('whNoLink');
    const qty = Number(transferModal.qty) || 0;
    const converted = Math.round(qty * opt.factor * 1000) / 1000;
    return `${qty} ${opt.value === 'boree' ? t('whBores') : 'carton'} x ${opt.factor} = ${converted}`;
  }

  async function doTransfer(direction) {
    if (!transferModal) return;
    const qty = Number(transferModal.qty);
    if (!qty || qty <= 0) { setMessage(LANG === 'ur' ? 'درست تعداد لکھیں۔' : 'Enter a valid quantity.'); return; }
    setMessage('');
    // Packs are counted on the warehouse side, so conversion only applies to toProduct.
    const convert = direction === 'toProduct' ? (transferModal.convert || 'none') : 'none';
    try {
      await client.post('/api/warehouses/transfer', { warehouseId: transferModal.item.id, productId: transferModal.productId, qty, direction, convert });
      setTransferModal(null);
      await refresh();
      setMessage(t('transferDone'));
    } catch (err) { setMessage(friendlyError(err)); }
  }

  function linkProduct(whItem) {
    setLinkQuery('');
    setLinkModal(whItem);
  }

  async function doLinkProduct(product) {
    const whItem = linkModal;
    if (!whItem || !product) return;
    setLinkModal(null);
    try {
      await client.put(`/api/warehouses/${whItem.id}`, { linkedProductId: product.id });
      await refresh();
      setMessage(LANG === 'ur' ? `لنک ہو گیا: ${product.name}` : `Linked: ${product.name}`);
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
        h('td', null, item.stock + ' ' + unitLabel(item.unit), isLow ? h('span', null, ' ', h(Badge, { tone: 'danger' }, t('lowBadge'))) : null,
          stockPackLabel(item).length ? h('small', { style: { display: 'block', color: '#315f95' } }, stockPackLabel(item).join(' · ')) : null),
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
        h('div', { style: { marginBottom: '12px' } },
          h('label', { style: { display: 'block', marginBottom: '4px', fontWeight: 600 } }, t('phTransferQty')),
          h('input', { type: 'number', min: '1', step: 'any', style: { width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #ddd' }, value: transferModal.qty, onChange: function(e) { setTransferModal(Object.assign({}, transferModal, { qty: e.target.value })); }, placeholder: (LANG === 'ur' ? 'گودام میں موجود' : 'In warehouse') + ': ' + transferModal.item.stock }),
          h('select', { style: { width: '100%', marginTop: '8px', padding: '8px', borderRadius: '8px', border: '1px solid #ddd' }, value: transferModal.convert || 'none', onChange: function(e) { setTransferModal(Object.assign({}, transferModal, { convert: e.target.value })); } },
            h('option', { value: 'none' }, unitLabel(transferModal.item.unit)),
            packOptions(transferModal.item).map(function(opt) { return h('option', { key: opt.value, value: opt.value }, opt.label); })),
          h('small', { style: { display: 'block', marginTop: '6px', color: '#66736f' } }, packPreview())),
        h('div', { style: { display: 'flex', gap: '10px' } },
          h('button', { className: 'primary', disabled: !transferModal.productId, onClick: function() { doTransfer('toProduct'); } }, t('whTransferToProduct')),
          h('button', { className: 'primary', disabled: !transferModal.productId, onClick: function() { doTransfer('toWarehouse'); } }, t('whTransferToWarehouse')),
          h('button', { className: 'secondary', onClick: function() { setTransferModal(null); } }, t('close')))));
  }

  function renderLinkModal() {
    if (!linkModal) return null;
    const q = linkQuery.trim().toLowerCase();
    const matches = products
      .filter(function(p) { return p.active !== false; })
      .filter(function(p) {
        if (!q) return true;
        return `${p.name || ''} ${p.sku || ''} ${p.barcode || ''} ${p.category || ''}`.toLowerCase().includes(q);
      })
      .slice(0, 60);
    return h('div', {
      style: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      onClick: function(e) { if (e.target.style.background) setLinkModal(null); }
    },
      h('div', { style: { background: '#fff', borderRadius: '14px', padding: '24px', maxWidth: '460px', width: '92%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }, onClick: function(e) { e.stopPropagation(); } },
        h('h3', { style: { margin: '0 0 4px' } }, t('linkProduct')),
        h('small', { style: { display: 'block', marginBottom: '12px', color: '#66736f' } }, linkModal.name),
        h('input', {
          autoFocus: true, value: linkQuery, placeholder: t('searchProductsToLink'),
          onChange: function(e) { setLinkQuery(e.target.value); },
          style: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '12px' }
        }),
        h('div', { style: { overflowY: 'auto', flex: '1 1 auto', minHeight: '120px' } },
          matches.length === 0
            ? h('p', { className: 'empty-copy' }, t('noProductFound'))
            : h('div', null, matches.map(function(p) {
                return h('button', {
                  key: p.id, className: 'search-item', style: { width: '100%', textAlign: 'left' },
                  onClick: function() { doLinkProduct(p); }
                },
                  h('span', { className: 'search-item-name' }, p.name),
                  h('span', { className: 'search-item-meta' }, p.sku || p.category || ''),
                  h('span', { className: 'search-item-price' }, money(p.price || 0)));
              }))),
        h('div', { style: { display: 'flex', gap: '10px', marginTop: '16px' } },
          h('button', { className: 'secondary', onClick: function() { setLinkModal(null); } }, t('close')))));
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
      h('input', { key: 'kgPerBoree', type: 'number', min: '0', step: 'any', placeholder: t('kgPerBoreePh'), value: form.kgPerBoree || '', onChange: e => setForm({ ...form, kgPerBoree: e.target.value }) }),
      h('input', { key: 'pcsPerCarton', type: 'number', min: '0', step: 'any', placeholder: t('pcsPerCartonPh'), value: form.pcsPerCarton || '', onChange: e => setForm({ ...form, pcsPerCarton: e.target.value }) }),
      h('button', { key: 'save', className: 'primary' }, t('whAddItem'))),
    h('div', { style: { margin: '12px 0' } },
      h('input', { type: 'search', placeholder: t('searchPlaceholder'), value: search, onChange: e => setSearch(e.target.value), style: { width: '100%', maxWidth: '400px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '8px' } })),
    renderTable(),
    renderTransferModal(),
    renderLinkModal(),
    editWh && h(WarehouseEditModal, { item: editWh, client, refresh, onClose: () => setEditWh(null) }));
}

function KhataModal({ customer, client, settings, user, onClose, refresh }) {
  const [entries, setEntries] = useState(null);
  const [balanceAfter, setBalanceAfter] = useState({});
  const [monthFilter, setMonthFilter] = useState('all');
  const [summary, setSummary] = useState({ creditPurchases: customer.creditPurchases || 0, totalPaid: customer.totalPaid || 0 });
  const [balance, setBalance] = useState(customer.balance);
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(toDateInputValue(new Date().toISOString()));
  const [payTime, setPayTime] = useState(toTimeInputValue(new Date().toISOString()));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [udharOpen, setUdharOpen] = useState(false);
  const [udharForm, setUdharForm] = useState({ amount: '', note: '', reference: '' });
  const [udharDate, setUdharDate] = useState(toDateInputValue(new Date().toISOString()));
  const [udharTime, setUdharTime] = useState(toTimeInputValue(new Date().toISOString()));
  // The server only lets Admin/Manager record or clear udhar, so do not show controls that will 403.
  const canManageUdhar = !user || user.role === 'Admin' || user.role === 'Manager';
  async function loadLedger() {
    try {
      const payload = await client.get(`/api/customers/${customer.id}/ledger`);
      setEntries(payload.entries);
      setBalanceAfter(payload.balanceAfter || {});
      setBalance(payload.customer.balance);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }
  useEffect(() => { loadLedger(); }, [client, customer.id]);
  async function receivePayment(event) {
    if (event) event.preventDefault();
    setMessage('');
    if (!(Number(amount) > 0)) {
      setMessage(LANG === 'ur' ? 'پہلے رقم لکھیں، یا "پورا اُدھار" دبائیں۔' : 'Enter an amount first, or tap "Pay full amount".');
      return;
    }
    if (Number(amount) > Number(balance)) {
      setMessage(LANG === 'ur' ? `رقم اُدھار کے بقایا (${money(balance)}) سے زیادہ ہے۔` : `Amount is more than the udhar balance (${money(balance)}).`);
      return;
    }
    setBusy(true);
    // Built before the request so the same body can be queued if there is no network.
    const payload = { amount: Number(amount) };
    if (payDate || payTime) {
      payload.atDate = payDate;
      payload.atTime = payTime;
    }
    try {
      const result = await client.post(`/api/customers/${customer.id}/payments`, payload);
      setBalance(result.balance);
      setAmount('');
      setMessage(LANG === 'ur' ? `${money(result.payment.amount)} وصول ہوئے۔ بقایا اُدھار: ${money(result.balance)}۔` : `Payment of ${money(result.payment.amount)} received. Remaining udhar: ${money(result.balance)}.`);
      await loadLedger();
      await loadSummary();
      refresh();
    } catch (err) {
      if (isNetworkFailure(err)) {
        // Received offline: take it off the balance on screen so the counter stays correct, and hold
        // the entry until the server can be reached. The same clientId goes out on every retry, so
        // the server cannot credit it twice.
        queueAction('payment', { customerId: customer.id, ...payload });
        setBalance(Math.max(0, round3((Number(balance) || 0) - Number(amount))));
        setAmount('');
        setMessage(offlineSavedMessage(Number(amount), 'payment'));
      } else {
        setMessage(friendlyError(err));
      }
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
  async function addUdhar(event) {
    if (event) event.preventDefault();
    setMessage('');
    if (!(Number(udharForm.amount) > 0)) {
      setMessage(LANG === 'ur' ? 'پہلے رقم درج کریں۔' : 'Enter the udhar amount first.');
      return;
    }
    setBusy(true);
    try {
      const payload = { amount: Number(udharForm.amount), note: udharForm.note.trim(), reference: udharForm.reference.trim() };
      if (udharDate || udharTime) {
        payload.atDate = udharDate;
        payload.atTime = udharTime;
      }
      const result = await client.post(`/api/customers/${customer.id}/udhar`, payload);
      setBalance(result.balance);
      setUdharForm({ amount: '', note: '', reference: '' });
      setUdharDate(toDateInputValue(new Date().toISOString()));
      setUdharTime(toTimeInputValue(new Date().toISOString()));
      setUdharOpen(false);
      setMessage(LANG === 'ur'
        ? `${money(result.entry.amount)} نیا اُدھار درج ہو گیا۔ کل بیلنس: ${money(result.balance)}۔`
        : `New udhar of ${money(result.entry.amount)} recorded. New balance: ${money(result.balance)}.`);
      await loadLedger();
      await loadSummary();
      refresh();
    } catch (err) {
      if (isNetworkFailure(err)) {
        // No internet: keep the entry on this device and show the new balance here, so the cashier
        // can carry on. It is sent to the server on its own once the network is back.
        queueAction('udhar', { customerId: customer.id, amount: Number(udharForm.amount), note: udharForm.note.trim(), reference: udharForm.reference.trim(), atDate: udharDate, atTime: udharTime });
        setBalance(Math.max(0, round3((Number(balance) || 0) + Number(udharForm.amount))));
        setUdharForm({ amount: '', note: '', reference: '' });
        setUdharOpen(false);
        setMessage(offlineSavedMessage(Number(udharForm.amount), 'udhar'));
      } else {
        setMessage(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
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
  const monthKeys = list => {
    const keys = {};
    (list || []).forEach(entry => { const k = (entry.at || '').slice(0, 7); if (k) keys[k] = true; });
    const all = Object.keys(keys).sort();
    const nowK = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const bound = new Date();
    bound.setMonth(bound.getMonth() - 12);
    const boundK = `${bound.getFullYear()}-${String(bound.getMonth() + 1).padStart(2, '0')}`;
    const recent = all.filter(k => k <= nowK && k > boundK);
    return (recent.length ? recent : all).slice(-12).reverse();
  };
  async function reverseEntry(entry) {
    // Only real sales and payments can be voided; a hand-typed udhar stays as history, so no button.
    if (entry.type === 'udhar') return;
    const isSale = entry.type === 'sale';
    const verb = isSale ? t('reverseBill') : t('reversePayment');
    const detail = isSale
      ? LANG === 'ur' ? 'یہ گاڑی/بل واپس لوٹائی جائے گی، اسٹاک میں شامل ہوگا اور اُدھار بیلنس کم ہو جائے گا۔' : 'This bill will be voided, stock restored and the udhaar balance reduced.'
      : LANG === 'ur' ? 'یہ وصولی کالعدم ہو گی اور رقم اُدھار بیلنس میں دوبارہ شامل ہو جائے گی۔' : 'This payment will be cancelled and the amount added back to the udhaar balance.';
    if (!await askConfirm(`${verb}?`, `${detail}\n\n${LANG === 'ur' ? 'یہ واپس نہیں ہو سکتا۔' : 'This cannot be undone.'}`)) return;
    setBusy(true);
    setMessage('');
    try {
      if (isSale) {
        await client.post(`/api/sales/${entry.id}/void`, {});
      } else {
        await client.post(`/api/payments/${entry.id}/reverse`, {});
      }
      setMessage(LANG === 'ur' ? `${verb} مکمل۔ بیلنس دوبارہ حساب ہو گیا۔` : `${verb} done. Balance recalculated.`);
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
      h('header', { className: 'khata-head profile-head' },
        h('div', { className: 'profile-top' },
          h('span', { className: 'avatar' }, initialsOf(customer.name)),
          h('div', { className: 'profile-title' },
            h('p', { className: 'eyebrow' }, t('udharKhataEyebrow')),
            h('h2', null, customer.name),
            h('small', { className: 'cust-uid' }, `#${customer.id}`),
            customer.phone && h('p', { className: 'subtitle' }, customer.phone))),
        h('div', { className: 'profile-actions' },
          customer.phone && h('a', { className: 'wa-btn', href: customer.phone ? waLink(customer.phone, khataStatementText(customer, entries, balance, settings)) : null, target: '_blank', rel: 'noreferrer' }, t('whatsappBill')),
          h('span', { className: `badge ${Number(balance) > 0 ? 'warning' : 'success'}` }, Number(balance) > 0 ? `${t('udharBadge')} ${money(balance)}` : t('clearBadge')))),
      h('div', { className: 'profile-details' },
        h('div', null, h('span', null, t('hPhone')), h('b', null, customer.phone || '-')),
        h('div', null, h('span', null, t('hCnic')), h('b', null, customer.cnicMasked || '-')),
        h('div', null, h('span', null, t('phAddressOptional')), h('b', null, customer.address || '-')),
        h('div', null, h('span', null, 'Credit Limit'), h('b', null, money(customer.creditLimit))),
        h('div', { className: 'profile-products' },
          h('span', null, t('productLabel')),
          customerProductsList(customer).length
            ? h('div', { className: 'profile-product-chips' }, customerProductsList(customer).map((prod, index) =>
              h('span', { className: 'product-chip', key: `${prod.id || 'manual'}-${index}` }, `${prod.name}${productQtyLabel(prod)}`)))
            : h('b', null, '-'))),
      h('div', { className: 'khata-summary' },
        h('div', null, h('span', null, t('totalCreditPurchases')), h('strong', null, money(summary.creditPurchases))),
        h('div', null, h('span', null, t('totalPaidLabel')), h('strong', null, money(summary.totalPaid))),
        h('div', null, h('span', null, t('remaining')), h('strong', { style: Number(balance) > 0 ? { color: '#c0392b' } : { color: '#267152' } }, money(balance)))),
      message && h('div', { className: 'notice' }, message),
      canManageUdhar
        ? h('button', {
            type: 'button',
            className: 'secondary khata-udhar-toggle' + (udharOpen ? ' open' : ''),
            disabled: busy,
            onClick: () => setUdharOpen(open => !open)
          }, udharOpen ? t('closeAddUdhar') : t('addNewUdhar'))
        : null,
      canManageUdhar && udharOpen
        ? h('form', { className: 'payment-form khata-udhar-form', onSubmit: addUdhar },
            h('input', { type: 'number', min: '1', step: 'any', required: true, placeholder: t('udharAmountPh'), value: udharForm.amount, onChange: e => setUdharForm({ ...udharForm, amount: e.target.value }) }),
            h('input', { type: 'text', placeholder: t('udharNotePh'), value: udharForm.note, onChange: e => setUdharForm({ ...udharForm, note: e.target.value }) }),
            h('input', { type: 'text', placeholder: t('udharReferencePh'), value: udharForm.reference, onChange: e => setUdharForm({ ...udharForm, reference: e.target.value }) }),
            h('input', { type: 'date', value: udharDate, onChange: e => setUdharDate(e.target.value), title: t('udharDateTitle') }),
            h('input', { type: 'time', value: udharTime, onChange: e => setUdharTime(e.target.value), title: t('udharTimeTitle') }),
            h('button', { type: 'submit', className: 'primary', disabled: busy || !(Number(udharForm.amount) > 0) }, t('saveUdharBtn')))
        : null,
      canManageUdhar
        ? h('form', { className: 'payment-form khata-pay-form', onSubmit: receivePayment },
            h('input', { type: 'number', min: '1', step: 'any', placeholder: `${t('payUdharMax')} ${money(balance)}`, value: amount, onChange: e => setAmount(e.target.value) }),
            h('input', { type: 'date', value: payDate, onChange: e => setPayDate(e.target.value), title: t('hPaymentDate') }),
            h('input', { type: 'time', value: payTime, onChange: e => setPayTime(e.target.value), title: t('hPaymentTime') }),
            h('button', { type: 'button', className: 'primary', disabled: !(Number(balance) > 0) || busy, onClick: function() { setAmount(String(Math.round(Number(balance) || 0))); } }, t('payFullAmount')),
            h('button', { type: 'submit', className: 'primary', disabled: !(Number(balance) > 0) || busy }, t('payUdhar')),
            h('button', { type: 'button', className: 'danger-btn', disabled: !(Number(balance) > 0) || busy, onClick: clearUdhar }, t('clearUdharBtn')))
        : h('div', { className: 'notice' }, t('udharNeedsManager')),
      h('div', { className: 'ledger-list' },
        entries === null ? h('p', { className: 'empty-copy' }, t('loading')) :
        entries.length === 0 ? h('p', { className: 'empty-copy' }, t('noUdharHistory')) :
        h('div', null,
          h('div', { className: 'ledger-filter' },
            h('select', { value: monthFilter, onChange: e => setMonthFilter(e.target.value) },
              h('option', { value: 'all' }, t('allMonths')),
              monthKeys(entries).map(monthKey => h('option', { key: monthKey, value: monthKey },
                new Date(monthKey + '-01').toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })))),
            h('span', { className: 'ledger-balance-tip' }, `${t('remaining')}: ${money(balance)}`)),
          monthKeys(entries).filter(monthKey => monthFilter === 'all' || monthKey === monthFilter).map(monthKey =>
            h('div', { className: 'ledger-month', key: monthKey },
              h('div', { className: 'ledger-month-head' },
                h('strong', null, new Date(monthKey + '-01').toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })),
                h('span', null, `${entries.filter(e => (e.at || '').slice(0, 7) === monthKey).length} ${t('billWord')}`)),
              entries.filter(e => (e.at || '').slice(0, 7) === monthKey).map(entry => {
                const canReverse = user && (user.role === 'Admin' || user.role === 'Manager');
                 const isCreditEntry = entry.type !== 'payment';
                 return h('div', { className: `ledger-entry ${entry.type}`, key: entry.id },
                   h('div', { className: 'entry-info' },
                     h('strong', null, entry.type === 'sale'
                       ? `${t('creditSaleEntry')} ${entry.invoiceNo}`
                       : entry.type === 'udhar'
                         ? `${t('udharEntryLabel')}${entry.note ? ' - ' + entry.note : ''}`
                         : `${t('paymentReceived')}${entry.invoiceNo ? ' (' + entry.invoiceNo + ')' : ''}${entry.note && !entry.invoiceNo ? ' - ' + entry.note : ''}`),
                     // A bill the customer settled at the counter is on the khata for the record, but
                     // it added no udhar - saying so keeps the statement from looking like it grew.
                     entry.type === 'sale' && entry.paidInFull ? h('small', { className: 'entry-settled' }, t('fullyPaid')) : null,
                     entry.products && h('small', null, entry.products),
                     h('small', null, `${when(entry.at)}${entry.createdBy ? ' - ' + entry.createdBy : ''}${entry.reference ? ' - ' + t('refPrefix') + ' ' + entry.reference : ''}${entry.note && entry.invoiceNo ? ' - ' + entry.note : ''}`)),
                   h('div', { className: 'entry-amounts' },
                     // Money already shown on the bill row as "paid at billing" is listed here for the
                     // record only, so it must not print a second minus sign against the balance.
                     (entry.type === 'sale' && entry.paidInFull) || entry.paidAtBilling
                       ? h('b', { className: 'amount-paid' }, money(entry.amount))
                       : h('b', { className: isCreditEntry ? 'amount-due' : 'amount-paid' }, `${isCreditEntry ? '+' : '-'}${money(entry.amount)}`),
                     h('span', { className: 'entry-balance' }, `${t('balanceForCustomer')} ${money(balanceAfter[entry.id] ?? balance)}`)),
                  h('div', { className: 'entry-actions' },
    entry.type === 'sale' && customer.phone
      ? h('button', { className: 'wa-btn entry-wa', onClick: () => shareBillAsImage(withPrevBalance(entry), settings, customer, setMessage) }, t('whatsappBill'))
                      : null,
                     canReverse && entry.type !== 'udhar'
                       ? h('button', { className: 'danger-btn small entry-reverse', disabled: busy, onClick: () => reverseEntry(entry) },
                         entry.type === 'sale' ? t('reverseBill') : t('reversePayment'))
                       : null));
                }))))),
      h('div', { className: 'success-actions no-print' }, h('button', { className: 'primary', onClick: onClose }, t('close'))))),
    document.body);
}

// Two fields is all a counter needs mid-bill: who it is, and a number to send the bill to later.
// The full customer form stays on the customers page for CNIC, address and credit limit.
function QuickAddCustomerModal({ name: initialName, client, onSaved, onClose }) {
  const [name, setName] = useState(initialName || '');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    if (nameRef.current) nameRef.current.focus();
  }, []);

  async function save(event) {
    if (event) event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage(LANG === 'ur' ? 'پہلے نام لکھیں۔' : 'Enter the customer name first.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const created = await client.post('/api/customers', { name: trimmed, phone: phone.trim() });
      onSaved(created);
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return ReactDOM.createPortal(h('div', { className: 'modal', onClick: onClose },
    h('form', { className: 'modal-card quick-add-customer', onClick: function(e) { e.stopPropagation(); }, onSubmit: save },
      h('h3', null, t('addNewCustomer')),
      h('label', null, t('customerLabel'),
        h('input', { ref: nameRef, value: name, onChange: e => setName(e.target.value), placeholder: t('customerNamePh'), autoComplete: 'off' })),
      h('label', null, `${t('phoneLabel')} (${t('optionalWord')})`,
        h('input', { value: phone, onChange: e => setPhone(e.target.value), placeholder: '03xx-xxxxxxx', inputMode: 'tel', autoComplete: 'off' })),
      h('p', { className: 'hint' }, t('quickAddNote')),
      message && h('div', { className: 'notice danger' }, message),
      h('div', { className: 'success-actions' },
        h('button', { type: 'button', className: 'secondary', onClick: onClose }, t('close')),
        h('button', { type: 'submit', className: 'primary', disabled: busy }, busy ? t('savingWord') : t('saveAndUse'))))),
    document.body);
}

function CustomerEditModal({ customer, client, refresh, canEditUdhar, onClose, products }) {
  const init = {
    name: customer.name || '',
    phone: customer.phone || '',
    cnic: '',
    address: customer.address || '',
    creditLimit: customer.creditLimit || 0,
    udhaarTotal: Number(customer.creditPurchases || 0),
    udhaarPaid: Number(customer.totalPaid || 0),
    paymentDate: customer.lastPaymentAt ? toDateInputValue(customer.lastPaymentAt) : '',
    paymentTime: customer.lastPaymentAt ? toTimeInputValue(customer.lastPaymentAt) : '',
    products: customerProductsList(customer).map(product => ({
      ...product,
      qty: Number(product.qty) || 1,
      unit: product.unit || '',
      // Remember the product's own unit so switching to gram later re-prices correctly.
      baseUnit: product.baseUnit || product.unit || '',
      price: Number(product.price) || 0
    })),
    manualMode: false
  };
  const [form, setForm] = useState(init);
  const [productSearch, setProductSearch] = useState('');
  const [manualDraft, setManualDraft] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [extraUdharOpen, setExtraUdharOpen] = useState(false);
  const [extraUdhar, setExtraUdhar] = useState({ amount: '', note: '', reference: '' });
  const [extraUdharDate, setExtraUdharDate] = useState(toDateInputValue(new Date().toISOString()));
  const [extraUdharTime, setExtraUdharTime] = useState(toTimeInputValue(new Date().toISOString()));
  // What one picked product adds to the udhar: its rate in the chosen unit times the quantity.
  // A line with no price (a name typed by hand) adds nothing, so the total never moves on its own.
  const productValue = product => {
    if (!product) return 0;
    const base = Number(product.price) || 0;
    if (!(base > 0)) return 0;
    const rate = rateForUnit(base, product.unit, product.baseUnit || product.unit);
    return round3(rate * (Number(product.qty) || 0));
  };
  // Names the products behind the entry so the khata line reads as goods, not a bare number.
  const productUdharNote = (amount, products, before) => {
    const was = new Set(before.map(p => `${p.id || 'manual'}|${p.name}|${p.qty}|${p.unit}`));
    const added = products
      .filter(p => !was.has(`${p.id || 'manual'}|${p.name}|${p.qty}|${p.unit}`))
      .map(p => `${p.name}${productQtyLabel(p)}`.trim())
      .filter(Boolean);
    const list = added.length ? added.join(', ') : t('productLabel');
    return LANG === 'ur' ? `${list} — ${money(amount)}` : `${list} - ${money(amount)}`;
  };
  // The product list is kept separate from the udhar total. Adding a priced product is not a silent
  // edit of a stored number, it is a dated entry in the khata, so the total on the form stays exactly
  // where the cashier left it and the addition is sent on its own below.
  const applyProductChange = (old, products) => ({ ...old, products });
  const remaining = Math.max(0, (Number(form.udhaarTotal) || 0) - (Number(form.udhaarPaid) || 0));
  // What the picked products are worth. Each row re-prices from its own product rate whenever the
  // unit changes, so picking a product in grams never charges the per-kilo rate. This is the same
  // figure that is added into the udhar total when a product is added, changed or removed.
  const productsTotal = round3(form.products.reduce((sum, product) => sum + productValue(product), 0));
  // What saving will actually record: only a rise in the products is a new purchase. A lower figure
  // is the profile list being tidied up, not goods being taken back, so it never touches the ledger.
  const pendingProductValue = canEditUdhar
    ? Math.max(0, round3(productsTotal - init.products.reduce((sum, product) => sum + productValue(product), 0)))
    : 0;
  const addedProductIds = new Set(form.products.filter(p => p.id).map(p => p.id));
  const productHits = productSearch.trim()
    ? (products || []).filter(prod => !addedProductIds.has(prod.id) && `${prod.name || ''} ${prod.category || ''} ${prod.sku || ''}`.toLowerCase().includes(productSearch.trim().toLowerCase())).slice(0, 6)
    : [];
  const productSelected = form.products.length > 0;
  function addProduct(prod) {
      if (addedProductIds.has(prod.id)) return;
      // Carry the product's price and its own unit across, so the picked product adds its price to the
      // udhar total instead of showing up as a nameless line.
      setForm(old => applyProductChange(old, [...old.products, {
        id: prod.id,
        name: prod.name,
        manual: false,
        qty: 1,
        unit: prod.unit || '',
        baseUnit: prod.unit || '',
        price: Number(prod.price) || 0
      }]));
      setProductSearch('');
      setManualDraft('');
    }
  function openManual() {
    setForm(old => ({ ...old, manualMode: true }));
    setManualDraft('');
  }
  function commitManual() {
    const name = manualDraft.trim();
    if (!name) return;
    setForm(old => ({
      ...old,
      manualMode: false,
      products: old.products.some(p => !p.id && p.manual && p.name.toLowerCase() === name.toLowerCase())
        ? old.products
        : [...old.products, { id: null, name, manual: true, qty: 1, unit: '' }]
    }));
    setManualDraft('');
  }
  function cancelManual() {
    setForm(old => ({ ...old, manualMode: false }));
    setManualDraft('');
  }
    function removeProduct(index) {
      setForm(old => applyProductChange(old, old.products.filter((_, i) => i !== index)));
    }
    function setProductQty(index, qty) {
      setForm(old => applyProductChange(old, old.products.map((p, i) => i === index ? { ...p, qty } : p)));
    }
    function setProductUnit(index, unit) {
      // Keep the physical amount and re-price it from the product's own rate: 2 kg at Rs 100/kg
      // becomes 2000 gram at Rs 0.05/g, so the udhar total does not jump.
      setForm(old => {
        const next = old.products.map((p, i) => {
          if (i !== index) return p;
          const baseUnit = p.baseUnit || p.unit;
          // Do not guess a conversion between different kinds of unit; the dropdown only offers
          // compatible ones, so this only guards values loaded from an old record.
          if (unitDimension(p.unit) && unitDimension(baseUnit) && unitDimension(unit)
            && unitDimension(unit) !== unitDimension(baseUnit)) return p;
          const factor = unitToBase(p.unit, baseUnit);
          const nextFactor = unitToBase(unit, baseUnit);
          return { ...p, unit, qty: round3((Number(p.qty) || 0) * (factor / (nextFactor || 1))) };
        });
        return applyProductChange(old, next);
      });
    }

  // Same append-only endpoint the Khata uses, so a udhar typed here shows up in the ledger and in
  // sync exactly like one typed there - the two screens can never disagree.
  async function addExtraUdhar(event) {
    if (event) event.preventDefault();
    setMessage('');
    if (!(Number(extraUdhar.amount) > 0)) {
      setMessage(LANG === 'ur' ? 'پہلے رقم درج کریں۔' : 'Enter the udhar amount first.');
      return;
    }
    setBusy(true);
    // Built before the request so the same body can be queued if there is no network.
    const payload = {
      amount: Number(extraUdhar.amount),
      note: extraUdhar.note.trim(),
      reference: extraUdhar.reference.trim()
    };
    if (extraUdharDate || extraUdharTime) {
      payload.atDate = extraUdharDate;
      payload.atTime = extraUdharTime;
    }
    try {
      const result = await client.post(`/api/customers/${customer.id}/udhar`, payload);
      setExtraUdhar({ amount: '', note: '', reference: '' });
      setExtraUdharDate(toDateInputValue(new Date().toISOString()));
      setExtraUdharTime(toTimeInputValue(new Date().toISOString()));
      setExtraUdharOpen(false);
      setMessage(LANG === 'ur'
        ? `${money(result.entry.amount)} نیا اُدھار درج ہو گیا۔ کل بیلنس: ${money(result.balance)}۔`
        : `New udhar of ${money(result.entry.amount)} recorded. New balance: ${money(result.balance)}.`);
      await refresh();
    } catch (err) {
      if (isNetworkFailure(err)) {
        queueAction('udhar', { customerId: customer.id, ...payload });
        setExtraUdhar({ amount: '', note: '', reference: '' });
        setExtraUdharOpen(false);
        setForm(form => ({ ...form, udhaarTotal: round3((Number(form.udhaarTotal) || 0) + Number(payload.amount)) }));
        setMessage(offlineSavedMessage(Number(payload.amount), 'udhar'));
      } else {
        setMessage(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    // Built before the request so the same edit can be queued if there is no network.
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
    // Carry the per-unit price so a picked product contributes a real amount to the udhar, not
    // just a name in the profile list.
    payload.products = form.products.map(product => {
      const baseUnit = product.baseUnit || product.unit;
      return {
        id: product.id || '',
        name: product.name || '',
        manual: Boolean(!product.id),
        qty: Math.max(0, Number(product.qty) || 1),
        unit: String(product.unit || '').trim(),
        baseUnit: String(baseUnit || '').trim(),
        price: rateForUnit(product.price, product.unit, baseUnit)
      };
    });
    // A priced product added on this form is a real credit purchase, so it is recorded as a dated
    // udhar entry instead of quietly rewriting a stored total. It is a separate request field, which
    // is what lets the ledger show it under the day it happened.
    if (canEditUdhar && pendingProductValue > 0) {
      payload.productUdhar = {
        amount: pendingProductValue,
        note: productUdharNote(pendingProductValue, form.products, init.products),
        atDate: form.paymentDate || extraUdharDate,
        atTime: form.paymentTime || extraUdharTime,
        // Fixed before the request so a queued offline replay carries the same id and cannot add
        // the amount a second time when it eventually syncs.
        clientId: `productUdhar_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      };
    }
    try {
      const saved = await client.put(`/api/customers/${customer.id}`, payload);
      const entry = saved && saved.productUdharEntry;
      setMessage(entry
        ? (LANG === 'ur'
          ? `محفوظ ہو گیا۔ ${money(entry.amount)} کا نیا اُدھار درج ہو گیا۔`
          : `Saved. ${money(entry.amount)} recorded as a new dated udhar entry.`)
        : (LANG === 'ur' ? 'محفوظ ہو گیا۔' : 'Saved.'));
      await refresh();
      onClose();
    } catch (err) {
      if (isNetworkFailure(err)) {
        // Keep the edit on this device and close the form, so the counter can carry on. Sending the
        // same fields again later gives the same result on the server, and the dated udhar entry goes
        // in with it under its own clientId.
        queueAction('customer', { customerId: customer.id, ...payload });
        setMessage(LANG === 'ur'
          ? 'محفوظ ہو گیا۔ یہ تبدیلی انترنت آنے پر خودکار طور پر سنک ہو گئی۔'
          : 'Saved on this device. It will sync automatically when the internet returns.');
        setTimeout(onClose, 1200);
      } else {
        setMessage(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const productPicker = h('div', { className: 'product-picker' },
    productSelected && h('div', { className: 'selected-product' },
      h('div', { className: 'product-chip-list' }, form.products.map((prod, index) => {
        const rowRate = rateForUnit(prod.price, prod.unit, prod.baseUnit || prod.unit);
        return h('span', { className: 'chip-item', key: `${prod.id || 'manual'}-${index}` },
          h('span', { className: `product-chip${prod.manual ? ' manual' : ''}` },
            `${prod.name}${productQtyLabel(prod)}`,
            h('input', { type: 'number', min: '1', step: 'any', className: 'chip-qty', value: Number(prod.qty || 1), onChange: e => setProductQty(index, e.target.value) }),
            h('select', { className: 'chip-unit', value: prod.unit || '', onChange: e => setProductUnit(index, e.target.value) },
              !UNITS.some(unit => unit.value === prod.unit) && prod.unit
                ? h('option', { value: prod.unit, key: 'custom' }, prod.unit)
                : null,
              unitsForBase(prod.baseUnit).map(unit => h('option', { value: unit.value, key: unit.value }, unitLabel(unit.value)))),
            Number(prod.price) > 0
              ? h('span', { className: 'chip-amount' }, `${moneyRate(rowRate * (Number(prod.qty) || 0))}`)
              : null),
          h('button', { type: 'button', className: 'chip-remove', title: t('clearProduct'), onClick: () => removeProduct(index) }, '×'));
      })),
      // Spells out what saving is about to do, so a product that no longer nudges the total on the
      // form does not look like it was ignored.
      Number(pendingProductValue) > 0
        ? h('p', { className: 'hint chip-total' }, LANG === 'ur'
          ? `نیا اُدھار درج ہو گا: ${moneyRate(pendingProductValue)}`
          : `Will be added to udhar on save: ${moneyRate(pendingProductValue)}`)
        : Number(productsTotal) > 0
          ? h('p', { className: 'hint chip-total' }, `${t('productLabel')}: ${moneyRate(productsTotal)}`)
          : null),
    !form.manualMode && h('input', {
      key: 'search',
      className: 'product-search',
      placeholder: t('searchProducts'),
      value: productSearch,
      onChange: e => setProductSearch(e.target.value)
    }),
    productHits.length > 0 && h('div', { className: 'product-match-list', key: 'matches' }, productHits.map(prod =>
      h('button', {
        key: prod.id,
        type: 'button',
        className: 'product-match',
        onClick: () => addProduct(prod)
      },
        h('strong', null, prod.name),
        h('small', null, [prod.category, prod.sku].filter(Boolean).join(' · ') || t('productLabel')),
        h('span', { className: 'add-tag' }, t('add'))))),
    productSearch.trim() && productHits.length === 0 && !form.manualMode && h('p', { className: 'hint', key: 'none' }, t('noMatchingProducts')),
    !form.manualMode && h('button', { type: 'button', className: 'secondary', key: 'manual-btn', onClick: openManual }, t('addProductManually')),
    form.manualMode && h('div', { className: 'manual-row', key: 'manual-row' },
      h('input', { placeholder: t('productName'), value: manualDraft, onChange: e => setManualDraft(e.target.value), autoFocus: true }),
      h('button', { type: 'button', className: 'primary', onClick: commitManual }, t('add')),
      h('button', { type: 'button', className: 'secondary', onClick: cancelManual }, t('cancelLabel'))),
    productSelected && h('p', { className: 'hint', key: 'hint' }, t('productPickHint')));

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
        h('div', { className: 'section-label' }, t('productLabel')),
        productPicker,
        canEditUdhar && h('div', { className: 'section-label' }, t('udharKhataEyebrow')),
        canEditUdhar && h('button', {
          type: 'button',
          className: 'secondary khata-udhar-toggle' + (extraUdharOpen ? ' open' : ''),
          disabled: busy,
          onClick: () => setExtraUdharOpen(open => !open)
        }, extraUdharOpen ? t('closeAddUdhar') : t('addNewUdhar')),
        canEditUdhar && extraUdharOpen && h('form', { className: 'payment-form khata-udhar-form', onSubmit: addExtraUdhar },
          h('input', { type: 'number', min: '1', step: 'any', required: true, placeholder: t('udharAmountPh'), value: extraUdhar.amount, onChange: e => setExtraUdhar({ ...extraUdhar, amount: e.target.value }) }),
          h('input', { type: 'text', placeholder: t('udharNotePh'), value: extraUdhar.note, onChange: e => setExtraUdhar({ ...extraUdhar, note: e.target.value }) }),
          h('input', { type: 'text', placeholder: t('udharReferencePh'), value: extraUdhar.reference, onChange: e => setExtraUdhar({ ...extraUdhar, reference: e.target.value }) }),
          h('input', { type: 'date', value: extraUdharDate, onChange: e => setExtraUdharDate(e.target.value), title: t('udharDateTitle') }),
          h('input', { type: 'time', value: extraUdharTime, onChange: e => setExtraUdharTime(e.target.value), title: t('udharTimeTitle') }),
          h('button', { type: 'submit', className: 'primary', disabled: busy || !(Number(extraUdhar.amount) > 0) }, t('saveUdharBtn'))),
        canEditUdhar && h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hTotalCredit')), h('input', { type: 'number', min: '0', value: form.udhaarTotal, onChange: e => setForm({ ...form, udhaarTotal: e.target.value }) })),
          h('div', null, h('label', null, t('hTotalPaid')), h('input', { type: 'number', min: '0', value: form.udhaarPaid, onChange: e => setForm({ ...form, udhaarPaid: e.target.value }) })),
          h('div', { className: 'remaining-row' }, h('label', null, t('remaining')), h('strong', null, money(remaining)))),
        canEditUdhar && h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('hPaymentDate')), h('input', { type: 'date', value: form.paymentDate, onChange: e => setForm({ ...form, paymentDate: e.target.value }) })),
          h('div', null, h('label', null, t('hPaymentTime')), h('input', { type: 'time', value: form.paymentTime, onChange: e => setForm({ ...form, paymentTime: e.target.value }) }))),
        canEditUdhar && h('p', { className: 'hint' }, LANG === 'ur'
          ? 'نوٹ: نیا اُدھار اوپر "نیا اُدھار درج کریں" سے درج کریں - ہر اُدھار الگ اندراج کے طور پر محفوظ ہوتا ہے۔ ادائیگی کھاتہ سے درج کریں۔'
          : 'Add each udhar with "Add New Udhaar" above - every entry is stored separately in the ledger. Record payments from the Khata.'),
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
    location: product.location || '',
    cost: product.cost ?? '',
    price: product.price ?? '',
    stock: product.stock ?? '',
    reorderLevel: product.reorderLevel ?? 0,
    unit: product.unit || 'pcs',
    kgPerBoree: product.kgPerBoree ?? '',
    pcsPerCarton: product.pcsPerCarton ?? '',
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
        location: form.location,
        cost: Number(form.cost) || 0,
        price: Number(form.price) || 0,
        stock: Number(form.stock) || 0,
        reorderLevel: Number(form.reorderLevel) || 0,
        unit: form.unit,
        kgPerBoree: Number(form.kgPerBoree) || 0,
        pcsPerCarton: Number(form.pcsPerCarton) || 0,
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
          h('div', null, h('label', null, t('locationLabel')), h('input', { value: form.location, onChange: e => setForm({ ...form, location: e.target.value }), placeholder: t('whLocation') }))),
        h('div', { className: 'section-label' }, t('packSpec')),
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('kgPerBoreeLabel')), h('input', { type: 'number', min: '0', step: 'any', value: form.kgPerBoree, onChange: e => setForm({ ...form, kgPerBoree: e.target.value }), placeholder: t('kgPerBoreePh') })),
          h('div', null, h('label', null, t('pcsPerCartonLabel')), h('input', { type: 'number', min: '0', step: 'any', value: form.pcsPerCarton, onChange: e => setForm({ ...form, pcsPerCarton: e.target.value }), placeholder: t('pcsPerCartonPh') }))),
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
    kgPerBoree: item.kgPerBoree ?? '',
    pcsPerCarton: item.pcsPerCarton ?? '',
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
        kgPerBoree: Number(form.kgPerBoree) || 0,
        pcsPerCarton: Number(form.pcsPerCarton) || 0,
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
        h('div', { className: 'section-label' }, t('packSpec')),
        h('div', { className: 'edit-form-row' },
          h('div', null, h('label', null, t('kgPerBoreeLabel')), h('input', { type: 'number', min: '0', step: 'any', value: form.kgPerBoree, onChange: e => setForm({ ...form, kgPerBoree: e.target.value }), placeholder: t('kgPerBoreePh') })),
          h('div', null, h('label', null, t('pcsPerCartonLabel')), h('input', { type: 'number', min: '0', step: 'any', value: form.pcsPerCarton, onChange: e => setForm({ ...form, pcsPerCarton: e.target.value }), placeholder: t('pcsPerCartonPh') }))),
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
      if (isNetworkFailure(err)) {
        // Held on the device until the network is back; stock and udhar move only when the server
        // applies it, and the clientId stops it being applied twice.
        queueAction('return', { saleId: lookup.sale.id, items: complete ? undefined : items, complete, reason });
        setQuantities({});
        setReason('');
        setMessage(offlineSavedMessage(0, 'return'));
      } else {
        setMessage(friendlyError(err));
      }
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

function Reports({ data, client, refresh }) {
  // The day, month and year totals are worked out on the server, so they have to be re-pulled when the
  // page is opened or they stay stuck on whatever the last full load happened to show.
  useEffect(() => {
    if (refresh) refresh();
  }, []);
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
    h('div', { className: 'page-title' }, h('div', null, h('p', { className: 'eyebrow' }, t('storeSettings')), h('h1', null, data.settings.storeName), h('p', { className: 'subtitle' }, data.settings.address || '')), h('button', { className: 'primary', onClick: createBackup }, t('createBackup'))),
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
  const [navOpen, setNavOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [dataWarning, setDataWarning] = useState('');
  const [syncNotice, setSyncNotice] = useState('');
  const pendingActions = useQueuedActionCount();
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

  // Fold a just-saved bill into the data already on screen: the invoice goes onto the sale list,
  // the customer's balance and udhar totals move, and the billed stock comes off the shelves. The
  // server has already stored all of it, so nothing is invented here - this only spares the cashier
  // a second full reload before starting the next bill.
  function applySale(sale) {
    setData(current => {
      if (!current) return current;
      const items = sale.items || [];
      const billedByProduct = {};
      for (const item of items) {
        if (!item.productId) continue;
        // Stock is stored in the product's own unit, so decrement by the converted base quantity
        // the server already worked out - not by the number the cashier typed.
        const baseQty = Number(item.baseQty !== undefined ? item.baseQty : item.qty) || 0;
        billedByProduct[item.productId] = (billedByProduct[item.productId] || 0) + baseQty;
      }
      const products = (current.products || []).map(product => {
        const taken = billedByProduct[product.id];
        return taken ? { ...product, stock: round3(Number(product.stock || 0) - taken) } : product;
      });
      // The server sends the customer's already-recalculated row with the sale, so the balance, udhar
      // totals and last-payment date on screen are the server's own numbers.
      const customers = sale.customer
        ? (current.customers || []).map(customer => (customer.id === sale.customerId ? sale.customer : customer))
        : current.customers;
      return {
        ...current,
        products,
        customers,
        sales: [sale, ...(current.sales || [])].slice(0, 50)
      };
    });
  }

  useEffect(() => { refresh(); }, [session?.token]);
  useEffect(() => {
    const onOnline = () => { setOnline(true); refresh(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [session?.token]);

  // Anything recorded while offline (udhaar payment, new udhaar, return) is sent as soon as the
  // network is back, from any page, and re-checked on a timer in case the browser misses the event.
  useEffect(() => {
    if (!session?.token || session.token === 'offline-token') return;
    let stopped = false;
    async function flush() {
      if (stopped) return;
      const done = await flushActionQueue(client);
      if (stopped) return;
      if (done.synced > 0) {
        setSyncNotice(LANG === 'ur' ? `${done.synced} آف لائن اندراج سنک ہو گیا۔` : `${done.synced} offline entr${done.synced === 1 ? 'y' : 'ies'} synced.`);
        await refresh();
      }
      if (done.errors.length) setSyncNotice(friendlyErrorQueued(0, done.errors));
    }
    flush();
    const timer = setInterval(flush, 15000);
    const onBack = () => flush();
    window.addEventListener('online', onBack);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('online', onBack); };
  }, [client, session?.token]);

  if (!session) return h(Login, { onLogin: setSession, langTick, bumpLang });
  if (!data) return h('main', { className: 'loading' }, error || t('loadingData'));
  const role = data.user.role;
  const visiblePages = pages.filter(([id]) => canSee(data.user, id));
  const activePage = visiblePages.some(([id]) => id === page) ? page : (visiblePages[0] || ['dashboard'])[0];
  return h('main', { className: 'app-shell', dir: LANG === 'ur' ? 'rtl' : 'ltr' },
    h('aside', { className: 'sidebar' + (navOpen ? ' open' : '') }, h('div', { className: 'brand' }, h('img', { className: 'brand-logo', src: 'logo.png?v=27', alt: '' }), h('div', null, h('strong', null, 'Faislabadi'), h('small', null, 'GENERAL STORE'))), h('nav', null, visiblePages.map(([id]) => h('button', { key: id, className: activePage === id ? 'nav-item active' : 'nav-item', onClick: () => { setPage(id); setNavOpen(false); } }, h('span', null, t('nav_' + id)))), h(LangToggle, { tick: bumpLang })), h('div', { className: 'sidebar-footer' }, h('div', { className: 'avatar' }, data.user.name.split(' ').map(part => part[0]).join('').slice(0, 2)), h('div', null, h('strong', null, data.user.name), h('small', null, role)), h('button', { className: 'more', onClick: () => { try { client.post('/api/auth/logout', {}).catch(() => {}); } catch (_) {} localStorage.removeItem(stateKey); setSession(null); } }, t('logout')))),
    h('section', { className: 'main-area' }, h('header', { className: 'topbar' }, activePage === 'pos' && h('button', { className: 'menu-btn', 'aria-label': LANG === 'ur' ? 'مینو کھولیں' : 'Open menu', onClick: () => setNavOpen(!navOpen) }, h('span', { className: 'menu-btn-icon' }, '☰')), h('div', { className: 'crumb' }, 'Faislabadi General Store / ', h('strong', null, t('nav_' + activePage))), h('div', { className: 'top-actions' },
      cloudSync && cloudSync.enabled && h('span', { className: cloudSync.lastError ? 'sync-status offline' : 'sync-status', title: cloudSync.lastSuccessAt ? `${t('cloudSyncedAt')} ${new Date(cloudSync.lastSuccessAt).toLocaleTimeString()}` : t('waitingFirstSync') }, cloudSync.lastError ? t('cloudPending') : (cloudSync.lastSuccessAt ? t('cloudSynced') : t('cloudConnecting'))),
      h('span', { className: online ? 'sync-status' : 'sync-status offline' }, online ? t('online') : t('offline')), pendingActions > 0 && h('span', { className: 'sync-status offline', title: LANG === 'ur' ? 'انترنت آنے پر یہ خودکار طور پر سنک ہوں گے' : 'These will sync automatically when the internet returns' }, LANG === 'ur' ? `${pendingActions} سنک باقی` : `${pendingActions} waiting to sync`), h('button', { className: 'secondary', onClick: refresh }, t('refresh')), h(LangToggle, { tick: bumpLang }))), dataWarning && h('div', { className: 'notice danger', style: { margin: '12px 20px 0' } }, dataWarning), syncNotice && h('div', { className: 'notice warning', style: { margin: '12px 20px 0' } }, syncNotice), storageNotice && h('div', { className: 'notice warning', style: { margin: '12px 20px 0' } }, storageNotice),     activePage === 'dashboard' ? h(Dashboard, { data, go: setPage, client, refresh }) : activePage === 'pos' ? h(POS, { client, data, refresh, applySale, online, setOnline, go: setPage }) : activePage === 'users' ? h(UsersAdmin, { client }) : activePage === 'returns' ? h(ReturnsPage, { data, client, refresh }) : activePage === 'reports' ? h(Reports, { data, client }) : activePage === 'purchases' ? h(Purchases, { data, client, refresh }) : activePage === 'settings' ? h(Settings, { data, client }) : activePage === 'warehouse' ? h(WarehousePage, { data, client, refresh }) : h(DataPage, { page: activePage, data, client, refresh })));
    navOpen && h('div', { className: 'menu-backdrop', onClick: () => setNavOpen(false) });
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
