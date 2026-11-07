// Whether to ask for a donation at the exit. Off by default, so an updated
// hub does not suddenly show a money field. An admin turns it on under
// Settings → Check-in & preferences.
export default `ALTER TABLE cafes ADD COLUMN ask_donation_enabled INTEGER NOT NULL DEFAULT 0;`;
