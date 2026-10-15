// First-time activation. A volunteer the café imports has no password, and
// sets one with just their email — no reset link to follow, and no email for
// an organiser to send out.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, call, freshHub, refreshCookie, setUpHub } from './helpers.js';

beforeAll(freshHub);

let adminToken = '';

/** Create a repairer the way an import would: an account with no password. */
async function seedUnactivated(email: string, displayName: string): Promise<void> {
  const created = await call('/api/admin/users', {
    json: { email, displayName, role: 'repairer' },
    token: adminToken,
  });
  expect(created.status).toBe(200);
  const { env } = await import('cloudflare:workers');
  const DB = (env as unknown as { DB: D1Database }).DB;
  await DB.prepare('UPDATE users SET password_hash = ? WHERE email = ?').bind('', email).run();
}

describe('first-time activation', () => {
  it('sets up the hub and an unactivated volunteer', async () => {
    const { token } = await setUpHub();
    adminToken = token;
    await seedUnactivated('rita@example.org', 'Rita Repairer');
  });

  it('refuses a weak password and an unknown email', async () => {
    const weak = await call('/api/auth/activate', {
      json: { email: 'rita@example.org', password: 'short' },
    });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('auth/weak_password');

    const unknown = await call('/api/auth/activate', {
      json: { email: 'nobody@example.org', password: 'Soldering1Iron' },
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('auth/no_account');
  });

  it('tells the sign-in form the account has no password yet', async () => {
    const res = await call('/api/auth/login', { json: { email: 'rita@example.org', password: 'anything' } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('auth/not_activated');
  });

  it('lets the volunteer choose a password and signs them straight in', async () => {
    const res = await call('/api/auth/activate', {
      json: { email: 'rita@example.org', password: 'Soldering1Iron' },
    });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('repairer');
    expect(res.body.accessToken).toMatch(/^ey/);
    expect(refreshCookie(res)).toMatch(/^circ_refresh=/);

    // The chosen password works from now on; the old guess does not.
    const ok = await call('/api/auth/login', { json: { email: 'rita@example.org', password: 'Soldering1Iron' } });
    expect(ok.status).toBe(200);
    const wrong = await call('/api/auth/login', { json: { email: 'rita@example.org', password: 'anything' } });
    expect(wrong.status).toBe(401);
  });

  it('will not let an activated account be claimed a second time', async () => {
    const again = await call('/api/auth/activate', {
      json: { email: 'rita@example.org', password: 'Different1Pass' },
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('auth/already_activated');
  });

  it('keeps organiser accounts out of self-activation', async () => {
    const res = await call('/api/auth/activate', { json: { email: ADMIN.email, password: 'Soldering1Iron' } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('auth/admin_reset');
    // The organiser's real password is untouched.
    const ok = await call('/api/auth/login', { json: { email: ADMIN.email, password: ADMIN.password } });
    expect(ok.status).toBe(200);
  });
});
