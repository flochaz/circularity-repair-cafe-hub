// Newsletter opt-in, collected at check-in or pre-registration.
//
// The repair itself needs only consent to store the details ("gdpr_consent").
// Sending a newsletter is different: it needs its own, explicit consent, given
// knowingly (not pre-ticked) and with a date to prove it. Keeping it on the
// repair rather than only in Yapla means the cafe can export exactly the people
// who agreed, and can show when they did.
//
// The email is stored separately from the free-text contact: a visitor may give
// a phone number as their contact, and that cannot be used for a newsletter.
export default `ALTER TABLE repair_jobs ADD COLUMN newsletter_email TEXT;
ALTER TABLE repair_jobs ADD COLUMN newsletter_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE repair_jobs ADD COLUMN newsletter_opt_in_at INTEGER;
ALTER TABLE pre_registrations ADD COLUMN newsletter_email TEXT;
ALTER TABLE pre_registrations ADD COLUMN newsletter_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pre_registrations ADD COLUMN newsletter_opt_in_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_repair_jobs_newsletter_opt_in ON repair_jobs (newsletter_opt_in);`;
