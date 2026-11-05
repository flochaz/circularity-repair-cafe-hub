// A private link for the volunteer station. Open it on a shared tablet or
// phone, pick your name, and you are in the repair queue without a password.
// The token is random and can be replaced by an admin, like the waiting-room
// display link. Switched off until an admin turns it on.
export default `ALTER TABLE cafes ADD COLUMN station_token TEXT;
ALTER TABLE cafes ADD COLUMN station_enabled INTEGER NOT NULL DEFAULT 0;`;
