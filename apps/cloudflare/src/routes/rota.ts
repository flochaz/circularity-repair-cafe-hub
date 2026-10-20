import type { App } from '../lib/router.js';
import { db, inList } from '../db/index.js';
import { cafes, eventRoles, eventSignupChoices, eventSignups, events, repairerEvents, users } from '../db/schema.js';
import { and, asc, eq } from 'drizzle-orm';
import { rotaRoleSchema, rotaRoleUpdateSchema, rotaSignupSchema } from '@circularity/shared';
import { randomToken } from '../utils/tokens.js';
import { audit } from '../utils/audit.js';
import { qrPng } from '../services/qrcode.js';

// =============================================================================
//  The volunteer sign-up board
//  ---------------------------------------------------------------------------
//  The same idea as the Framadate poll a cafe usually runs by hand: the columns
//  are roles or tasks, and each volunteer answers yes, if needed, or no. This
//  puts it on the session itself, so it sits next to the repairs and the roster
//  and needs no separate tool.
//
//  A session has one open link (events.signup_token) that people can answer on
//  with no account. Each answer has its own token, so the person can come back
//  and change it, the way Framadate remembers a vote.
// =============================================================================

/** The roles this cafe usually fills. Used the first time a board is opened. */
const DEFAULT_ROLES: Array<{ label: string; capacity: number | null }> = [
  { label: "Table d'accueil", capacity: 2 },
  { label: 'Installation salle – 13h30', capacity: 5 },
  { label: 'Réparation', capacity: null },
  { label: 'Couture', capacity: null },
  { label: 'Navette', capacity: 2 },
  { label: 'Préparation de gâteau, biscuits', capacity: null },
  { label: 'Table de sortie', capacity: 2 },
];

interface EventRow {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  signupToken: string | null;
  signupOpen: boolean;
}

async function loadEventBySignupToken(token: string): Promise<EventRow | null> {
  const [row] = await db.select().from(events).where(eq(events.signupToken, token)).limit(1);
  return row ?? null;
}

async function loadEvent(eventId: string): Promise<EventRow | null> {
  const [row] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  return row ?? null;
}

/** The roles, the answers and the answers-by-person map for a session. */
async function loadBoard(eventId: string) {
  const roles = await db
    .select()
    .from(eventRoles)
    .where(eq(eventRoles.eventId, eventId))
    .orderBy(asc(eventRoles.sortOrder), asc(eventRoles.createdAt));
  const signups = await db
    .select()
    .from(eventSignups)
    .where(eq(eventSignups.eventId, eventId))
    .orderBy(asc(eventSignups.createdAt));
  const ids = signups.map((s) => s.id);
  const choices = ids.length
    ? await db.select().from(eventSignupChoices).where(inList(eventSignupChoices.signupId, ids))
    : [];
  const bySignup = new Map<string, Record<string, string>>();
  for (const c of choices) {
    const row = bySignup.get(c.signupId) ?? {};
    row[c.roleId] = c.choice;
    bySignup.set(c.signupId, row);
  }
  return { roles, signups, bySignup };
}

function summarise(roles: Array<{ id: string }>, bySignup: Map<string, Record<string, string>>) {
  const summary: Record<string, { yes: number; ifNeeded: number; no: number }> = {};
  for (const role of roles) summary[role.id] = { yes: 0, ifNeeded: 0, no: 0 };
  for (const choices of bySignup.values()) {
    for (const [roleId, choice] of Object.entries(choices)) {
      const bucket = summary[roleId];
      if (!bucket) continue;
      if (choice === 'yes') bucket.yes++;
      else if (choice === 'if_needed') bucket.ifNeeded++;
      else if (choice === 'no') bucket.no++;
    }
  }
  return summary;
}

async function publicUrl(): Promise<string> {
  const [cafe] = await db.select({ publicUrl: cafes.publicUrl }).from(cafes).limit(1);
  return (cafe?.publicUrl ?? '').replace(/\/$/, '');
}

function boardPayload(event: EventRow, board: Awaited<ReturnType<typeof loadBoard>>) {
  return {
    event: {
      id: event.id,
      name: event.name,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      status: event.status,
    },
    open: event.signupOpen,
    roles: board.roles.map((r) => ({ id: r.id, label: r.label, capacity: r.capacity, sortOrder: r.sortOrder })),
    signups: board.signups.map((s) => ({
      id: s.id,
      userId: s.userId,
      name: s.name,
      comment: s.comment,
      choices: board.bySignup.get(s.id) ?? {},
    })),
    summary: summarise(board.roles, board.bySignup),
  };
}

