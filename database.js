const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}
loadEnvFile();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const useSupabase = !!(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;
if (useSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

const dbDir = process.env.POS_DATA_DIR || (process.env.VERCEL ? path.join('/tmp', 'faislabadi-pos', 'database') : path.join(__dirname, 'database'));
const dbFile = path.join(dbDir, 'pos-data.json');

const MODE = process.env.POS_MODE
  || (process.env.VERCEL ? 'cloud' : (useSupabase ? 'local-first' : 'local'));

if (!useSupabase) {
  console.log('Using local JSON database (cloud sync disabled - no Supabase credentials)');
} else if (MODE === 'local-first') {
  console.log('Local-first mode: POS uses the local file and auto-syncs to the cloud database');
} else {
  console.log('Cloud mode: POS reads and writes the cloud database directly');
}

if (process.env.VERCEL && !useSupabase) {
  console.warn('WARNING: VERCEL detected without Supabase. Storage is temporary on Vercel and WILL RESET. Configure SUPABASE_URL and SUPABASE_ANON_KEY for production.');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSync() {
  ensureDir(dbDir);
  if (!fs.existsSync(dbFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch (error) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      fs.copyFileSync(dbFile, path.join(dbDir, `pos-data-corrupt-${stamp}.json`));
      console.error(`Database file was unreadable. A copy was saved as pos-data-corrupt-${stamp}.json before reseeding.`);
    } catch (_) {}
    console.error('Database read error:', error.message);
    return null;
  }
}

function writeJsonSync(db) {
  ensureDir(dbDir);
  const tmpFile = `${dbFile}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2));
  fs.renameSync(tmpFile, dbFile);
}

async function readLocalDb() {
  return readJsonSync();
}

function writeLocalDb(db) {
  writeJsonSync(db);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

async function withRetry(operation, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(300 * attempt);
    }
  }
  console.error(`${label} failed after ${attempts} attempts:`, lastError && lastError.message);
  throw lastError;
}

const cloudCacheFile = path.join(dbDir, 'cloud-cache.json');

function rememberCloud(db) {
  try {
    lastGoodCloud = db;
    ensureDir(dbDir);
    const tmpFile = `${cloudCacheFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(db));
    fs.renameSync(tmpFile, cloudCacheFile);
  } catch (_) {}
}

function recallCloud() {
  if (lastGoodCloud) return lastGoodCloud;
  try {
    if (fs.existsSync(cloudCacheFile)) {
      lastGoodCloud = JSON.parse(fs.readFileSync(cloudCacheFile, 'utf8'));
      return lastGoodCloud;
    }
  } catch (_) {}
  return null;
}

let lastGoodCloud = null;
let lastGoodAuth = null;

async function recallLastGoodAuth() {
  if (lastGoodAuth && Array.isArray(lastGoodAuth.users)) return lastGoodAuth;
  return null;
}

async function fetchCloudRow() {
  const query = supabase.from('pos_data').select('data').eq('id', 'main').single();
  const { data, error } = await withTimeout(query, 8000, 'Cloud read');
  if (error && error.code === 'PGRST116') return { absent: true };
  if (error) throw new Error(error.message);
  if (!data) return { absent: true };
  return { db: data.data };
}

async function readCloudDb() {
  if (!useSupabase) return null;
  try {
    let result = await withRetry(fetchCloudRow, 'Cloud read', 2);
    if (result.absent) {
      await sleep(1200);
      try {
        result = await fetchCloudRow();
      } catch (_) {
        result = { absent: true };
      }
    }
    if (result.absent) return null;
    if (result.db) rememberCloud(result.db);
    return result.db;
  } catch (error) {
    const cached = recallCloud();
    if (cached) {
      console.error('Cloud read failed - serving last known data from cache');
      return cached;
    }
    throw new Error('Cloud database temporarily unavailable');
  }
}

async function fetchAuthRow() {
  const query = supabase.from('pos_auth').select('data').eq('id', 'main').single();
  const { data, error } = await withTimeout(query, 6000, 'Auth read');
  if (error && (error.code === 'PGRST116' || error.code === '42P01' || /does not exist/i.test(error.message || ''))) return null;
  if (error) throw new Error(error.message);
  return data ? data.data : null;
}

async function readAuthData() {
  if (!useSupabase) return null;
  const auth = await withRetry(fetchAuthRow, 'Auth read', 2);
  if (auth && Array.isArray(auth.users) && auth.users.length) lastGoodAuth = auth;
  return auth;
}

async function writeAuthData(db) {
  if (!useSupabase) return;
  const payload = { id: 'main', users: db.users, sessions: db.sessions || {}, settings: db.settings || {}, updated_at: new Date().toISOString() };
  await withRetry(() => withTimeout(
    supabase.from('pos_auth').upsert(payload, { onConflict: 'id' }).then(({ error }) => { if (error) throw new Error(error.message); }),
    8000,
    'Auth write'
  ), 'Auth write', 1);
}

async function writeCloudDb(db) {
  if (!useSupabase) throw new Error('Cloud database is not configured');
  await withRetry(() => withTimeout(
    supabase.from('pos_data').upsert(
      { id: 'main', data: db, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    ).then(({ error }) => { if (error) throw new Error(error.message); }),
    20000,
    'Cloud write'
  ), 'Cloud write');
  rememberCloud(db);
}

async function readDb() {
  if (MODE === 'cloud' && useSupabase) return readCloudDb();
  return readLocalDb();
}

async function writeDb(db) {
  db.meta.updatedAt = new Date().toISOString();
  if (MODE === 'cloud' && useSupabase) {
    await writeCloudDb(db);
    try { await writeAuthData(db); } catch (_) {}
    return;
  }
  writeLocalDb(db);
}

function readDbSync() {
  if (useSupabase && MODE === 'cloud') throw new Error('Sync read not available in cloud mode');
  return readJsonSync();
}

function writeDbSync(db) {
  if (useSupabase && MODE === 'cloud') throw new Error('Sync write not available in cloud mode');
  db.meta.updatedAt = new Date().toISOString();
  writeJsonSync(db);
}

let dbChain = Promise.resolve();
function withDbLock(task) {
  const run = dbChain.then(() => task(), () => task());
  dbChain = run.then(() => undefined, () => undefined);
  return run;
}

module.exports = {
  readDb,
  writeDb,
  readLocalDb,
  writeLocalDb,
  readCloudDb,
  writeCloudDb,
  readAuthData,
  recallLastGoodAuth,
  writeAuthData,
  readDbSync,
  writeDbSync,
  useSupabase,
  MODE,
  withDbLock,
  ensureDir,
  backupDir: path.join(dbDir, 'backups')
};
