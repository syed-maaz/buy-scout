PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fetch_coverage (
  source TEXT NOT NULL,
  query_key TEXT NOT NULL,
  price_from INTEGER,
  price_to INTEGER,
  swept_to INTEGER NOT NULL DEFAULT 0,
  peeked_to INTEGER,
  last_mode TEXT,
  pages INTEGER NOT NULL DEFAULT 0,
  total_results INTEGER,
  last_fetched_at TEXT NOT NULL,
  PRIMARY KEY (source, query_key)
);

CREATE TABLE IF NOT EXISTS fetch_stats (
  source TEXT PRIMARY KEY,
  runs INTEGER NOT NULL DEFAULT 0,
  last_new INTEGER NOT NULL DEFAULT 0,
  last_known INTEGER NOT NULL DEFAULT 0,
  avg_new_per_page REAL,
  avg_new_ratio REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS criteria_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_criteria_active ON criteria_profiles(active) WHERE active = 1;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  note TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  pages INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  total_results INTEGER,
  integrity_json TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS raw_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  source TEXT NOT NULL,
  page INTEGER NOT NULL,
  url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  html_path TEXT NOT NULL,
  listing_count INTEGER NOT NULL,
  total_results INTEGER,
  UNIQUE(run_id, page)
);

CREATE TABLE IF NOT EXISTS raw_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  json_path TEXT NOT NULL,
  content_hash TEXT,
  UNIQUE(source, external_id, fetched_at)
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  price_eur REAL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  make TEXT,
  model TEXT,
  variant TEXT,
  first_registration TEXT,
  mileage_km INTEGER,
  fuel TEXT,
  transmission TEXT,
  power_kw INTEGER,
  power_ps INTEGER,
  body_type TEXT,
  seats INTEGER,
  doors INTEGER,
  price_median_eur REAL,
  commercial_only INTEGER,
  has_isofix INTEGER,
  hu_due TEXT,
  warranty INTEGER,
  carfax_url TEXT,
  description TEXT,
  equipment_json TEXT,
  red_flags_json TEXT,
  seller_type TEXT NOT NULL DEFAULT 'unknown',
  seller_name TEXT,
  city TEXT,
  zip TEXT,
  distance_km REAL,
  price_label TEXT,
  price_evaluation INTEGER,
  damaged INTEGER,
  summary TEXT,
  image_url TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  delisted_at TEXT,
  delist_reason TEXT,
  availability_checked_at TEXT,
  content_hash TEXT,
  raw_json TEXT NOT NULL,
  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price_eur);
CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city);
CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_listings_availability
  ON listings(delisted_at, COALESCE(availability_checked_at, last_seen_at));

CREATE TABLE IF NOT EXISTS raw_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  html_path TEXT NOT NULL,
  json_path TEXT NOT NULL,
  UNIQUE(source, external_id, fetched_at)
);

CREATE TABLE IF NOT EXISTS price_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  price_eur REAL,
  observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_obs_listing
  ON price_observations(listing_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS access_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  method TEXT NOT NULL,
  symptom TEXT,
  success INTEGER NOT NULL,
  http_status INTEGER,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_attempts_source ON access_attempts(source);
CREATE INDEX IF NOT EXISTS idx_access_attempts_symptom ON access_attempts(symptom);

CREATE TABLE IF NOT EXISTS user_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('inspect','watch','skip')),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_actions_listing ON user_actions(source, external_id);

CREATE TABLE IF NOT EXISTS listing_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  model TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS saved_listings (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);

CREATE TABLE IF NOT EXISTS seller_messages (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  language TEXT NOT NULL,
  detected_language TEXT,
  message_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);

CREATE TABLE IF NOT EXISTS listing_research (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  model TEXT NOT NULL,
  basis TEXT NOT NULL,
  research_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);

CREATE TABLE IF NOT EXISTS laya_classifications (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  model TEXT NOT NULL,
  laya_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);

CREATE TABLE IF NOT EXISTS memory_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_decisions (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT,
  confidence REAL,
  evidence_json TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL REFERENCES brain_decisions(id),
  source TEXT,
  external_id TEXT,
  outcome TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_priors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  context TEXT NOT NULL,
  alpha REAL NOT NULL DEFAULT 1,
  beta REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(strategy, context)
);

CREATE TABLE IF NOT EXISTS rule_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  rule TEXT NOT NULL,
  evidence TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_cards_scope_rule ON rule_cards(scope, rule);
