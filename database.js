const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
const useSupabase = !!(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;
if (useSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('Supabase database connected');
} else {
  console.log('Using local JSON database');
}

const dbDir = process.env.POS_DATA_DIR || (process.env.VERCEL ? path.join('/tmp', 'faislabadi-pos', 'database') : path.join(__dirname, 'database'));
const dbFile = path.join(dbDir, 'pos-data.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSync() {
  ensureDir(dbDir);
  if (!fs.existsSync(dbFile)) return null;
  try { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch (_) { return null; }
}

function writeJsonSync(db) {
  ensureDir(dbDir);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

async function readDb() {
  if (useSupabase) {
    const { data, error } = await supabase.from('pos_data').select('data').eq('id', 'main').single();
    if (error || !data) return null;
    return data.data;
  }
  return readJsonSync();
}

async function writeDb(db) {
  db.meta.updatedAt = new Date().toISOString();
  if (useSupabase) {
    const { error } = await supabase.from('pos_data').upsert({ id: 'main', data: db, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error('Supabase write failed: ' + error.message);
    return;
  }
  writeJsonSync(db);
}

function readDbSync() {
  if (useSupabase) throw new Error('Sync read not available with Supabase');
  return readJsonSync();
}

function writeDbSync(db) {
  if (useSupabase) throw new Error('Sync write not available with Supabase');
  db.meta.updatedAt = new Date().toISOString();
  writeJsonSync(db);
}

module.exports = { readDb, writeDb, readDbSync, writeDbSync, useSupabase, ensureDir, backupDir: path.join(dbDir, 'backups') };
