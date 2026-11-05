// Putting a repair in a volunteer's name from the job page, for the person
// running the queue when the repairer is not signed in. See
// app.patch('/api/repairer/jobs/:id/assign').
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

describe('assigning a repair to someone else', () => {
  let admin = '';
  let dispatcher: Member;
  let ada: Member;
  let ben: Member;
  let jobId = '';

  async function makeJob(): Promise<string> {
    const job = await call('/api/repairer/checkin', {
      token: dispatcher.token,
      json: { itemDescription: 'Toaster', faultDescription: 'No power' },
    });
    expect(job.status).toBe(200);
    return job.body.id as string;
  }

  beforeAll(async () => {
    admin = (await setUpHub()).token;
    dispatcher = await makeUser(admin, 'queue-desk@example.org', 'Dee Patcher', 'repairer');
    ada = await makeUser(admin, 'queue-ada@example.org', 'Ada Fixwell', 'repairer');
    ben = await makeUser(admin, 'queue-ben@example.org', 'Ben Spanner', 'repairer');

    const venueId = (await call('/api/admin/venues', { token: admin })).body[0].id;
    const date = new Date().toISOString().slice(0, 10);
    const event = await call('/api/admin/events', {
      token: admin,
      json: { name: 'Saturday session', venueId, date, startTime: '10:00', endTime: '13:00', isPublished: true },
    });
    await call(`/api/admin/events/${event.body.id}/activate`, { method: 'POST', token: admin });
    jobId = await makeJob();
  });

  it('lists the team for the picker, and only signed-in staff can read it', async () => {
    expect((await call('/api/repairer/volunteers')).status).toBe(401);
    const list = await call('/api/repairer/volunteers', { token: dispatcher.token });
    expect(list.status).toBe(200);
    const row = (list.body as any[]).find((u) => u.id === ada.id);
    expect(row).toMatchObject({ displayName: 'Ada Fixwell', role: 'repairer' });
    expect(row.email).toBeUndefined();
  });

  it('starts a waiting repair when it is given to someone', async () => {
    const assigned = await call(`/api/repairer/jobs/${jobId}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: ada.id },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({ status: 'in_progress', repairerId: ada.id });
    expect(assigned.body.acceptedAt).toBeTruthy();

    const detail = await call(`/api/repairer/jobs/${jobId}`, { token: dispatcher.token });
    expect(detail.body.repairer.displayName).toBe('Ada Fixwell');
  });

  it('keeps the start time when the repair is passed to someone else', async () => {
    const before = await call(`/api/repairer/jobs/${jobId}`, { token: dispatcher.token });
    const passed = await call(`/api/repairer/jobs/${jobId}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: ben.id },
    });
    expect(passed.status).toBe(200);
    expect(passed.body.repairerId).toBe(ben.id);
    expect(passed.body.status).toBe('in_progress');
    expect(passed.body.acceptedAt).toBe(before.body.job.acceptedAt);
  });

  it("lets the dispatcher record the outcome, credited to the assigned repairer", async () => {
    const done = await call(`/api/repairer/jobs/${jobId}/complete`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { outcome: 'completed', outcomeNotes: 'Replaced the fuse' },
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'completed', repairerId: ben.id });

    const saved = await call(`/api/admin/users/${ben.id}`, { token: admin });
    expect(saved.body.repairCountCache).toBe(1);
  });

  it('refuses a name that is not an active member of the hub', async () => {
    const second = await makeJob();
    const missing = await call(`/api/repairer/jobs/${second}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: crypto.randomUUID() },
    });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('user/not_found');

    await call(`/api/admin/users/${ben.id}`, { method: 'PATCH', token: admin, json: { isActive: false } });
    const inactive = await call(`/api/repairer/jobs/${second}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: ben.id },
    });
    expect(inactive.status).toBe(400);
    expect(inactive.body.code).toBe('user/not_found');

    const list = await call('/api/repairer/volunteers', { token: dispatcher.token });
    expect((list.body as any[]).some((u) => u.id === ben.id)).toBe(false);
  });

  it('puts an item back in the queue when the name is cleared', async () => {
    const second = await makeJob();
    await call(`/api/repairer/jobs/${second}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: ada.id },
    });
    const cleared = await call(`/api/repairer/jobs/${second}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: null },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ status: 'waiting', repairerId: null, acceptedAt: null });
  });

  it('does not let a finished repair change hands', async () => {
    const res = await call(`/api/repairer/jobs/${jobId}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: ada.id },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('job/already_finished');
  });
});
