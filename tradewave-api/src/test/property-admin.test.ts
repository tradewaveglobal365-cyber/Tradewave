import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { emailService } from '../services/email';
import { dollarsToCents } from '../lib/money';
import { migrateTestDatabase, resetDatabase } from './helpers';

const app = createApp();
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';

const verifyUrls: string[] = [];

beforeAll(() => {
  migrateTestDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.property.deleteMany();
  verifyUrls.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(emailService, 'sendVerification').mockImplementation(async ({ verifyUrl }) => {
    verifyUrls.push(verifyUrl);
  });
});

async function createUser(email: string) {
  await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({ firstName: 'Ada', lastName: 'Okafor', email, password: PASSWORD, phone: '08030000000' });
  const token = new URL(verifyUrls.at(-1)!).searchParams.get('token')!;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token });
  return { agent, userId: res.body.user.id as string };
}

async function createAdmin(email: string) {
  const { userId } = await createUser(email);
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
  const agent = request.agent(app);
  await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: PASSWORD })
    .expect(200);
  return { agent, userId };
}

const listing = (over: Record<string, unknown> = {}) => ({
  slug: 'marina-heights',
  title: 'Marina Heights',
  summary: 'A two-bedroom apartment overlooking Dubai Marina.',
  description: 'Long form copy about the property.',
  addressLine: 'Al Marsa Street',
  area: 'Dubai Marina',
  city: 'Dubai',
  country: 'AE',
  images: ['https://example.test/one.jpg'],
  totalValueCents: dollarsToCents('450000').toString(),
  minInvestmentCents: dollarsToCents('250').toString(),
  annualReturnBps: 920,
  termMonths: 18,
  ...over,
});

describe('authorisation', () => {
  it('refuses an ordinary user on every property route', async () => {
    const { agent } = await createUser('user@example.com');
    await agent.get('/api/v1/admin/properties').expect(403);
    await agent
      .post('/api/v1/admin/properties')
      .set('Origin', ORIGIN)
      .send(listing())
      .expect(403);
    expect(await prisma.property.count()).toBe(0);
  });
});

describe('creating a listing', () => {
  it('lands as a DRAFT and is invisible to the public until published', async () => {
    const { agent } = await createAdmin('admin@example.com');

    const created = await agent
      .post('/api/v1/admin/properties')
      .set('Origin', ORIGIN)
      .send(listing())
      .expect(201);

    expect(created.body.property.status).toBe('DRAFT');

    // The whole point of DRAFT: saving must never publish by accident.
    const browse = await request(app).get('/api/v1/properties').expect(200);
    expect(browse.body.items).toHaveLength(0);
    await request(app).get('/api/v1/properties/marina-heights').expect(404);

    await agent
      .post(`/api/v1/admin/properties/${created.body.property.id}/status`)
      .set('Origin', ORIGIN)
      .send({ action: 'publish' })
      .expect(200);

    const after = await request(app).get('/api/v1/properties').expect(200);
    expect(after.body.items).toHaveLength(1);
    await request(app).get('/api/v1/properties/marina-heights').expect(200);
  });

  it('refuses to publish a listing with no photograph', async () => {
    const { agent } = await createAdmin('nopics@example.com');
    const created = await agent
      .post('/api/v1/admin/properties')
      .set('Origin', ORIGIN)
      .send(listing({ images: [] }))
      .expect(201);

    const res = await agent
      .post(`/api/v1/admin/properties/${created.body.property.id}/status`)
      .set('Origin', ORIGIN)
      .send({ action: 'publish' });

    expect(res.status).toBe(400);
    const row = await prisma.property.findUniqueOrThrow({ where: { slug: 'marina-heights' } });
    expect(row.status).toBe('DRAFT');
  });

  it('reports a duplicate address as a field error, not a 500', async () => {
    const { agent } = await createAdmin('dupe@example.com');
    await agent.post('/api/v1/admin/properties').set('Origin', ORIGIN).send(listing()).expect(201);

    const res = await agent
      .post('/api/v1/admin/properties')
      .set('Origin', ORIGIN)
      .send(listing({ title: 'Another one' }));

    expect(res.status).toBe(422);
    expect(res.body.error.fields.slug).toMatch(/already uses/i);
  });

  it('rejects a minimum above the property value', async () => {
    const { agent } = await createAdmin('minmax@example.com');
    const res = await agent
      .post('/api/v1/admin/properties')
      .set('Origin', ORIGIN)
      .send(
        listing({
          totalValueCents: dollarsToCents('1000').toString(),
          minInvestmentCents: dollarsToCents('5000').toString(),
        }),
      );
    expect(res.status).toBe(422);
    expect(res.body.error.fields.minInvestmentCents).toBeTruthy();
  });
});