/** Keep only the choices whose role belongs to this session. */
async function validChoices(eventId: string, choices: Array<{ roleId: string; choice: string }>) {
  const roles = await db.select({ id: eventRoles.id }).from(eventRoles).where(eq(eventRoles.eventId, eventId));
  const allowed = new Set(roles.map((r) => r.id));
  return choices.filter((c) => allowed.has(c.roleId));
}

/** Active volunteers, for the name picker on the open page. Names only. */
async function volunteerList() {
  return db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.displayName));
}

/**
 * Who is answering: a volunteer picked from the list, or a typed name for
 * somebody who is not in the hub. Picking from the list keeps the names tidy
 * and ties the answer to the account.
 */
async function resolveRespondent(data: { userId?: string | null; name?: string | null }) {
  if (data.userId) {
    const [u] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);
    if (!u) return null;
    return { userId: u.id, name: u.displayName };
  }
  return { userId: null, name: (data.name ?? '').trim() };
}

async function replaceChoices(signupId: string, choices: Array<{ roleId: string; choice: string }>) {
  await db.delete(eventSignupChoices).where(eq(eventSignupChoices.signupId, signupId));
  if (choices.length) {
    await db
      .insert(eventSignupChoices)
      .values(choices.map((c) => ({ signupId, roleId: c.roleId, choice: c.choice as 'yes' | 'if_needed' | 'no' })));
  }
}

/**
 * A volunteer who answers yes to at least one role is coming to that session,
 * so they are marked in the event's "Attending repairers" list — the same
 * repairer_events table the admin checkboxes use. If every answer moves away
 * from yes, or the answer is deleted, the mark is removed again.
 */
async function syncAttendance(eventId: string, userId: string | null, choices: Array<{ choice: string }>) {
  if (!userId) return;
  if (choices.some((choice) => choice.choice === 'yes')) {
    await db.insert(repairerEvents).values({ eventId, userId, confirmed: true }).onConflictDoNothing();
  } else {
    await db
      .delete(repairerEvents)
      .where(and(eq(repairerEvents.eventId, eventId), eq(repairerEvents.userId, userId)));
  }
}

// ── The open link, answered with no account ─────────────────────────────────

