// The visitor's email, kept apart from the free-text phone/contact field.
//
// The check-in form now asks for a first name, a last name, a phone number and
// an email separately. Only the first name is compulsory. The email is also the
// one the newsletter box uses: it cannot be ticked without a valid address.
export default `ALTER TABLE repair_jobs ADD COLUMN customer_email TEXT;
ALTER TABLE pre_registrations ADD COLUMN customer_email TEXT;`;
