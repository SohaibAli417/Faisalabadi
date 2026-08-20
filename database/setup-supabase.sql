-- Run this in your Supabase SQL Editor to create the required table
-- Go to: https://supabase.com/dashboard → Your Project → SQL Editor

CREATE TABLE IF NOT EXISTS pos_data (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert initial seed data (run this AFTER creating the table)
-- The app will auto-seed on first API call if the table is empty

-- Row Level Security (optional - enable for production)
ALTER TABLE pos_data ENABLE ROW LEVEL SECURITY;

-- Allow all operations from the service role key (used by the app)
CREATE POLICY "Allow all for service role" ON pos_data
  FOR ALL
  USING (true)
  WITH CHECK (true);
