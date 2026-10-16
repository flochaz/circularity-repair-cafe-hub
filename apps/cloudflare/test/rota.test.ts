// The volunteer sign-up board: an organiser opens it on a session, volunteers
// answer through the open link with no account, and the organiser reads the
// summary, exports it and closes it.
import { beforeAll, describe, expect, it } from 'vitest';
import { call, freshHub, setUpHub } from './helpers.js';

const today = new Date().toISOString().slice(0, 10);

const state: {
  admin?: string;
  venueId?: string;
  eventId?: string;
  token?: string;
  signupId?: string;
  editToken?: string;
  roleId?: string;
} = {};

beforeAll(freshHub);

describe('the volunteer sign-up board', () => {
  it('sets up a hub and a session', async () => {
    const { token } = await setUpHub();
    state.admin = token;
    const venues = await call('/api/admin/venues', { token: state.admin });
    state.venueId = venues.body[0].id;
    const created = await call('/api/admin/events', {
      token: state.admin,
      json: { name: 'October Repair Café', venueId: state.venueId, date: today, startTime: '10:00', endTime: '13:00', isPublished: true },
    });
    expect(created.status).toBe(200);
    state.eventId = created.body.id;
  });

  it('starts with no board', async () => {
    const res = await call(`/api/admin/events/${state.eventId}/rota`, { token: state.admin });
    expect(res.status).toBe(200);
    expect(res.body.signupToken).toBeNull();
    expect(res.body.shareUrl).toBeNull();
    expect(res.body.roles).toEqual([]);
  });

  it('opens the board with the usual roles', async () => {
    const res = await call(`/api/admin/events/${state.eventId}/rota/open`, {
      token: state.admin,
      json: { open: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.open).toBe(true);
    expect(res.body.signupToken).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(res.body.shareUrl).toContain(`/rota/${res.body.signupToken}`);
    expect(res.body.roles.length).toBe(7);
    state.token = res.body.signupToken;
  });

  it('shows the board through the open link, with no account', async () => {
    const res = await call(`/api/rota/${state.token}`);
    expect(res.status).toBe(200);
    expect(res.body.open).toBe(true);
    expect(res.body.roles.length).toBe(7);
    expect(res.body.signups).toEqual([]);
  });

  it('takes an answer and remembers it with a private token', async () => {
    const roleId = (await call(`/api/rota/${state.token}`)).body.roles[2].id;
    state.roleId = roleId;
    const res = await call(`/api/rota/${state.token}/signups`, {
      json: {
        name: 'Nicole',
        comment: 'Avec plaisir',
        choices: [{ roleId, choice: 'yes' }],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.signupId).toBeTruthy();
    expect(res.body.editToken).toMatch(/^[A-Za-z0-9_-]+$/);
    state.signupId = res.body.signupId;
    state.editToken = res.body.editToken;
    expect(res.body.signups.length).toBe(1);
    expect(res.body.summary[roleId].yes).toBe(1);
  });

  it('lets the same person change their answer with their token', async () => {
    const res = await call(`/api/rota/${state.token}/signups/${state.editToken}`, {
      method: 'PUT',
      json: { name: 'Nicole M', comment: null, choices: [{ roleId: state.roleId, choice: 'if_needed' }] },
    });
    expect(res.status).toBe(200);
    expect(res.body.signups[0].name).toBe('Nicole M');
    expect(res.body.summary[state.roleId!].ifNeeded).toBe(1);
    // An unknown token is refused.
    const bad = await call(`/api/rota/${state.token}/signups/not-a-real-token`, {
      method: 'PUT',
      json: { name: 'X', choices: [] },
    });
    expect(bad.status).toBe(404);
  });

  it('lets a volunteer pick themselves from the list, and refuses a stranger', async () => {
    const board = await call(`/api/rota/${state.token}`);
    expect(board.body.volunteers.length).toBeGreaterThan(0);
    const me = board.body.volunteers[0];
    const res = await call(`/api/rota/${state.token}/signups`, {
      json: { userId: me.id, choices: [{ roleId: state.roleId, choice: 'yes' }] },
    });
    expect(res.status).toBe(200);
    const added = res.body.signups.find((s: any) => s.userId === me.id);
    expect(added.name).toBe(me.name);
    // Tidy up so the rest of the flow sees exactly one answer.
    await call(`/api/rota/${state.token}/signups/${res.body.editToken}`, { method: 'DELETE' });

    const stranger = await call(`/api/rota/${state.token}/signups`, {
      json: { userId: '00000000-0000-4000-8000-000000000000', choices: [] },
    });
    expect(stranger.status).toBe(400);
  });

  it('lets the organiser edit the roles', async () => {
    const added = await call(`/api/admin/events/${state.eventId}/rota/roles`, {
      token: state.admin,
      json: { label: 'Rangement', capacity: 3 },
    });
    expect(added.status).toBe(200);
    const renamed = await call(`/api/admin/events/${state.eventId}/rota/roles/${added.body.id}`, {
      method: 'PATCH',
      token: state.admin,
      json: { capacity: 4 },
    });
    expect(renamed.body.capacity).toBe(4);
    const removed = await call(`/api/admin/events/${state.eventId}/rota/roles/${added.body.id}`, {
      method: 'DELETE',
      token: state.admin,
    });
    expect(removed.status).toBe(200);
    const board = await call(`/api/admin/events/${state.eventId}/rota`, { token: state.admin });
    expect(board.body.roles.length).toBe(7);
  });

  it('draws a QR code for the open link', async () => {
    const res = await call(`/api/rota/${state.token}/qr.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('exports the answers as CSV', async () => {
    const res = await call(`/api/admin/events/${state.eventId}/rota/export.csv`, { token: state.admin });
    expect(res.status).toBe(200);
    const text = await res.raw.text();
    expect(text.split('\n')[0]).toContain('Nom');
    expect(text).toContain('Nicole M');
    expect(text).toContain('Si besoin');
  });

  it('refuses new answers once the board is closed', async () => {
    await call(`/api/admin/events/${state.eventId}/rota/open`, { token: state.admin, json: { open: false } });
    const closed = await call(`/api/rota/${state.token}/signups`, { json: { name: 'Trop tard', choices: [] } });
    expect(closed.status).toBe(400);
    expect(closed.body.code).toBe('rota/closed');
    // The board is still readable.
    const read = await call(`/api/rota/${state.token}`);
    expect(read.body.open).toBe(false);
    expect(read.body.signups.length).toBe(1);
  });

  it('lets the organiser remove an answer', async () => {
    const res = await call(`/api/admin/events/${state.eventId}/rota/signups/${state.signupId}`, {
      method: 'DELETE',
      token: state.admin,
    });
    expect(res.status).toBe(200);
    const board = await call(`/api/rota/${state.token}`);
    expect(board.body.signups).toEqual([]);
  });

  it('keeps the board to admins', async () => {
    expect((await call(`/api/admin/events/${state.eventId}/rota`)).status).toBe(401);
  });
});
