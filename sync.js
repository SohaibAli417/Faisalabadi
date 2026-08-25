function recordTime(record) {
  return new Date(record._updatedAt || record.updatedAt || record.createdAt || record.at || 0).getTime() || 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function productStockDelta(sales, purchases, returns) {
  const delta = {};
  const bump = (productId, qty) => {
    if (!productId) return;
    delta[productId] = (delta[productId] || 0) + qty;
  };
  for (const sale of sales) {
    if (sale.voided) continue;
    for (const item of asArray(sale.items)) bump(item.productId, -Number(item.qty || 0));
  }
  for (const purchase of purchases) for (const item of asArray(purchase.items)) bump(item.productId, Number(item.qty || 0));
  for (const refund of returns) for (const item of asArray(refund.items)) bump(item.productId, Number(item.qty || 0));
  return delta;
}

function customerCreditDelta(sales) {
  const delta = {};
  for (const sale of sales) {
    if (sale.voided) continue;
    if (sale.paymentType !== 'Credit' || !sale.customerId || sale.customerId === 'cus_walkin') continue;
    const paid = sale.paidAmount === undefined || sale.paidAmount === null
      ? 0
      : Number(sale.paidAmount || 0);
    const due = Math.max(0, Number(sale.total || 0) - paid);
    if (!due) continue;
    delta[sale.customerId] = (delta[sale.customerId] || 0) + due;
  }
  return delta;
}

function tag(rows, origin) {
  return asArray(rows).map(row => ({ ...row, __origin: origin }));
}

function mergeSales(local, cloud) {
  const byId = new Map();
  const byClientId = new Map();
  const insert = (sale, origin) => {
    const row = { ...sale, __origin: origin };
    const twinId = sale.clientId ? byClientId.get(sale.clientId) : null;
    if (twinId && byId.has(twinId)) {
      const twin = byId.get(twinId);
      if (recordTime(row) > recordTime(twin)) byId.set(twinId, row);
      return;
    }
    byId.set(sale.id, row);
    if (sale.clientId) byClientId.set(sale.clientId, sale.id);
  };
  for (const sale of asArray(cloud)) insert(sale, 'cloud');
  const cloudIds = new Set(asArray(cloud).map(row => row.id));
  const localIds = new Set(asArray(local).map(row => row.id));
  let addedFromLocal = false;
  for (const sale of asArray(local)) {
    if (byId.has(sale.id)) continue;
    if (sale.clientId && byClientId.has(sale.clientId)) continue;
    insert(sale, 'local');
    if (!cloudIds.has(sale.id)) addedFromLocal = true;
  }
  const merged = [...byId.values()].sort((a, b) => recordTime(b) - recordTime(a));
  return { rows: merged, cloudIds, localIds, addedFromLocal };
}

function mergeLwwCollection(localRows, cloudRows, keyField) {
  const byKey = new Map();
  for (const row of tag(cloudRows, 'cloud')) {
    const existing = byKey.get(row[keyField]);
    if (!existing || recordTime(row) >= recordTime(existing)) byKey.set(row[keyField], row);
  }
  for (const row of tag(localRows, 'local')) {
    const existing = byKey.get(row[keyField]);
    if (!existing) byKey.set(row[keyField], row);
    else if (recordTime(row) >= recordTime(existing)) byKey.set(row[keyField], row);
  }
  return byKey;
}

function cleanRow(row) {
  const clean = { ...row };
  delete clean.__origin;
  return clean;
}

function mergeSessions(localSessions, cloudSessions, ttlMs) {
  const merged = {};
  const nowMs = Date.now();
  const add = (sessions) => {
    for (const [token, session] of Object.entries(sessions || {})) {
      if (!session || !session.createdAt) continue;
      if (nowMs - new Date(session.createdAt).getTime() > ttlMs) continue;
      merged[token] = session;
    }
  };
  add(cloudSessions);
  add(localSessions);
  return merged;
}

function mergeDbs(local, cloud, options = {}) {
  const flags = { localChanged: false, cloudChanged: false };
  const ttlMs = Number(options.sessionTtlMs || 8 * 60 * 60 * 1000);

  const salesMerge = mergeSales(local.sales, cloud.sales);
  const taggedSales = salesMerge.rows;
  const sales = taggedSales.map(cleanRow);
  if (taggedSales.some(row => !salesMerge.cloudIds.has(row.id))) flags.cloudChanged = true;
  if (taggedSales.some(row => !salesMerge.localIds.has(row.id))) flags.localChanged = true;

  const cloudOnlySales = taggedSales.filter(row => row.__origin === 'cloud' && !salesMerge.localIds.has(row.id));
  const localOnlySales = taggedSales.filter(row => row.__origin === 'local' && !salesMerge.cloudIds.has(row.id));

  const localPurchases = asArray(local.purchases);
  const cloudPurchasesRows = asArray(cloud.purchases);
  const localReturns = asArray(local.returns);
  const cloudReturnsRows = asArray(cloud.returns);

  const cloudPurchaseOnly = cloudPurchasesRows.filter(row => !localPurchases.some(item => item.id === row.id));
  const localPurchaseOnly = localPurchases.filter(row => !cloudPurchasesRows.some(item => item.id === row.id));
  const cloudReturnOnly = cloudReturnsRows.filter(row => !localReturns.some(item => item.id === row.id));
  const localReturnOnly = localReturns.filter(row => !cloudReturnsRows.some(item => item.id === row.id));

  const stockDeltaFromCloudSide = productStockDelta(cloudOnlySales, cloudPurchaseOnly, cloudReturnOnly);
  const stockDeltaFromLocalSide = productStockDelta(localOnlySales, localPurchaseOnly, localReturnOnly);
  const creditDeltaFromCloudSide = customerCreditDelta(cloudOnlySales);
  const creditDeltaFromLocalSide = customerCreditDelta(localOnlySales);

  const productMap = mergeLwwCollection(local.products, cloud.products, 'id');
  const products = [...productMap.values()].map(row => {
    const clean = cleanRow(row);
    const delta = row.__origin === 'local' ? stockDeltaFromCloudSide : stockDeltaFromLocalSide;
    if (typeof delta[clean.id] === 'number') {
      clean.stock = Math.max(0, Math.round(Number(clean.stock || 0) + delta[clean.id]));
    }
    return clean;
  }).sort((a, b) => recordTime(b) - recordTime(a));

  const customerMap = mergeLwwCollection(local.customers, cloud.customers, 'id');
  const customers = [...customerMap.values()].map(row => {
    const clean = cleanRow(row);
    const delta = row.__origin === 'local' ? creditDeltaFromCloudSide : creditDeltaFromLocalSide;
    if (typeof delta[clean.id] === 'number') {
      clean.balance = Math.round(Number(clean.balance || 0) + delta[clean.id]);
    }
    return clean;
  }).sort((a, b) => recordTime(b) - recordTime(a));

  const supplierMap = mergeLwwCollection(local.suppliers, cloud.suppliers, 'id');
  const suppliers = [...supplierMap.values()].map(cleanRow).sort((a, b) => recordTime(b) - recordTime(a));

  const purchases = [
    ...tag(localPurchases, 'local'),
    ...tag(cloudPurchasesRows, 'cloud')
  ].sort((a, b) => recordTime(b) - recordTime(a)).map(cleanRow);

  const returns = [
    ...tag(localReturns, 'local'),
    ...tag(cloudReturnsRows, 'cloud')
  ].sort((a, b) => recordTime(b) - recordTime(a)).map(cleanRow);

  if (cloudPurchaseOnly.length || localPurchaseOnly.length || cloudReturnOnly.length || localReturnOnly.length) {
    flags.cloudChanged = true;
    flags.localChanged = true;
  }

  const movementIds = new Map();
  for (const row of [...asArray(local.stockMovements), ...asArray(cloud.stockMovements)]) {
    if (row && row.id && !movementIds.has(row.id)) movementIds.set(row.id, row);
  }
  const stockMovements = [...movementIds.values()]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 5000);

  const paymentIds = new Map();
  for (const row of [...asArray(local.payments), ...asArray(cloud.payments)]) {
    if (row && row.id && !paymentIds.has(row.id)) paymentIds.set(row.id, row);
  }
  const payments = [...paymentIds.values()]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  if ((asArray(local.payments).length !== payments.length) || (asArray(cloud.payments).length !== payments.length)) {
    flags.cloudChanged = true;
    flags.localChanged = true;
  }

  const auditIds = new Map();
  for (const row of [...asArray(local.auditLogs), ...asArray(cloud.auditLogs)]) {
    if (row && row.id && !auditIds.has(row.id)) auditIds.set(row.id, row);
  }
  const auditLogs = [...auditIds.values()]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 5000);

  const invoiceSeq = Math.max(
    Number((local.meta && local.meta.invoiceSeq) || 0),
    Number((cloud.meta && cloud.meta.invoiceSeq) || 0)
  );

  const settings = local.settings || cloud.settings;
  const users = local.users || cloud.users;

  const merged = {
    ...(cloud || {}),
    ...(local || {}),
    meta: {
      ...(cloud.meta || {}),
      ...(local.meta || {}),
      createdAt: (local.meta && local.meta.createdAt) || (cloud.meta && cloud.meta.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      invoiceSeq
    },
    settings,
    users,
    sessions: mergeSessions(local.sessions, cloud.sessions, ttlMs),
    products,
    customers,
    suppliers,
    sales,
    purchases,
    returns,
    payments,
    stockMovements,
    auditLogs
  };

  if (JSON.stringify(cloud.settings || null) !== JSON.stringify(settings)) flags.cloudChanged = true;
  if (JSON.stringify(cloud.users || null) !== JSON.stringify(users)) flags.cloudChanged = true;
  const mergedSessions = mergeSessions(local.sessions, cloud.sessions, ttlMs);
  if (JSON.stringify(cloud.sessions || {}) !== JSON.stringify(mergedSessions)) flags.cloudChanged = true;
  if (JSON.stringify(local.sessions || {}) !== JSON.stringify(mergedSessions)) flags.localChanged = true;

  return { merged, localChanged: flags.localChanged, cloudChanged: flags.cloudChanged };
}

module.exports = { mergeDbs, mergeSessions, recordTime, productStockDelta, customerCreditDelta };
