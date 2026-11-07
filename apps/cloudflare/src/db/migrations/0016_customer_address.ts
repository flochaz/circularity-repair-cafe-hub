// Optional postal code and city for the visitor who brought the item. Kept on
// the repair as registered, and carried over when a pre-registration becomes a
// repair at check-in.
export default `ALTER TABLE repair_jobs ADD COLUMN customer_postal_code TEXT;
ALTER TABLE repair_jobs ADD COLUMN customer_city TEXT;
ALTER TABLE pre_registrations ADD COLUMN customer_postal_code TEXT;
ALTER TABLE pre_registrations ADD COLUMN customer_city TEXT;`;