export async function rotaRoutes(app: App): Promise<void> {
  app.get('/api/rota/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const event = await loadEventBySignupToken(token);
    if (!event) {
      reply.code(404).send({ error: 'Sign-up board not found', code: 'rota/not_found' });
      return;
    }
    const board = await loadBoard(event.id);
    return { ...boardPayload(event, board), volunteers: await volunteerList() };
  });

  app.post('/api/rota/:token/signups', async (request, reply) => {
    const { token } = request.params as { token: string };
    const event = await loadEventBySignupToken(token);
    if (!event) {
      reply.code(404).send({ error: 'Sign-up board not found', code: 'rota/not_found' });
      return;
    }
    if (!event.signupOpen) {
      reply.code(400).send({ error: 'This sign-up is closed', code: 'rota/closed' });
      return;
    }
    const parsed = rotaSignupSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'Validation failed', code: 'validation/failed', details: parsed.error.flatten() });
      return;
    }
    const respondent = await resolveRespondent(parsed.data);
    if (!respondent) {
      reply.code(400).send({ error: 'That volunteer is not in the hub', code: 'rota/unknown_volunteer' });
      return;
    }
    const choices = await validChoices(event.id, parsed.data.choices);
    const editToken = randomToken(16);
    const [created] = await db
      .insert(eventSignups)
      .values({
        eventId: event.id,
        userId: respondent.userId,
        name: respondent.name,
        comment: parsed.data.comment?.trim() || null,
        token: editToken,
      })
      .returning();
    await replaceChoices(created!.id, choices);
    await syncAttendance(event.id, respondent.userId, choices);
    const board = await loadBoard(event.id);
    return { signupId: created!.id, editToken, ...boardPayload(event, board) };
  });

  app.put('/api/rota/:token/signups/:signupToken', async (request, reply) => {
    const { token, signupToken } = request.params as { token: string; signupToken: string };
    const event = await loadEventBySignupToken(token);
    if (!event) {
      reply.code(404).send({ error: 'Sign-up board not found', code: 'rota/not_found' });
      return;
    }
    if (!event.signupOpen) {
      reply.code(400).send({ error: 'This sign-up is closed', code: 'rota/closed' });
      return;
    }
    const [signup] = await db
      .select()
      .from(eventSignups)
      .where(eq(eventSignups.token, signupToken))
      .limit(1);
    if (!signup || signup.eventId !== event.id) {
      reply.code(404).send({ error: 'Your answer was not found', code: 'rota/signup_not_found' });
      return;
    }
    const previousUserId = signup.userId;
    const parsed = rotaSignupSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'Validation failed', code: 'validation/failed', details: parsed.error.flatten() });
      return;
    }
    const respondent = await resolveRespondent(parsed.data);
    if (!respondent) {
      reply.code(400).send({ error: 'That volunteer is not in the hub', code: 'rota/unknown_volunteer' });
      return;
    }
    const choices = await validChoices(event.id, parsed.data.choices);
    await db
      .update(eventSignups)
      .set({
        userId: respondent.userId,
        name: respondent.name,
        comment: parsed.data.comment?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(eventSignups.id, signup.id));
    await replaceChoices(signup.id, choices);
    if (previousUserId && previousUserId !== respondent.userId) {
      await syncAttendance(event.id, previousUserId, []);
    }
    await syncAttendance(event.id, respondent.userId, choices);
    const board = await loadBoard(event.id);
    return boardPayload(event, board);
  });

  app.delete('/api/rota/:token/signups/:signupToken', async (request, reply) => {
    const { token, signupToken } = request.params as { token: string; signupToken: string };
    const event = await loadEventBySignupToken(token);
    if (!event) {
      reply.code(404).send({ error: 'Sign-up board not found', code: 'rota/not_found' });
      return;
    }
    const [signup] = await db.select().from(eventSignups).where(eq(eventSignups.token, signupToken)).limit(1);
    if (!signup || signup.eventId !== event.id) {
      reply.code(404).send({ error: 'Your answer was not found', code: 'rota/signup_not_found' });
      return;
    }
    await db.delete(eventSignups).where(eq(eventSignups.id, signup.id));
    await syncAttendance(event.id, signup.userId, []);
    const board = await loadBoard(event.id);
    return boardPayload(event, board);
  });
  // A QR code for the open link, so a volunteer can scan it in the hall. It is
  // public because it only encodes the public link.
  app.get('/api/rota/:token/qr.png', async (request, reply) => {
    const { token } = request.params as { token: string };
    const event = await loadEventBySignupToken(token);
    if (!event) {
      reply.code(404).send({ error: 'Sign-up board not found', code: 'rota/not_found' });
      return;
    }
    const base = await publicUrl();
    if (!base) {
      reply.code(400).send({ error: 'Set the public address first', code: 'cafe/no_public_url' });
      return;
    }
    const png = await qrPng(`${base}/rota/${token}`);
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'no-store');
    return png;
  });
}

