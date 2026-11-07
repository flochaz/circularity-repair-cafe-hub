// The routes whose UI is translated. Public pages and the admin area are
// English-only, so they stay `en` even when the language cookie says French.
// Shared by the server hook (which sets <html lang>) and the root layout
// (which follows the same rule during client-side navigation).
export const TRANSLATED_ROUTE = /^\/(checkin|track|repairer|login|reset|rota|display|station)(\/|$)/;
