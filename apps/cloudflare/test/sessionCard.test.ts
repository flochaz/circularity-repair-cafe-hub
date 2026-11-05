// Session card numbers: a short number on the job, unique among the open jobs
// in an event, so a reusable card can be handed out and called back. See
// migrations/0006_session_card_number.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { call, freshHub, setUpHub } from './helpers.js';

beforeAll(freshHub);

describe('session card numbers', () => {
  let admin = '';
  let repairer = '';
  let firstId = '';
  let reuseId = '';
  let firstCustomerToken = '';

  it('keeps a number unique among open jobs, and frees it when the job closes', async () => {
    admin = (await setUpHub()).token;
    const venueId = (await call('/api/admin/venues', { token: admin })).body[0].id;
    const date = new Date().toISOString().slice(0, 10);
    const created = await call('/api/admin/events', {
      token: admin,
      json: { name: 'Saturday session', venueId, date, startTime: '10:00', endTime: '13:00', isPublished: true },
    });
    await call(`/api/admin/events/${created.body.id}/activate`, { method: 'POST', token: admin });

    const user = await call('/api/admin/users', {
      token: admin,
      json: { email: 'fixer@example.org', displayName: 'Ada Fixwell', role: 'repairer' },
    });
    repairer = (await call(`/api/auth/reset/${user.body.resetToken}`, { json: { password: 'Soldering1Iron' } })).body
      .accessToken;

    // Cards start switched off, and a number sent anyway is ignored.
    const ignored = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Clock', faultDescription: 'Stopped', cardNumber: 3 },
    });
    expect(ignored.status).toBe(200);
    expect((await call(`/api/admin/repairs/${ignored.body.id}`, { token: admin })).body.job.cardNumber).toBeNull();
    await call('/api/admin/settings/preferences', { method: 'PATCH', token: admin, json: { cardNumbersEnabled: true } });

    const first = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Kettle', faultDescription: 'Dead', cardNumber: 7 },
    });
    expect(first.status).toBe(200);

    const stored = await call(`/api/admin/repairs/${first.body.id}`, { token: admin });
    expect(stored.body.job.cardNumber).toBe(7);
    firstId = first.body.id;
    firstCustomerToken = first.body.customerToken;

    // The check-in page reads the numbers in use from the session's job list.
    const active = await call('/api/repairer/active-event', { token: repairer });
    expect(active.body.jobs.map((j: any) => j.cardNumber)).toContain(7);

    // The same number while the first job is open is refused.
    const clash = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Lamp', faultDescription: 'Broken', cardNumber: 7 },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('checkin/card_in_use');

    // A different number is fine; a number out of range is refused.
    const second = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Toaster', faultDescription: 'Dead', cardNumber: 8 },
    });
    expect(second.status).toBe(200);
    const bad = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Radio', faultDescription: 'Dead', cardNumber: 0 },
    });
    expect(bad.status).toBe(400);

    // Close the first job, and its number can be handed out again.
    await call(`/api/repairer/jobs/${first.body.id}/accept`, { method: 'PATCH', token: repairer });
    await call(`/api/repairer/jobs/${first.body.id}/complete`, { method: 'PATCH', token: repairer, json: { outcome: 'completed' } });
    const reuse = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Fan', faultDescription: 'Rattles', cardNumber: 7 },
    });
    expect(reuse.status).toBe(200);
    reuseId = reuse.body.id;
  });

  it('refuses a clash from the admin page with a clear message, not a server error', async () => {
    // Giving the toaster card 7, which the fan has.
    const jobs = (await call('/api/repairer/active-event', { token: repairer })).body.jobs;
    const toaster = jobs.find((j: any) => j.cardNumber === 8);
    const moved = await call(`/api/admin/repairs/${toaster.id}`, { method: 'PATCH', token: admin, json: { cardNumber: 7 } });
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe('checkin/card_in_use');

    // Opening the kettle again, while its card 7 is now with the fan.
    const reopened = await call(`/api/admin/repairs/${firstId}`, { method: 'PATCH', token: admin, json: { status: 'waiting' } });
    expect(reopened.status).toBe(409);

    // Saving the fan with its own number is fine.
    const same = await call(`/api/admin/repairs/${reuseId}`, { method: 'PATCH', token: admin, json: { cardNumber: 7 } });
    expect(same.status).toBe(200);
  });

  it('carries the card number to every screen that lists the job', async () => {
    const active = await call('/api/repairer/active-event', { token: repairer });
    const eventId = active.body.event.id;

    const detail = await call(`/api/repairer/jobs/${reuseId}`, { token: repairer });
    expect(detail.body.job.cardNumber).toBe(7);

    const history = await call('/api/repairer/history', { token: repairer });
    expect(history.body.data.find((r: any) => r.id === firstId).cardNumber).toBe(7);

    const list = await call('/api/admin/repairs', { token: admin });
    expect(list.body.data.find((r: any) => r.id === reuseId).cardNumber).toBe(7);

    const adminDetail = await call(`/api/admin/repairs/${reuseId}`, { token: admin });
    expect(adminDetail.body.job.cardNumber).toBe(7);

    const event = await call(`/api/admin/events/${eventId}`, { token: admin });
    expect(event.body.jobs.find((j: any) => j.id === reuseId).cardNumber).toBe(7);

    const dashboard = await call('/api/admin/dashboard', { token: admin });
    expect(dashboard.body.activeJobs.find((j: any) => j.id === reuseId).cardNumber).toBe(7);

    const stats = await call(`/api/admin/stats/events/${eventId}`, { token: admin });
    expect(stats.body.jobs.find((j: any) => j.id === reuseId).cardNumber).toBe(7);

    const track = await call(`/api/track/${firstCustomerToken}`);
    expect(track.body.jobs.find((j: any) => j.id === firstId).cardNumber).toBe(7);
  });

  it('shows the card number on the waiting-room display', async () => {
    const link = await call('/api/admin/display-link', { token: admin });
    const shown = await call(`/api/display/${link.body.token}`);
    const numbers = shown.body.jobs.map((j: any) => j.cardNumber);
    expect(numbers).toContain(8);
  });
});
