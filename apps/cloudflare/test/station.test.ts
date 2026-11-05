// The volunteer station: a shared link where a volunteer picks their name
// instead of typing a password. See routes/station.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { call, freshHub, setUpHub } from './helpers.js';

beforeAll(freshHub);

interface Member {
  id: string;
  token: string;
}

async function makeUser(
  admin: string,
  email: string,
  displayName: string,
  role: 'admin' | 'repairer',
): Promise<Member> {
  const user = await call('/api/admin/users', { token: admin, json: { email, displayName, role } });
  if (user.status !== 200) throw new Error(`could not create ${email}: ${JSON.stringify(user.body)}`);
  const signedIn = await call(`/api/auth/reset/${user.body.resetToken}`, { json: { password: 'Soldering1Iron' } });
  return { id: user.body.user.id, token: signedIn.body.accessToken };
}

describe('the volunteer station', () => {
  let admin = '';
  let ada: Member;
  let ben: Member;
  let boss: Member;
  let path = '';

  beforeAll(async () => {
    admin = (await setUpHub()).token;
    ada = await makeUser(admin, 'station-ada@example.org', 'Ada Fixwell', 'repairer');
    ben = await makeUser(admin, 'station-ben@example.org', 'Ben Spanner', 'repairer');
    boss = await makeUser(admin, 'station-boss@example.org', 'Bea Admin', 'admin');
    await call(`/api/admin/users/${ben.id}`, { method: 'PATCH', token: admin, json: { isActive: false } });
  });

  it('is off until an admin turns it on', async () => {
    const link = await call('/api/admin/station-link', { token: admin });
    expect(link.status).toBe(200);
    expect(link.body.enabled).toBe(false);
    expect(link.body.token.length).toBeGreaterThanOrEqual(16);
    expect(link.body.path).toBe(`/station/${link.body.token}`);
    path = link.body.path;

    expect((await call(path.replace('/station/', '/api/station/'))).status).toBe(404);
  });

  it('lists active repairers, and nobody else, once it is on', async () => {
    const on = await call('/api/admin/station-link', { method: 'PATCH', token: admin, json: { enabled: true } });
    expect(on.status).toBe(200);
    expect(on.body.enabled).toBe(true);
    path = on.body.path;

    const res = await call(path.replace('/station/', '/api/station/'));
    expect(res.status).toBe(200);
    const names = (res.body.users as any[]).map((u) => u.displayName);
    expect(names).toContain('Ada Fixwell');
    expect(names).not.toContain('Ben Spanner');
    expect(names).not.toContain('Bea Admin');
    expect(names).not.toContain('Ada Admin');
    const row = (res.body.users as any[]).find((u) => u.id === ada.id);
    expect(row).toMatchObject({ id: ada.id, displayName: 'Ada Fixwell' });
    expect(row.email).toBeUndefined();
  });

  it('never puts the station token in the public cafe profile', async () => {
    const token = path.split('/').pop()!;
    const profile = await call('/api/public/cafe');
    expect(profile.status).toBe(200);
    expect(JSON.stringify(profile.body)).not.toContain(token);
  });

  it('only signs in an active repairer', async () => {
    const endpoint = `${path.replace('/station/', '/api/station/')}/select`;
    for (const userId of [boss.id, ben.id, crypto.randomUUID()]) {
      const res = await call(endpoint, { method: 'POST', json: { userId } });
      expect(res.status, userId).toBe(400);
      expect(res.body.code).toBe('station/user_not_found');
    }
  });

  it('gives a repairer session that cannot reach the admin area', async () => {
    const endpoint = `${path.replace('/station/', '/api/station/')}/select`;
    const signedIn = await call(endpoint, { method: 'POST', json: { userId: ada.id } });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user).toMatchObject({ id: ada.id, displayName: 'Ada Fixwell', role: 'repairer' });
    const token = signedIn.body.accessToken as string;

    const me = await call('/api/repairer/me', { token });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(ada.id);
    expect((await call('/api/admin/dashboard', { token })).status).toBe(403);
    expect(signedIn.headers.get('set-cookie')).toContain('circ_refresh=');
  });

  it('draws a QR code for the link', async () => {
    const res = await call(`${path.replace('/station/', '/api/station/')}/qr.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    // The PNG signature.
    const bytes = new Uint8Array(await res.raw.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('stops the old link when an admin makes a new one', async () => {
    const fresh = await call('/api/admin/station-link/regenerate', { method: 'POST', token: admin, json: {} });
    expect(fresh.status).toBe(200);
    expect(fresh.body.path).not.toBe(path);
    expect((await call(path.replace('/station/', '/api/station/'))).status).toBe(404);
    expect((await call(fresh.body.path.replace('/station/', '/api/station/'))).status).toBe(200);
  });

  it('closes again when the admin turns it off', async () => {
    const off = await call('/api/admin/station-link', { method: 'PATCH', token: admin, json: { enabled: false } });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    expect((await call(off.body.path.replace('/station/', '/api/station/'))).status).toBe(404);
  });
});
