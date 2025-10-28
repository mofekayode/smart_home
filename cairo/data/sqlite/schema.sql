-- Events log
CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  data_json TEXT NOT NULL,
  correlation_id TEXT
);

CREATE INDEX idx_event_type ON event(type);
CREATE INDEX idx_event_timestamp ON event(timestamp);

-- Conversations
CREATE TABLE IF NOT EXISTS conversation (
  conversation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  turn_count INTEGER DEFAULT 0,
  summary TEXT
);

CREATE INDEX idx_conversation_user ON conversation(user_id);
CREATE INDEX idx_conversation_started ON conversation(started_at);

-- Conversation history (for RAG)
CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
  conversation_id UNINDEXED,
  content,
  metadata,
  timestamp UNINDEXED
);

-- Voice profiles (speaker identification)
CREATE TABLE IF NOT EXISTS voice_profile (
  user_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL,
  last_used TEXT,
  sample_count INTEGER DEFAULT 0
);

-- User preferences
CREATE TABLE IF NOT EXISTS user_preference (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Automations created by Cairo
CREATE TABLE IF NOT EXISTS automation (
  automation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  friendly_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_via_conversation TEXT,
  trigger_summary TEXT,
  action_summary TEXT,
  enabled INTEGER DEFAULT 1
);
