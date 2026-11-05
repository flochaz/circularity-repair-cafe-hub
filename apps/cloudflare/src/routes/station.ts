// =============================================================================
//  The volunteer station
//  ---------------------------------------------------------------------------
//  A shared tablet or phone opens a private link, /station/<token>. It lists
//  the active repairers. A volunteer taps their name and lands in the repair
//  queue, with no password to type and nothing to remember.
//
//  The token is random, only reaches people an admin gives the link to, and
//  can be replaced at any time. A station session is a normal repairer session:
//  it can do everything the queue can do, and nothing an admin can do.
//
//  This is deliberately less private than a password. Anyone with the link can
//  act as one of the team, so it should be shared only with volunteers.
// =============================================================================
import type { App } from '../lib/router.js';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { cafes, events, users } from '../db/schema.js';
import { REFRESH_COOKIE } from '../lib/auth.js';
import { audit } from '../utils/audit.js';
import { randomToken } from '../utils/tokens.js';
import { qrPng } from '../services/qrcode.js';

interface Station {
  id: string;
  token: string;
  enabled: boolean;
  name: string;
  publicUrl: string;
}

/** How long a station session lasts before the volunteer picks again. */
const STATION_REFRESH_DAYS = 1;

/** The cafe's station link, made the first time an admin asks for it. */
async function station(regenerate = false): Promise<Station | null> {
  const [cafe] = await db
    .select({
      id: cafes.id,
      token: cafes.stationToken,
      enabled: cafes.stationEnabled,
      name: cafes.name,
      publicUrl: cafes.publicUrl,
    })
    .from(cafes)
    .limit(1);
  if (!cafe) return null;
  if (cafe.token && !regenerate) return { ...cafe, token: cafe.token };
  const token = randomToken(18);
  await db.update(cafes).set({ stationToken: token, updatedAt: new Date() }).where(eq(cafes.id, cafe.id));
  return { ...cafe, token };
}

/** The station behind a link, or null when it is off or the token is wrong. */
async function stationFor(token: string): Promise<Station | null> {
  if (!token || token.length < 16) return null;
  const [cafe] = await db
    .select({
      id: cafes.id,
      token: cafes.stationToken,
      enabled: cafes.stationEnabled,
      name: cafes.name,
      publicUrl: cafes.publicUrl,
    })
    .from(cafes)
    .limit(1);
  if (!cafe?.enabled || !cafe.token || token !== cafe.token) return null;
  return { ...cafe, token: cafe.token };
}

function linkPayload(s: Station) {
  return {
    enabled: s.enabled,
    token: s.token,
    path: `/station/${s.token}`,
    qrPath: `/api/station/${s.token}/qr.png`,
  };
}

export async function stationRoutes(app: App): Promise<void> {
  // ── For admins: turn it on, get the link, replace it ─────────────────
  app.get('/api/admin/station-link', { preHandler: app.requireRole('super_admin', 'admin') }, async (_request, reply) => {
    const s = await station();
    if (!s) {
      reply.code(404).send({ error: 'Cafe not initialized', code: 'cafe/missing' });
      return;
    }
    return linkPayload(s);
  });

  app.patch('/api/admin/station-link', { preHandler: app.requireRole('super_admin', 'admin') }, async (request, reply) => {
    const me = request.auth!;
    const body = (request.body ?? {}) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      reply.code(400).send({ error: 'enabled must be true or false', code: 'validation/failed' });
      return;
    }
    const s = await station();
    if (!s) {
      reply.code(404).send({ error: 'Cafe not initialized', code: 'cafe/missing' });
      return;
    }
    await db.update(cafes).set({ stationEnabled: body.enabled, updatedAt: new Date() }).where(eq(cafes.id, s.id));
    await audit({
      request,
      actorId: me.sub,
      actorType: me.role,
      action: 'cafe.station_updated',
      entityType: 'cafe',
      entityId: s.id,
      metadata: { enabled: body.enabled },
    });
    return linkPayload({ ...s, enabled: body.enabled });
  });

  app.post(
    '/api/admin/station-link/regenerate',
    { preHandler: app.requireRole('super_admin', 'admin') },
    async (request, reply) => {
      const me = request.auth!;
      const s = await station(true);
      if (!s) {
        reply.code(404).send({ error: 'Cafe not initialized', code: 'cafe/missing' });
        return;
      }
      await audit({
        request,
        actorId: me.sub,
        actorType: me.role,
        action: 'cafe.station_link_replaced',
        entityType: 'cafe',
        entityId: s.id,
      });
      return linkPayload(s);
    },
  );

  // ── For the station itself ──────────────────────────────────────────
  app.get('/api/station/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const s = await stationFor(token);
    if (!s) {
      reply.code(404).send({
        error: 'This volunteer link is not valid. Ask the organiser for the current one.',
        code: 'station/not_found',
      });
      return;
    }
    const people = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.isActive, true), eq(users.role, 'repairer')))
      .orderBy(asc(users.displayName));
    const [active] = await db
      .select({ name: events.name, date: events.date })
      .from(events)
      .where(eq(events.status, 'active'))
      .orderBy(asc(events.date))
      .limit(1);
    reply.header('Cache-Control', 'no-store');
    return { cafeName: s.name, users: people, event: active ?? null };
  });

  app.post('/api/station/:token/select', async (request, reply) => {
    const { token } = request.params as { token: string };
    const s = await stationFor(token);
    if (!s) {
      reply.code(404).send({
        error: 'This volunteer link is not valid. Ask the organiser for the current one.',
        code: 'station/not_found',
      });
      return;
    }
    const userId = (request.body as { userId?: unknown } | undefined)?.userId;
    if (typeof userId !== 'string') {
      reply.code(400).send({ error: 'Choose a volunteer', code: 'validation/failed' });
      return;
    }
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    // Only an active repairer. An admin uses the password sign-in, so this
    // link can never hand out an admin session.
    if (!user || !user.isActive || user.role !== 'repairer') {
      reply.code(400).send({ error: 'That volunteer is not available', code: 'station/user_not_found' });
      return;
    }

    // A shared device should not keep the previous volunteer signed in.
    const previous = request.cookies[REFRESH_COOKIE];
    if (previous) await app.revokeRefreshToken(previous);

    const tokens = await app.issueTokens(
      { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
      { refreshDays: STATION_REFRESH_DAYS },
    );
    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * STATION_REFRESH_DAYS,
    });
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await audit({
      request,
      actorId: user.id,
      actorType: user.role,
      action: 'auth.station_selected',
      entityType: 'user',
      entityId: user.id,
    });
    reply.header('Cache-Control', 'no-store');
    return {
      accessToken: tokens.accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    };
  });

  // A QR code for the station link, so an organiser can print it or post it
  // in the volunteers' group. It is only drawn while the station is on.
  app.get('/api/station/:token/qr.png', async (request, reply) => {
    const { token } = request.params as { token: string };
    const s = await stationFor(token);
    if (!s) {
      reply.code(404).send({ error: 'This volunteer link is not valid', code: 'station/not_found' });
      return;
    }
    const base = (s.publicUrl || new URL(request.raw.url).origin).replace(/\/$/, '');
    const png = await qrPng(`${base}/station/${s.token}`);
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'no-store');
    return png;
  });
}
