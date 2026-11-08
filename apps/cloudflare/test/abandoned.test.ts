// The "left / gave up" outcome: the visitor went before the repair finished.
import { beforeAll, describe, expect, it } from 'vitest';
import { call, freshHub, setUpHub } from './helpers.js';

beforeAll(freshHub);

describe('a visitor who left', () => {
  let admin = '';
  let repairer: { id: string; token: string };
  let eventId = '';

  beforeAll(async () => {
    admin = (await setUpHub()).token;
    await call('/api/admin/settings/preferences', {
      method: 'PATCH',
      token: admin,
      json: { cardNumbersEnabled: true },
    });
    const venueId = (await call('/api/admin/venues', { token: admin })).body[0].id;
    const date = new Date().toISOString().slice(0, 10);
    const event = await call('/api/admin/events', {
      token: admin,
      json: { name: 'Saturday session', venueId, date, startTime: '10:00', endTime: '13:00', isPublished: true },
    });
    eventId = event.body.id;
    await call(`/api/admin/events/${eventId}/activate`, { method: 'POST', token: admin });

    const user = await call('/api/admin/users', {
      token: admin,
      json: { email: 'left-repairer@example.org', displayName: 'Ada Fixwell', role: 'repairer' },
    });
    const signedIn = await call(`/api/auth/reset/${user.body.resetToken}`, { json: { password: 'Soldering1Iron' } });
    repairer = { id: user.body.user.id, token: signedIn.body.accessToken };
  });

  it('closes the repair without counting it as one repaired', async () => {
    const job = await call('/api/repairer/checkin', {
      token: repairer.token,
      json: { itemDescription: 'Kettle', faultDescription: 'Dead' },
    });
    await call(`/api/repairer/jobs/${job.body.id}/accept`, { method: 'PATCH', token: repairer.token });
    const done = await call(`/api/repairer/jobs/${job.body.id}/complete`, {
      method: 'PATCH',
      token: repairer.token,
      json: { outcome: 'abandoned' },
    });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('abandoned');
    expect(done.body.completedAt).toBeTruthy();

    const me = await call(`/api/admin/users/${repairer.id}`, { token: admin });
    expect(me.body.repairCountCache).toBe(0);

    const active = await call('/api/repairer/active-event', { token: repairer.token });
    expect(active.body.counts.abandoned).toBe(1);

    const eventStats = await call(`/api/admin/stats/events/${eventId}`, { token: admin });
    expect(eventStats.body.totals.abandonedCount).toBe(1);

    const overview = await call('/api/admin/stats/overview?range=all', { token: admin });
    expect(overview.body.abandonedCount).toBe(1);
  });

  it('can be used for a waiting job too, with no repairer', async () => {
    const job = await call('/api/repairer/checkin', {
      token: repairer.token,
      json: { itemDescription: 'Lamp', faultDescription: 'Broken switch' },
    });
    const done = await call(`/api/repairer/jobs/${job.body.id}/complete`, {
      method: 'PATCH',
      token: repairer.token,
      json: { outcome: 'abandoned' },
    });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('abandoned');
    expect(done.body.repairerId).toBeNull();
    expect(done.body.completedAt).toBeTruthy();
  });

  it('keeps a numbered card out until it is handed back', async () => {
    const job = await call('/api/repairer/checkin', {
      token: repairer.token,
      json: { itemDescription: 'Toaster', faultDescription: 'Dead', cardNumber: 10 },
    });
    expect(job.status).toBe(200);
    await call(`/api/repairer/jobs/${job.body.id}/complete`, {
      method: 'PATCH',
      token: repairer.token,
      json: { outcome: 'abandoned' },
    });

    const reused = await call('/api/repairer/checkin', {
      token: repairer.token,
      json: { itemDescription: 'Radio', faultDescription: 'Silent', cardNumber: 10 },
    });
    expect(reused.status).toBe(409);

    await call(`/api/repairer/jobs/${job.body.id}/card-return`, {
      method: 'PATCH',
      token: repairer.token,
      json: { returned: true },
    });
    const after = await call('/api/repairer/checkin', {
      token: repairer.token,
      json: { itemDescription: 'Radio', faultDescription: 'Silent', cardNumber: 10 },
    });
    expect(after.status).toBe(200);
  });

  it('reopens cleanly from the admin form', async () => {
    const list = await call('/api/admin/repairs?status=abandoned', { token: admin });
    const job = list.body.data[0];
    const reopened = await call(`/api/admin/repairs/${job.id}`, {
      method: 'PATCH',
      token: admin,
      json: { status: 'waiting' },
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe('waiting');
    expect(reopened.body.completedAt).toBeNull();
  });
});
