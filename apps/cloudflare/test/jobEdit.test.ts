// Correcting a repair after it was registered, whatever its status. See
// PATCH /api/repairer/jobs/:id in routes/repairer.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { call, freshHub, setUpHub } from './helpers.js';

beforeAll(freshHub);

describe('editing a repair', () => {
  let admin = '';
  let repairer = '';
  let otherRepairer = '';
  let jobId = '';
  let secondId = '';

  beforeAll(async () => {
    admin = (await setUpHub()).token;
    const venueId = (await call('/api/admin/venues', { token: admin })).body[0].id;
    const date = new Date().toISOString().slice(0, 10);
    const event = await call('/api/admin/events', {
      token: admin,
      json: { name: 'Saturday session', venueId, date, startTime: '10:00', endTime: '13:00', isPublished: true },
    });
    await call(`/api/admin/events/${event.body.id}/activate`, { method: 'POST', token: admin });
    await call('/api/admin/settings/preferences', {
      method: 'PATCH',
      token: admin,
      json: { cardNumbersEnabled: true },
    });

    async function makeRepairer(email: string, displayName: string) {
      const user = await call('/api/admin/users', { token: admin, json: { email, displayName, role: 'repairer' } });
      const signedIn = await call(`/api/auth/reset/${user.body.resetToken}`, { json: { password: 'Soldering1Iron' } });
      return signedIn.body.accessToken as string;
    }
    repairer = await makeRepairer('edit-repairer@example.org', 'Ada Fixwell');
    otherRepairer = await makeRepairer('edit-other@example.org', 'Ben Spanner');

    const first = await call('/api/repairer/checkin', {
      token: repairer,
      json: {
        itemDescription: 'Kettle',
        faultDescription: 'Dead',
        customerName: 'Sam Visitor',
        gdprConsent: true,
        cardNumber: 7,
      },
    });
    expect(first.status).toBe(200);
    jobId = first.body.id;

    const second = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Toaster', faultDescription: 'Dead', cardNumber: 8 },
    });
    expect(second.status).toBe(200);
    secondId = second.body.id;
  });

  it('lets any member of staff correct the registered details', async () => {
    const res = await call(`/api/repairer/jobs/${jobId}`, {
      method: 'PATCH',
      token: otherRepairer,
      json: {
        itemDescription: 'Coffee machine',
        itemBrand: 'DeLonghi',
        faultDescription: 'Leaks from the bottom',
        itemCategoryId: null,
        customerName: 'Sam Visitor',
        customerContact: '0600000000',
        customerEmail: 'Sam@Example.org',
        weightKg: 2.5,
        isFirstVisit: true,
        cardNumber: 9,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      itemDescription: 'Coffee machine',
      itemBrand: 'DeLonghi',
      faultDescription: 'Leaks from the bottom',
      customerName: 'Sam Visitor',
      customerContact: '0600000000',
      customerEmail: 'sam@example.org',
      cardNumber: 9,
      isFirstVisit: true,
      // Editing the record does not change where the repair is.
      status: 'waiting',
      repairerId: null,
    });
    expect(Number(res.body.weightKg)).toBe(2.5);
  });

  it('still works after the repair is finished', async () => {
    await call(`/api/repairer/jobs/${jobId}/accept`, { method: 'PATCH', token: repairer });
    const done = await call(`/api/repairer/jobs/${jobId}/complete`, {
      method: 'PATCH',
      token: repairer,
      json: { outcome: 'completed' },
    });
    expect(done.status).toBe(200);

    const res = await call(`/api/repairer/jobs/${jobId}`, {
      method: 'PATCH',
      token: repairer,
      json: {
        itemDescription: 'Coffee machine (fixed)',
        faultDescription: 'Leaked from the bottom',
        customerName: 'Sam Visitor',
        cardNumber: 9,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.itemDescription).toBe('Coffee machine (fixed)');
    expect(res.body.status).toBe('completed');
    expect(res.body.completedAt).toBeTruthy();
  });

  it('refuses a card number another open repair is using', async () => {
    const third = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Radio', faultDescription: 'Dead', cardNumber: 10 },
    });
    expect(third.status).toBe(200);

    const clash = await call(`/api/repairer/jobs/${secondId}`, {
      method: 'PATCH',
      token: repairer,
      json: {
        itemDescription: 'Toaster',
        faultDescription: 'Dead',
        cardNumber: 10,
      },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('checkin/card_in_use');

    // Its own number is fine.
    const own = await call(`/api/repairer/jobs/${secondId}`, {
      method: 'PATCH',
      token: repairer,
      json: {
        itemDescription: 'Toaster',
        faultDescription: 'Dead',
        cardNumber: 8,
      },
    });
    expect(own.status).toBe(200);
  });

  it('validates the item, the email and the card range', async () => {
    const base = {
      itemDescription: 'Toaster',
      faultDescription: 'Dead',
      cardNumber: 8,
    };
    expect((await call(`/api/repairer/jobs/${secondId}`, { method: 'PATCH', token: repairer, json: { ...base, itemDescription: '' } })).status).toBe(400);
    expect((await call(`/api/repairer/jobs/${secondId}`, { method: 'PATCH', token: repairer, json: { ...base, faultDescription: '' } })).status).toBe(400);
    expect((await call(`/api/repairer/jobs/${secondId}`, { method: 'PATCH', token: repairer, json: { ...base, customerEmail: 'not-an-email' } })).status).toBe(400);
    expect((await call(`/api/repairer/jobs/${secondId}`, { method: 'PATCH', token: repairer, json: { ...base, cardNumber: 0 } })).status).toBe(400);
    expect((await call(`/api/repairer/jobs/${secondId}`, { method: 'PATCH', token: repairer, json: { ...base, weightKg: -1 } })).status).toBe(400);
  });
});
