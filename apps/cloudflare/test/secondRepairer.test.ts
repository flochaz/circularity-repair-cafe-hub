// Sometimes two volunteers work on the same item. A job keeps a primary
// repairer and may name an optional second one. Both can act on it, both are
// credited, and both see it in their own history.
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

describe('two repairers on one repair', () => {
  let admin = '';
  let dispatcher: Member;
  let ada: Member;
  let ben: Member;
  let eventId = '';
  let jobId = '';

  async function makeJob(): Promise<string> {
    const job = await call('/api/repairer/checkin', {
      token: dispatcher.token,
      json: { itemDescription: 'Kettle', faultDescription: 'Dead' },
    });
    expect(job.status).toBe(200);
    return job.body.id as string;
  }

  beforeAll(async () => {
    admin = (await setUpHub()).token;
    await call('/api/admin/settings/preferences', {
      method: 'PATCH',
      token: admin,
      json: { patTestingEnabled: true },
    });
    dispatcher = await makeUser(admin, 'two-desk@example.org', 'Dee Patcher', 'repairer');
    ada = await makeUser(admin, 'two-ada@example.org', 'Ada Fixwell', 'repairer');
    ben = await makeUser(admin, 'two-ben@example.org', 'Ben Spanner', 'repairer');

    const venueId = (await call('/api/admin/venues', { token: admin })).body[0].id;
    const date = new Date().toISOString().slice(0, 10);
    const event = await call('/api/admin/events', {
      token: admin,
      json: { name: 'Saturday session', venueId, date, startTime: '10:00', endTime: '13:00', isPublished: true },
    });
    eventId = event.body.id;
    await call(`/api/admin/events/${eventId}/activate`, { method: 'POST', token: admin });
    jobId = await makeJob();
  });

  it('starts a waiting repair with a primary and a second repairer', async () => {
    const assigned = await call(`/api/repairer/jobs/${jobId}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: ada.id, repairer2Id: ben.id },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({
      status: 'in_progress',
      repairerId: ada.id,
      repairer2Id: ben.id,
    });
    expect(assigned.body.acceptedAt).toBeTruthy();

    const detail = await call(`/api/repairer/jobs/${jobId}`, { token: dispatcher.token });
    expect(detail.body.repairer.displayName).toBe('Ada Fixwell');
    expect(detail.body.repairer2.displayName).toBe('Ben Spanner');

    // Both see it as their own work on the queue.
    const queueAda = await call('/api/repairer/active-event', { token: ada.token });
    const queueBen = await call('/api/repairer/active-event', { token: ben.token });
    expect(queueAda.body.myJobs.some((j: any) => j.id === jobId)).toBe(true);
    expect(queueBen.body.myJobs.some((j: any) => j.id === jobId)).toBe(true);
    const row = queueBen.body.jobs.find((j: any) => j.id === jobId);
    expect(row.repairerName).toBe('Ada Fixwell');
    expect(row.repairer2Name).toBe('Ben Spanner');
  });

  it('refuses the same person twice, and a second with no first', async () => {
    const same = await call(`/api/repairer/jobs/${jobId}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: ada.id, repairer2Id: ada.id },
    });
    expect(same.status).toBe(400);
    expect(same.body.code).toBe('validation/failed');

    const job = await makeJob();
    const noFirst = await call(`/api/repairer/jobs/${job}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: null, repairer2Id: ben.id },
    });
    expect(noFirst.status).toBe(400);
    expect(noFirst.body.code).toBe('validation/failed');

    // The admin form enforces the same rules.
    const adminSame = await call(`/api/admin/repairs/${jobId}`, {
      method: 'PATCH',
      token: admin,
      json: { repairerId: ada.id, repairer2Id: ada.id },
    });
    expect(adminSame.status).toBe(400);
    const adminNoFirst = await call(`/api/admin/repairs/${job}`, {
      method: 'PATCH',
      token: admin,
      json: { repairerId: null, repairer2Id: ben.id },
    });
    expect(adminNoFirst.status).toBe(400);
  });

  it('lets the second repairer record the PAT test and finish the repair', async () => {
    const pat = await call(`/api/repairer/jobs/${jobId}/pat`, {
      method: 'PATCH',
      token: ben.token,
      json: { result: 'pass' },
    });
    expect(pat.status).toBe(200);
    expect(pat.body.patResult).toBe('pass');

    const done = await call(`/api/repairer/jobs/${jobId}/complete`, {
      method: 'PATCH',
      token: ben.token,
      json: { outcome: 'completed', outcomeNotes: 'Replaced the fuse' },
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'completed', repairerId: ada.id, repairer2Id: ben.id });

    // A repair done together counts for both.
    expect((await call(`/api/admin/users/${ada.id}`, { token: admin })).body.repairCountCache).toBe(1);
    expect((await call(`/api/admin/users/${ben.id}`, { token: admin })).body.repairCountCache).toBe(1);

    const historyAda = await call('/api/repairer/history', { token: ada.token });
    const historyBen = await call('/api/repairer/history', { token: ben.token });
    expect(historyAda.body.meta.total).toBe(1);
    expect(historyBen.body.meta.total).toBe(1);
    expect(historyBen.body.data[0].id).toBe(jobId);
  });

  it('counts both volunteers on the event statistics', async () => {
    const eventStats = await call(`/api/admin/stats/events/${eventId}`, { token: admin });
    expect(eventStats.body.repairers.some((r: any) => r.id === ada.id)).toBe(true);
    expect(eventStats.body.repairers.some((r: any) => r.id === ben.id)).toBe(true);
    const job = eventStats.body.jobs.find((j: any) => j.id === jobId);
    expect(job.repairerName).toBe('Ada Fixwell');
    expect(job.repairer2Name).toBe('Ben Spanner');

    const overview = await call('/api/admin/stats/overview?range=all', { token: admin });
    expect(overview.body.repairerCount).toBe(2);
    const events = await call('/api/admin/stats/events?range=all', { token: admin });
    expect(events.body.find((e: any) => e.id === eventId).repairerCount).toBe(2);
  });

  it('shows both names in the admin list, the detail page and the export', async () => {
    const list = await call(`/api/admin/repairs?eventId=${eventId}`, { token: admin });
    const row = list.body.data.find((r: any) => r.id === jobId);
    expect(row.repairerName).toBe('Ada Fixwell');
    expect(row.repairer2Name).toBe('Ben Spanner');

    // Filtering by either volunteer finds the job.
    const byBen = await call(`/api/admin/repairs?eventId=${eventId}&repairerId=${ben.id}`, { token: admin });
    expect(byBen.body.data.some((r: any) => r.id === jobId)).toBe(true);

    const detail = await call(`/api/admin/repairs/${jobId}`, { token: admin });
    expect(detail.body.repairer2.displayName).toBe('Ben Spanner');

    const csv = await (await call(`/api/admin/repairs/export.csv?eventId=${eventId}`, { token: admin })).raw.text();
    const [header, ...rows] = csv.split('\r\n');
    expect(header.split(',')).toContain('repairer2');
    expect(rows.join('\n')).toContain('Ada Fixwell');
    expect(rows.join('\n')).toContain('Ben Spanner');
  });

  it('clears the second place with the first when the item goes back in the queue', async () => {
    const job = await makeJob();
    await call(`/api/repairer/jobs/${job}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: ada.id, repairer2Id: ben.id },
    });
    const cleared = await call(`/api/repairer/jobs/${job}/assign`, {
      method: 'PATCH',
      token: dispatcher.token,
      json: { repairerId: null, repairer2Id: null },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ status: 'waiting', repairerId: null, repairer2Id: null, acceptedAt: null });
  });
});