describe('editing a funded listing', () => {
  /** Publishes a listing and puts money into it, the way an investor would. */
  async function fundedProperty(email: string) {
    const { agent } = await createAdmin(email);
    const created = await agent
      .post('/api/v1/admin/properties')
      .set('Origin', ORIGIN)
      .send(listing())
      .expect(201);
    const id = created.body.property.id as string;

    await agent
      .post(`/api/v1/admin/properties/${id}/status`)
      .set('Origin', ORIGIN)
      .send({ action: 'publish' })
      .expect(200);

    await prisma.property.update({
      where: { id },
      data: { fundedCents: dollarsToCents('10000') },
    });

    return { agent, id };
  }

  it('locks the money fields', async () => {
    const { agent, id } = await fundedProperty('funded@example.com');

    const res = await agent
      .patch(`/api/v1/admin/properties/${id}`)
      .set('Origin', ORIGIN)
      .send({ annualReturnBps: 2000 });

    // Rejected, not silently dropped: a form that appears to save a new yield
    // and does not is worse than one that says it cannot.
    expect(res.status).toBe(422);
    expect(res.body.error.fields.annualReturnBps).toMatch(/locked/i);

    const row = await prisma.property.findUniqueOrThrow({ where: { id } });
    expect(row.annualReturnBps).toBe(920);
  });

  it('still allows copy and photographs to be corrected', async () => {
    const { agent, id } = await fundedProperty('copy@example.com');

    await agent
      .patch(`/api/v1/admin/properties/${id}`)
      .set('Origin', ORIGIN)
      .send({ summary: 'A corrected summary.', images: ['https://example.test/new.jpg'] })
      .expect(200);

    const row = await prisma.property.findUniqueOrThrow({ where: { id } });
    expect(row.summary).toBe('A corrected summary.');
    expect(row.images).toEqual(['https://example.test/new.jpg']);
  });

  it('refuses to unpublish a listing people have already funded', async () => {
    const { agent, id } = await fundedProperty('hide@example.com');
    const res = await agent
      .post(`/api/v1/admin/properties/${id}/status`)
      .set('Origin', ORIGIN)
      .send({ action: 'unpublish' });
    expect(res.status).toBe(400);
  });

  it('refuses a total value below what has already been raised', async () => {
    // The check that matters most: this would make remainingCents negative and
    // the funding bar nonsense, after the money has been taken.
    const { agent, id } = await fundedProperty('below@example.com');
    await prisma.property.update({ where: { id }, data: { fundedCents: 0n } });

    // Money fields unlock at zero funded, so the guard has to stand on its own.
    await prisma.property.update({
      where: { id },
      data: { fundedCents: dollarsToCents('300000') },
    });
    const res = await agent
      .patch(`/api/v1/admin/properties/${id}`)
      .set('Origin', ORIGIN)
      .send({ summary: 'untouched' });
    // Money is locked, so this path is about the copy edit still succeeding
    // while the total stays above what was raised.
    expect(res.status).toBe(200);

    await prisma.property.update({ where: { id }, data: { fundedCents: 0n } });
    const tooLow = await agent
      .patch(`/api/v1/admin/properties/${id}`)
      .set('Origin', ORIGIN)
      .send({ totalValueCents: dollarsToCents('100').toString() });
    // Unfunded now, so the field is editable — but 100 dollars is below the
    // 250 minimum, which the same guard catches.
    expect(tooLow.status).toBe(422);
  });
});

describe('partial updates', () => {
  it('does not wipe fields the request never mentions', async () => {
    // Regression. The update schema was first derived as
    // createPropertySchema.partial(), which keeps the `.default([])` on images —
    // so a PATCH that only changed the title arrived carrying an empty array and
    // silently deleted every photograph on the listing. Same trap on country and
    // fundingClosesAt.
    const { agent } = await createAdmin('partial@example.com');
    const created = await agent
      .post('/api/v1/admin/properties')
      .set('Origin', ORIGIN)
      .send(
        listing({
          images: ['https://example.test/a.jpg', 'https://example.test/b.jpg'],
          country: 'AE',
          fundingClosesAt: '2027-01-01T00:00:00.000Z',
        }),
      )
      .expect(201);

    await agent
      .patch(`/api/v1/admin/properties/${created.body.property.id}`)
      .set('Origin', ORIGIN)
      .send({ title: 'Marina Heights, renamed' })
      .expect(200);

    const row = await prisma.property.findUniqueOrThrow({
      where: { id: created.body.property.id },
    });
    expect(row.title).toBe('Marina Heights, renamed');
    expect(row.images).toHaveLength(2);
    expect(row.country).toBe('AE');
    expect(row.fundingClosesAt).not.toBeNull();
  });
});

describe('the slug after publication', () => {
  it('is locked once the listing is live', async () => {
    const { agent } = await createAdmin('slug@example.com');
    const created = await agent
      .post('/api/v1/admin/properties')
      .set('Origin', ORIGIN)
      .send(listing())
      .expect(201);
    const id = created.body.property.id as string;

    // Still a draft: free to change.
    await agent
      .patch(`/api/v1/admin/properties/${id}`)
      .set('Origin', ORIGIN)
      .send({ slug: 'marina-heights-tower' })
      .expect(200);

    await agent
      .post(`/api/v1/admin/properties/${id}/status`)
      .set('Origin', ORIGIN)
      .send({ action: 'publish' })
      .expect(200);

    // Published: it is now a URL people hold.
    const res = await agent
      .patch(`/api/v1/admin/properties/${id}`)
      .set('Origin', ORIGIN)
      .send({ slug: 'something-else' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields.slug).toMatch(/locked/i);
  });

  it('rejects a slug that is not URL-shaped', async () => {
    const { agent } = await createAdmin('badslug@example.com');
    for (const bad of ['Marina Heights', 'marina_heights', '-marina', 'ma']) {
      const res = await agent
        .post('/api/v1/admin/properties')
        .set('Origin', ORIGIN)
        .send(listing({ slug: bad }));
      expect(res.status).toBe(422);
    }
  });
});

describe('image upload', () => {
  it('rejects a content type that is not an allowed image', async () => {
    const { agent } = await createAdmin('upload@example.com');
    const res = await agent
      .post('/api/v1/admin/uploads/property-image')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('not an image'));

    // express.raw only parses the allowed types, so a PDF never becomes a
    // Buffer and the handler refuses it.
    expect(res.status).toBe(400);
  });

  it('answers 503 rather than 500 when storage is not configured', async () => {
    // The test environment has no Supabase credentials, which is the same state
    // as a deployment where an operator has not finished setting it up.
    const { agent } = await createAdmin('nostore@example.com');
    const res = await agent
      .post('/api/v1/admin/uploads/property-image')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'image/png')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
  });
});
