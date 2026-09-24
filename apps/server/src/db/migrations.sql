CREATE TABLE IF NOT EXISTS players (
	id UUID PRIMARY KEY,
	display_name VARCHAR(24) NOT NULL,
	account_email TEXT UNIQUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE players
ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE players
ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS players_account_email_lower_uidx ON players (lower(account_email))
WHERE
	account_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS player_sessions (
	session_hash CHAR(64) PRIMARY KEY,
	session_id UUID NOT NULL UNIQUE,
	player_id UUID NOT NULL REFERENCES players (id) ON DELETE CASCADE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS player_sessions_player_idx ON player_sessions (player_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
	token_hash CHAR(64) PRIMARY KEY,
	player_id UUID NOT NULL REFERENCES players (id) ON DELETE CASCADE,
	purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	expires_at TIMESTAMPTZ NOT NULL,
	consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS runs (
	id UUID PRIMARY KEY,
	player_id UUID NOT NULL REFERENCES players (id),
	seed INTEGER NOT NULL,
	weapon_id VARCHAR(24) NOT NULL,
	status VARCHAR(16) NOT NULL,
	outcome VARCHAR(16),
	elapsed_ms INTEGER,
	rooms_cleared INTEGER NOT NULL DEFAULT 0,
	enemies_defeated INTEGER NOT NULL DEFAULT 0,
	zones_cleared INTEGER NOT NULL DEFAULT 0,
	guardians_defeated INTEGER NOT NULL DEFAULT 0,
	extracted_loot_value INTEGER NOT NULL DEFAULT 0,
	time_remaining_ms INTEGER NOT NULL DEFAULT 0,
	active_play_ms INTEGER NOT NULL DEFAULT 0,
	score INTEGER NOT NULL DEFAULT 0,
	verified BOOLEAN NOT NULL DEFAULT FALSE,
	verification_flags JSONB NOT NULL DEFAULT '[]',
	accepted_rewards JSONB NOT NULL DEFAULT '[]',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	finished_at TIMESTAMPTZ
);

ALTER TABLE runs
ADD COLUMN IF NOT EXISTS zones_cleared INTEGER NOT NULL DEFAULT 0;

ALTER TABLE runs
ADD COLUMN IF NOT EXISTS guardians_defeated INTEGER NOT NULL DEFAULT 0;

ALTER TABLE runs
ADD COLUMN IF NOT EXISTS extracted_loot_value INTEGER NOT NULL DEFAULT 0;

ALTER TABLE runs
ADD COLUMN IF NOT EXISTS time_remaining_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE runs
ADD COLUMN IF NOT EXISTS active_play_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE runs
ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;

ALTER TABLE runs
ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE runs
ADD COLUMN IF NOT EXISTS verification_flags JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS player_regions (
	player_id UUID PRIMARY KEY REFERENCES players (id),
	country_code CHAR(2) NOT NULL,
	region_code VARCHAR(12) NOT NULL,
	effective_from TIMESTAMPTZ NOT NULL DEFAULT date_trunc('week', now()) + interval '1 week',
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_events (
	run_id UUID NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
	sequence INTEGER NOT NULL,
	tick INTEGER NOT NULL,
	event_type VARCHAR(32) NOT NULL,
	zone_index SMALLINT NOT NULL,
	room_id TEXT,
	payload JSONB NOT NULL DEFAULT '{}',
	previous_hash TEXT NOT NULL,
	event_hash TEXT NOT NULL,
	PRIMARY KEY (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS discovered_emblems (
	player_id UUID NOT NULL REFERENCES players (id),
	emblem_id TEXT NOT NULL,
	first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (player_id, emblem_id)
);

CREATE TABLE IF NOT EXISTS unlocks (
	player_id UUID NOT NULL REFERENCES players (id),
	unlock_id TEXT NOT NULL,
	unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (player_id, unlock_id)
);

CREATE TABLE IF NOT EXISTS pvp_matches (
	id UUID PRIMARY KEY,
	player_a UUID NOT NULL REFERENCES players (id),
	player_b UUID NOT NULL REFERENCES players (id),
	winner_id UUID REFERENCES players (id),
	status VARCHAR(16) NOT NULL,
	ended_by VARCHAR(24),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	finished_at TIMESTAMPTZ
);

ALTER TABLE pvp_matches
ADD COLUMN IF NOT EXISTS room_seed INTEGER;

ALTER TABLE pvp_matches
ADD COLUMN IF NOT EXISTS room_definition JSONB;

ALTER TABLE pvp_matches
ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES runs (id);

CREATE INDEX IF NOT EXISTS runs_player_created_idx ON runs (player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS runs_ranking_idx ON runs (verified, score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS pvp_status_idx ON pvp_matches (status);

CREATE INDEX IF NOT EXISTS player_regions_lookup_idx ON player_regions (country_code, region_code, effective_from);

CREATE TABLE IF NOT EXISTS player_region_history (
	player_id UUID NOT NULL REFERENCES players (id) ON DELETE CASCADE,
	country_code CHAR(2) NOT NULL,
	region_code VARCHAR(12) NOT NULL,
	effective_from TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (player_id, effective_from)
);

INSERT INTO
	player_region_history (
		player_id,
		country_code,
		region_code,
		effective_from
	)
SELECT
	player_id,
	country_code,
	region_code,
	effective_from
FROM
	player_regions
ON CONFLICT (player_id, effective_from) DO NOTHING;

CREATE INDEX IF NOT EXISTS player_region_history_lookup_idx ON player_region_history (country_code, region_code, effective_from);
