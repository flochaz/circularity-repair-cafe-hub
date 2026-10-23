// Newsletter consent and the export that feeds Yapla: only people who ticked
// the box are included, once each, whatever they typed as their repair contact.
import { beforeAll, describe, expect, it } from 'vitest';
import { call, freshHub, setUpHub } from './helpers.js';

const today = new Date().toISOString().slice(0, 10);

let admin = '';
let checkInToken = '';

beforeAll(async () => {
  await freshHub();
  const setup = await setUpHub();
  admin = setup.token;
  const venues = await call('/api/admin/venues', { token: admin });
  const created = await call('/api/admin/events', {
    token: admin,
    json: {
      name: 'Newsletter session',
      venueId: venues.body[0].id,
      date: today,
      startTime: '10:00',
      endTime: '13:00',
      isPublished: true,
    },
  });
  checkInToken = created.body.checkInToken;
  await call(`/api/admin/events/${created.body.id}/activate`, { method: 'POST', token: admin });
});

function checkIn(extra: Record<string, unknown> = {}) {
  return call(`/api/checkin/${checkInToken}/jobs`, {
    json: {
      customerName: 'Sam',
      gdprConsent: true,
      itemDescription: 'Toaster',
      faultDescription: 'Dead',
      ...extra,
    },
  });
}

describe('newsletter opt-in', () => {
  it('stores consent and exports each opted-in address once', async () => {
    expect((await checkIn({ newsletterOptIn: true, newsletterEmail: 'Visitor@Example.org' })).status).toBe(200);
    expect((await checkIn({ newsletterOptIn: false })).status).toBe(200);
    // The same person on another item: same address, stored in another case.
    expect((await checkIn({ newsletterOptIn: true, newsletterEmail: 'visitor@example.org' })).status).toBe(200);

    const summary = await call('/api/admin/newsletter', { token: admin });
    expect(summary.status).toBe(200);
    expect(summary.body.count).toBe(1);

    const csv = await call('/api/admin/newsletter/export.csv', { token: admin });
    expect(csv.status).toBe(200);
    const text = await csv.raw.text();
    expect(text.split('\n')[0]).toContain('email,Newsletter');
    expect(text).toContain('visitor@example.org,yes');
    expect(text.match(/visitor@example\.org/g)?.length).toBe(1);
  });

  it('refuses an opt-in without an email', async () => {
    const res = await checkIn({ newsletterOptIn: true, newsletterEmail: null });
    expect(res.status).toBe(400);
  });

  it('keeps the export to admins', async () => {
    expect((await call('/api/admin/newsletter')).status).toBe(401);
    expect((await call('/api/admin/newsletter/export.csv')).status).toBe(401);
  });

  it('can limit the export to recent opt-ins', async () => {
    const recent = await call(`/api/admin/newsletter?since=${today}`, { token: admin });
    expect(recent.body.count).toBe(1);
    const older = await call('/api/admin/newsletter?since=2000-01-01', { token: admin });
    expect(older.body.count).toBe(1);
  });
});
