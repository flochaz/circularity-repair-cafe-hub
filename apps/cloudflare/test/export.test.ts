// The admin repairs download: CSV quoting/encoding and the Excel workbook.
import { beforeAll, describe, expect, it } from 'vitest';
import { call, freshHub, setUpHub } from './helpers.js';

beforeAll(freshHub);

describe('repairs export', () => {
  let admin = '';
  let eventId = '';
  let otherEventId = '';

  beforeAll(async () => {
    admin = (await setUpHub()).token;
    const venueId = (await call('/api/admin/venues', { token: admin })).body[0].id;
    const date = new Date().toISOString().slice(0, 10);
    const event = await call('/api/admin/events', {
      token: admin,
      json: { name: 'Saturday session', venueId, date, startTime: '10:00', endTime: '13:00', isPublished: true },
    });
    eventId = event.body.id;
    await call(`/api/admin/events/${eventId}/activate`, { method: 'POST', token: admin });

    const user = await call('/api/admin/users', {
      token: admin,
      json: { email: 'export-repairer@example.org', displayName: 'Ada Fixwell', role: 'repairer' },
    });
    const repairer = (await call(`/api/auth/reset/${user.body.resetToken}`, { json: { password: 'Soldering1Iron' } })).body
      .accessToken;

    const tricky = await call('/api/repairer/checkin', {
      token: repairer,
      json: {
        itemDescription: 'Café "special"',
        faultDescription: 'First line\nSecond line',
        customerName: 'Multi\nLine',
        customerContact: '=1+1',
        gdprConsent: true,
      },
    });
    expect(tricky.status).toBe(200);

    const plain = await call('/api/repairer/checkin', {
      token: repairer,
      json: { itemDescription: 'Row two', faultDescription: 'Nothing wrong' },
    });
    expect(plain.status).toBe(200);

    // A second session, so the export filter has something to leave out.
    const other = await call('/api/admin/events', {
      token: admin,
      json: { name: 'Other session', venueId, date, startTime: '14:00', endTime: '16:00', isPublished: true },
    });
    otherEventId = other.body.id;
    await call(`/api/admin/events/${otherEventId}/activate`, { method: 'POST', token: admin });
    const elsewhere = await call(`/api/checkin/${other.body.checkInToken}/jobs`, {
      json: { customerName: 'Other Visitor', gdprConsent: true, itemDescription: 'Filtered out', faultDescription: 'Elsewhere' },
    });
    expect(elsewhere.status).toBe(200);
  });

  it('writes Excel-friendly CSV with quoting, CRLF and a UTF-8 BOM', async () => {
    const res = await call(`/api/admin/repairs/export.csv?eventId=${eventId}`, { token: admin });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await res.raw.arrayBuffer());
    // Excel needs the UTF-8 BOM, and Response.text() strips it, so check bytes.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);

    expect(text).toContain('\r\n');
    // A value with a line break stays one quoted field.
    expect(text).toContain('"First line\nSecond line"');
    expect(text).toContain('"Multi\nLine"');
    // Quotes and accents survive.
    expect(text).toContain('"Café ""special"""');
    // A value starting with "=" is not run as a formula.
    expect(text).toContain("'=1+1");

    // The filter is applied to the download too.
    expect(text).toContain('Café');
    expect(text).not.toContain('Filtered out');
  });

  it('writes the same rows as a real Excel workbook', async () => {
    const res = await call(`/api/admin/repairs/export.xlsx?eventId=${eventId}`, { token: admin });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet');
    const bytes = new Uint8Array(await res.raw.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    // The ZIP is stored, so the XML is readable in the bytes.
    const xml = new TextDecoder().decode(bytes);
    expect(xml).toContain('[Content_Types].xml');
    expect(xml).toContain('xl/worksheets/sheet1.xml');
    expect(xml).toContain('First line');
    expect(xml).toContain('Second line');
    expect(xml).toContain('Café');
    expect(xml).toContain('Row two');
    expect(xml).not.toContain('Filtered out');
  });
});