export async function adminRotaRoutes(app: App): Promise<void> {
  app.get('/api/admin/events/:id/rota', async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await loadEvent(id);
    if (!event) {
      reply.code(404).send({ error: 'Event not found', code: 'event/not_found' });
      return;
    }
    const board = await loadBoard(event.id);
    const base = await publicUrl();
    return {
      ...boardPayload(event, board),
      shareUrl: event.signupToken && base ? `${base}/rota/${event.signupToken}` : null,
      signupToken: event.signupToken,
    };
  });

  // Open (and prepare) the board, or close it again. Opening seeds the roles
  // the cafe usually fills the first time, so there is nothing to type to start.
  app.post('/api/admin/events/:id/rota/open', async (request, reply) => {
    const me = request.auth!;
    const { id } = request.params as { id: string };
    const event = await loadEvent(id);
    if (!event) {
      reply.code(404).send({ error: 'Event not found', code: 'event/not_found' });
      return;
    }
    const body = (request.body ?? {}) as { open?: boolean };
    const open = body.open !== false;

    let token = event.signupToken;
    if (open && !token) {
      token = randomToken(16);
      const existing = await db.select({ id: eventRoles.id }).from(eventRoles).where(eq(eventRoles.eventId, event.id));
      if (existing.length === 0) {
        await db.insert(eventRoles).values(
          DEFAULT_ROLES.map((r, i) => ({ eventId: event.id, label: r.label, capacity: r.capacity, sortOrder: i })),
        );
      }
    }
    await db.update(events).set({ signupToken: token, signupOpen: open, updatedAt: new Date() }).where(eq(events.id, event.id));
    await audit({
      request,
      actorId: me.sub,
      actorType: me.role,
      action: open ? 'rota.opened' : 'rota.closed',
      entityType: 'event',
      entityId: event.id,
    });
    const fresh = await loadEvent(event.id);
    const board = await loadBoard(event.id);
    const base = await publicUrl();
    return {
      ...boardPayload(fresh!, board),
      shareUrl: fresh!.signupToken && base ? `${base}/rota/${fresh!.signupToken}` : null,
      signupToken: fresh!.signupToken,
    };
  });

  app.post('/api/admin/events/:id/rota/roles', async (request, reply) => {
    const me = request.auth!;
    const { id } = request.params as { id: string };
    const event = await loadEvent(id);
    if (!event) {
      reply.code(404).send({ error: 'Event not found', code: 'event/not_found' });
      return;
    }
    const parsed = rotaRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'Validation failed', code: 'validation/failed', details: parsed.error.flatten() });
      return;
    }
    const existing = await db.select({ id: eventRoles.id }).from(eventRoles).where(eq(eventRoles.eventId, event.id));
    const [created] = await db
      .insert(eventRoles)
      .values({
        eventId: event.id,
        label: parsed.data.label.trim(),
        capacity: parsed.data.capacity ?? null,
        sortOrder: parsed.data.sortOrder ?? existing.length,
      })
      .returning();
    await audit({ request, actorId: me.sub, actorType: me.role, action: 'rota.role_added', entityType: 'event', entityId: event.id });
    reply.code(200);
    return created;
  });

  app.patch('/api/admin/events/:id/rota/roles/:roleId', async (request, reply) => {
    const { id, roleId } = request.params as { id: string; roleId: string };
    const parsed = rotaRoleUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'Validation failed', code: 'validation/failed', details: parsed.error.flatten() });
      return;
    }
    const [role] = await db.select().from(eventRoles).where(eq(eventRoles.id, roleId)).limit(1);
    if (!role || role.eventId !== id) {
      reply.code(404).send({ error: 'Role not found', code: 'rota/role_not_found' });
      return;
    }
    const [updated] = await db
      .update(eventRoles)
      .set({
        ...(parsed.data.label !== undefined ? { label: parsed.data.label.trim() } : {}),
        ...(parsed.data.capacity !== undefined ? { capacity: parsed.data.capacity ?? null } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(eventRoles.id, roleId))
      .returning();
    return updated;
  });

  app.delete('/api/admin/events/:id/rota/roles/:roleId', async (request, reply) => {
    const me = request.auth!;
    const { id, roleId } = request.params as { id: string; roleId: string };
    const [role] = await db.select().from(eventRoles).where(eq(eventRoles.id, roleId)).limit(1);
    if (!role || role.eventId !== id) {
      reply.code(404).send({ error: 'Role not found', code: 'rota/role_not_found' });
      return;
    }
    await db.delete(eventRoles).where(eq(eventRoles.id, roleId));
    await audit({ request, actorId: me.sub, actorType: me.role, action: 'rota.role_removed', entityType: 'event', entityId: id });
    return { ok: true };
  });

  app.delete('/api/admin/events/:id/rota/signups/:signupId', async (request, reply) => {
    const me = request.auth!;
    const { id, signupId } = request.params as { id: string; signupId: string };
    const [signup] = await db.select().from(eventSignups).where(eq(eventSignups.id, signupId)).limit(1);
    if (!signup || signup.eventId !== id) {
      reply.code(404).send({ error: 'Sign-up not found', code: 'rota/signup_not_found' });
      return;
    }
    await db.delete(eventSignups).where(eq(eventSignups.id, signupId));
    await audit({ request, actorId: me.sub, actorType: me.role, action: 'rota.signup_removed', entityType: 'event', entityId: id });
    return { ok: true };
  });

  app.get('/api/admin/events/:id/rota/export.csv', async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await loadEvent(id);
    if (!event) {
      reply.code(404).send({ error: 'Event not found', code: 'event/not_found' });
      return;
    }
    const board = await loadBoard(event.id);
    const cell = (v: string | undefined) => (v === 'yes' ? 'Oui' : v === 'if_needed' ? 'Si besoin' : v === 'no' ? 'Non' : '');
    const quote = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ['Nom', 'Commentaire', ...board.roles.map((r) => r.label)].map(quote).join(',');
    const lines = board.signups.map((s) => {
      const choices = board.bySignup.get(s.id) ?? {};
      return [s.name, s.comment ?? '', ...board.roles.map((r) => cell(choices[r.id]))].map(quote).join(',');
    });
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="rota-${event.date}.csv"`);
    return '\uFEFF' + [header, ...lines].join('\n') + '\n';
  });
}
