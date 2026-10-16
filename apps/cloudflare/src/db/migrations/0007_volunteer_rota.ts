// A per-session sign-up board — the same idea as the Framadate poll a cafe
// often uses to work out who is coming and what they will do. The columns are
// roles or tasks ("Table d'accueil", "Installation salle", "Réparation", …) and
// each volunteer answers yes, if needed, or no for each one.
//
// One open link per session (on `events.signup_token`) lets people answer with
// no account. Each answer carries its own token, so the person can come back and
// change it — the way Framadate remembers your vote.
//
// `capacity` is how many helpers a role wants; the board shows when a role is
// short. It is nullable: "Réparation" takes as many as turn up.
export default `ALTER TABLE events ADD COLUMN signup_token TEXT;
ALTER TABLE events ADD COLUMN signup_open INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_signup_token ON events (signup_token);

CREATE TABLE IF NOT EXISTS event_roles (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  capacity INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_roles_event ON event_roles (event_id);

CREATE TABLE IF NOT EXISTS event_signups (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  comment TEXT,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_signups_event ON event_signups (event_id);

CREATE TABLE IF NOT EXISTS event_signup_choices (
  id TEXT PRIMARY KEY NOT NULL,
  signup_id TEXT NOT NULL REFERENCES event_signups(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES event_roles(id) ON DELETE CASCADE,
  choice TEXT NOT NULL,
  UNIQUE (signup_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_event_signup_choices_signup ON event_signup_choices (signup_id);
CREATE INDEX IF NOT EXISTS idx_event_signup_choices_role ON event_signup_choices (role_id);`;
