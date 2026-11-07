// Clearing the records of one session, for testing a setup from scratch.
// The event itself and its QR code stay. See POST /api/admin/events/:id/clear.
import { beforeAll, describe, expect, it } from 'vitest';
import { call, freshHub, setUpHub } from './helpers.js';

beforeAll(freshHub);

async function makeRepairer(admin: string, email: string, displayName: string) {
  const user = await call('/api/admin/users', { token: admin, json: { email, displayName, role: 'repairer' } });
  const signedIn = await call(`/api/auth/reset/${user.body.resetToken}`, { json: { password: 'Soldering1Iron' } });
  return { id: user.body.user.id as string, token: signedIn.body.accessToken as string };
}

describe('clearing an event', () => {
  let admin = '';
  let repairer: { id: string; token: string };
  let eventId = '';

  beforeAll(async () => {
    admin = (await setUpHub()).token;
    repairer = await makeRepairer(admin, 'clear-repairer@example.org', 'Ada Fixwell');
    const venueId = (await call('/api/admin/venues', { token: admin })).body[0].id;
    const date = new Date().toISOString().slice(0, 10);
    const event = await call('/api/admin/events', {
      token: admin,
      json: { name: 'Saturday session', venueId, date, startTime: '10:00', endTime: '13:00', isPublished: true },
    });
    eventId = event.body.id;
    await call(`/api/admin/events/${eventId}/activate`, { method: 'POST', token: admin });

    for (const item of ['Kettle', 'Toaster']) {
      const job = await call('/api/repairer/checkin', {
        token: repairer.token,
        json: { itemDescription: item, faultDescription: 'Dead' },
      });
      expect(job.status).toBe(200);
    }

    await call(`/api/admin/events/${eventId}/attendance`, {
      method: 'PUT',
      token: admin,
      json: { repairers: [{ userId: repairer.id, confirmed: true }] },
    });
  });

  it('is for admins only', async () => {
    const res = await call(`/api/admin/events/${eventId}/clear`, { method: 'POST', token: repairer.token, json: {} });
    expect(res.status).toBe(403);
  });

  it('removes the repairs but keeps the session and the attendance list', async () => {
    const before = await call(`/api/admin/events/${eventId}`, { token: admin });
    expect(before.body.jobs).toHaveLength(2);
    expect(before.body.attending).toHaveLength(1);

    const cleared = await call(`/api/admin/events/${eventId}/clear`, { method: 'POST', token: admin, json: {} });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ ok: true, repairs: 2 });

    const after = await call(`/api/admin/events/${eventId}`, { token: admin });
    expect(after.status).toBe(200);
    expect(after.body.event.name).toBe('Saturday session');
    expect(after.body.jobs).toEqual([]);
    // The people who signed up for the session are still on it.
    expect(after.body.attending).toHaveLength(1);

    const queue = await call('/api/repairer/active-event', { token: repairer.token });
    expect(queue.body.event.id).toBe(eventId);
    expect(queue.body.jobs).toEqual([]);

    const list = await call(`/api/admin/repairs?eventId=${eventId}`, { token: admin });
    expect(list.body.meta.total).toBe(0);
  });

  it('lets the now-empty session be deleted', async () => {
    const res = await call(`/api/admin/events/${eventId}`, { method: 'DELETE', token: admin });
    expect(res.status).toBe(200);
    expect((await call(`/api/admin/events/${eventId}`, { token: admin })).status).toBe(404);
  });

  it('removes pre-registrations too, without removing the session', async () => {
    await call('/api/admin/settings/preferences', {
      method: 'PATCH',
      token: admin,
      json: { preRegistrationEnabled: true },
    });
    const venueId = (await call('/api/admin/venues', { token: admin })).body[0].id;
    const future = new Date();
    future.setDate(future.getDate() + 14);
    const created = await call('/api/admin/events', {
      token: admin,
      json: {
        name: 'Next session',
        venueId,
        date: future.toISOString().slice(0, 10),
        startTime: '10:00',
        endTime: '13:00',
        isPublished: true,
      },
    });
    const id = created.body.id;

    const pre = await call(`/api/public/events/${id}/pre-register`, {
      json: { customerName: 'Sam Visitor', gdprConsent: true, itemDescription: 'Radio', faultDescription: 'Silent' },
    });
    expect(pre.status).toBe(200);

    const cleared = await call(`/api/admin/events/${id}/clear`, { method: 'POST', token: admin, json: {} });
    expect(cleared.status).toBe(200);
    expect(cleared.body.preRegistrations).toBe(1);

    const list = await call('/api/repairer/pre-registrations', { token: repairer.token });
    expect((list.body.items as any[]).filter((i) => i.event.id === id)).toEqual([]);
    expect((await call(`/api/admin/events/${id}`, { token: admin })).status).toBe(200);
  });
});
