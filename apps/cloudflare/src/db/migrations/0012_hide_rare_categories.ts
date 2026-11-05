// Hide the two categories that did not fit a typical repair cafe's check-in
// list: jewellery and furniture. They are deactivated rather than deleted, so
// a cafe can turn them back on in the admin, and older repairs keep their
// category. New hubs simply start without them (see DEFAULT_CATEGORIES).
export default `UPDATE skill_categories SET is_active = 0 WHERE name IN ('Jewellery', 'Furniture & wood');`;
