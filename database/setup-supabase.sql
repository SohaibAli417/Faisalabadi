-- Run this in your Supabase SQL Editor to create the required tables
-- Go to: https://supabase.com/dashboard → Your Project → SQL Editor
-- Paste this whole file and click RUN.

-- Main POS database (the whole shop database lives in the "data" column)
CREATE TABLE IF NOT EXISTS pos_data (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auth fallback (users + sessions snapshot used only when pos_data is unreachable)
CREATE TABLE IF NOT EXISTS pos_auth (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB,
  users JSONB,
  sessions JSONB,
  settings JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Cloud backups list
CREATE TABLE IF NOT EXISTS pos_backups (
  id TEXT PRIMARY KEY,
  file TEXT,
  reason TEXT,
  data JSONB,
  backed_up_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security (optional - enable for production)
-- The app connects with the anon key, so the policy must allow anon/authenticated roles.
ALTER TABLE pos_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all anon" ON pos_data
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all anon" ON pos_auth
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all anon" ON pos_backups
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- The app auto-seeds the shop data on the first API call when the table is empty.