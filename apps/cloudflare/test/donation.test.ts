// Money given at the exit, recorded on the finished repair. The session and
// period reports add it up. See migration 0015 and
// PATCH /api/repairer/jobs/:id/donation.
import { beforeAll, describe, expect, it } from 'vitest';
import { call, freshHub, setUpHub } from './helpers.js';

beforeAll(freshHub);

describe('donations at the exit', () => {
  let admin = '';
  let repairer = '';
  let otherRepairer = '';
  let jobId = '';
  let eventId = '';

  beforeAll(async () => {
    admin = (await setUpHub()).token;
    const venueId = (await call('/api/admin/venues', { token: admin })).body[0].id;
    const date = new Date().toISOString().slice(0, 10);
    const event = await call('/api/admin/events', {
      token: admin,
      json: { name: 'Saturday session', venueId, date, startTime: '10:00', endTime: '13:00', isPublished: true },
    });
    eventId = event.body.id;
    await call(`/api/admin/events/${eventId}/activate`, { method: 'POST', token: admin });

    async function makeRepairer(email: string, displayName: string) {
      const user = await call('/api/admin/users', { token: admin, json: { email, displayName, role: 'repairer' } });
      const signedIn = await call(`/api/auth/reset/${user.body.resetToken}`, { json: { password: 'Soldering1Iron' } });
      return signedIn.body.accessToken as string;
    }
    repairer = await makeRepairer('donation-repairer@example.org', 'Ada Fixwell');
    otherRepairer = await makeRepairer('donation-other@example.org', 'Ben Spanner');

    const job = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Kettle', faultDescription: 'Dead' },
    });
    jobId = job.body.id;
    await call(`/api/repairer/jobs/${jobId}/accept`, { method: 'PATCH', token: repairer });
    await call(`/api/repairer/jobs/${jobId}/complete`, { method: 'PATCH', token: repairer, json: { outcome: 'completed' } });
  });

  it('is off by default, and can be switched on by an admin', async () => {
    let profile = await call('/api/public/cafe');
    expect(profile.body.askDonationEnabled).toBe(false);
    const on = await call('/api/admin/settings/preferences', {
      method: 'PATCH',
      token: admin,
      json: { askDonationEnabled: true },
    });
    expect(on.status).toBe(200);
    profile = await call('/api/public/cafe');
    expect(profile.body.askDonationEnabled).toBe(true);
  });

  it('records money given at the exit, and adds it up for the session', async () => {
    const saved = await call(`/api/repairer/jobs/${jobId}/donation`, {
      method: 'PATCH',
      token: otherRepairer,
      json: { amount: 12.5 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.donationAmount).toBe('12.50');

    const active = await call('/api/repairer/active-event', { token: repairer });
    expect(active.body.donationsTotal).toBe(12.5);

    const eventStats = await call(`/api/admin/stats/events/${eventId}`, { token: admin });
    expect(eventStats.body.totals.donations).toBe(12.5);

    const overview = await call('/api/admin/stats/overview?range=all', { token: admin });
    expect(overview.body.donations).toBe(12.5);

    const detail = await call(`/api/admin/repairs/${jobId}`, { token: admin });
    expect(detail.body.job.donationAmount).toBe('12.50');

    const csv = await (await call('/api/admin/repairs/export.csv', { token: admin })).raw.text();
    expect(csv.split('\n')[0]).toContain('donationAmount');
    expect(csv).toContain('12.50');
  });

  it('can be corrected or cleared', async () => {
    const changed = await call(`/api/admin/repairs/${jobId}`, {
      method: 'PATCH',
      token: admin,
      json: { donationAmount: 20 },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.donationAmount).toBe('20.00');

    const cleared = await call(`/api/repairer/jobs/${jobId}/donation`, {
      method: 'PATCH',
      token: repairer,
      json: { amount: null },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.donationAmount).toBeNull();

    const active = await call('/api/repairer/active-event', { token: repairer });
    expect(active.body.donationsTotal).toBe(0);
  });

  it('refuses a negative, too large or non-numeric amount', async () => {
    for (const amount of [-1, 10000.01, 'twelve']) {
      const res = await call(`/api/repairer/jobs/${jobId}/donation`, {
        method: 'PATCH',
        token: repairer,
        json: { amount },
      });
      expect(res.status, String(amount)).toBe(400);
    }
    expect((await call(`/api/repairer/jobs/${jobId}/donation`, { method: 'PATCH', token: repairer, json: {} })).status).toBe(400);
  });
});
