// Money the visitor gives at the exit, recorded beside the satisfaction
// answer and the card hand-back. Optional: most repairs have no donation.
// Kept on the repair so a session can total what was given.
export default `ALTER TABLE repair_jobs ADD COLUMN donation_amount NUMERIC(10,2);`;
