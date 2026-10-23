import type { App } from '../../lib/router.js';
import { execute } from '../../db/index.js';
import { sql } from 'drizzle-orm';

// =============================================================================
//  Newsletter export
//  ---------------------------------------------------------------------------
//  Yapla Newsletters has no public API (and the Yapla API itself starts on the
//  Plus plan), so the last step is a paste into its import screen. This endpoint
//  produces exactly the two columns that screen expects: `email` and an
//  attribute column, here `Newsletter = yes`.
//
//  Only people who explicitly ticked the newsletter box are included. The
//  address is de-duplicated (one person may have brought several items, or come
//  back on another day), and the optional `since` keeps an export to the people
//  who opted in after a given date.
// =============================================================================

function parseSince(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function optedIn(sinceMs: number | null) {
  const rows = await execute<{ email: string; at: number | null }>(sql`
    SELECT lower(trim(newsletter_email)) AS email, MAX(newsletter_opt_in_at) AS at
    FROM (
      SELECT newsletter_email, newsletter_opt_in, newsletter_opt_in_at FROM repair_jobs
      UNION ALL
      SELECT newsletter_email, newsletter_opt_in, newsletter_opt_in_at FROM pre_registrations
    )
    WHERE newsletter_opt_in = 1
      AND newsletter_email IS NOT NULL
      AND trim(newsletter_email) <> ''
      ${sinceMs !== null ? sql`AND newsletter_opt_in_at >= ${sinceMs}` : sql``}
    GROUP BY lower(trim(newsletter_email))
    ORDER BY email
  `);
  return rows.rows;
}

export async function adminNewsletterRoutes(app: App): Promise<void> {
  app.get('/api/admin/newsletter', async (request) => {
    const query = request.query as { since?: string };
    const sinceMs = parseSince(query.since);
    const rows = await optedIn(sinceMs);
    const last = rows.reduce((latest, row) => Math.max(latest, row.at ?? 0), 0);
    return {
      count: rows.length,
      since: sinceMs !== null ? query.since : null,
      lastOptInAt: last > 0 ? last : null,
    };
  });

  app.get('/api/admin/newsletter/export.csv', async (request, reply) => {
    const query = request.query as { since?: string };
    const rows = await optedIn(parseSince(query.since));
    // Yapla's importer wants a first `email` column and one column per contact
    // group. This is the group the cafe keeps its subscribers in.
    const lines = ['email,Newsletter', ...rows.map((row) => `${row.email},yes`)];
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="newsletter.csv"');
    return '\uFEFF' + lines.join('\n') + '\n';
  });
}
