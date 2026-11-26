const jwt = require('jsonwebtoken');

const mockOutreach = {
  LEAD_STATUSES: ['new', 'contacted', 'replied', 'interested', 'demo_booked', 'not_interested', 'unsubscribed', 'bounced', 'invalid'],
  CAMPAIGN_STATUSES: ['draft', 'launching', 'running', 'paused', 'attention', 'cancelled', 'completed'],
  SEND_STATUSES: ['queued', 'sending', 'sent', 'failed', 'skipped', 'held', 'needs_review'],
  outreachReady: jest.fn(() => true),
  safeSenderConfig: jest.fn(() => ({ name: 'Msingi Schools Team', role: 'Schools Team', replyTo: 'sales@example.test' })),
  getLeadStats: jest.fn().mockResolvedValue({ total: 2 }),
  listLeads: jest.fn().mockResolvedValue({ data: [{ id: 'lead_1' }], pagination: { page: 1, limit: 50, total: 1, pages: 1 } }),
  importLeads: jest.fn().mockResolvedValue({ created: 1, updated: 0, skipped: 0, suppressed: 0, errors: [], errorCount: 0 }),
  getLead: jest.fn().mockResolvedValue({ id: 'lead_1' }),
  createLead: jest.fn().mockResolvedValue({ id: 'lead_1' }),
  updateLead: jest.fn().mockResolvedValue({ id: 'lead_1', status: 'replied' }),
  addLeadNote: jest.fn().mockResolvedValue({ id: 'lead_1' }),
  listSuppressions: jest.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 50, total: 0, pages: 1 } }),
  addSuppression: jest.fn().mockResolvedValue({ email: 'office@example.test' }),
  listTemplates: jest.fn().mockResolvedValue([]),
  getTemplate: jest.fn().mockResolvedValue({ id: 'otpl_1' }),
  createTemplate: jest.fn().mockResolvedValue({ id: 'otpl_1' }),
  updateTemplate: jest.fn().mockResolvedValue({ id: 'otpl_1' }),
  previewTemplate: jest.fn().mockResolvedValue({ subject: 'Hello', html: '<p>Hello</p>', text: 'Hello' }),
  testTemplate: jest.fn().mockResolvedValue({ sent: true }),
  listCampaigns: jest.fn().mockResolvedValue([]),
  createCampaign: jest.fn().mockResolvedValue({ id: 'camp_1' }),
  getCampaign: jest.fn().mockResolvedValue({ id: 'camp_1' }),
  launchCampaign: jest.fn().mockResolvedValue({ leads: 1, sends: 3 }),
  setCampaignStatus: jest.fn().mockResolvedValue({ id: 'camp_1' }),
  retrySend: jest.fn().mockResolvedValue({ queued: true }),
  recordSendOutcome: jest.fn().mockResolvedValue({ updated: true }),
};

jest.mock('../../services/outreachService', () => mockOutreach);
jest.mock('../../services/sessionService', () => ({}));

let mockOperators = [];
jest.mock('../../utils/model', () => ({
  _model: jest.fn(collection => collection === 'platform_operators' ? {
    findOne: jest.fn(filter => ({ lean: jest.fn().mockResolvedValue(mockOperators.find(operator => operator.id === filter.id) || null) })),
  } : {}),
}));

const express = require('express');
const cookieParser = require('cookie-parser');
const supertest = require('supertest');
const router = require('../../routes/platform-outreach');

const ORIGINAL_ENV = { ...process.env };
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/platform/outreach', router);

function tokenFor(id) {
  const operator = mockOperators.find(item => item.id === id);
  return jwt.sign({ sub: 'platform-operator', operatorId: id, name: operator.name, email: operator.email, tier: operator.tier }, 'test-platform-secret', { expiresIn: '2h' });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, PLATFORM_JWT_SECRET: 'test-platform-secret', NODE_ENV: 'test' };
  mockOperators = [
    { id: 'op_sales', name: 'Sam Sales', email: 'sam@msingi.io', tier: 'support', template: 'sales', isActive: true, status: 'active' },
    { id: 'op_viewer', name: 'Vic Viewer', email: 'vic@msingi.io', tier: 'support', template: 'viewer', isActive: true, status: 'active' },
    { id: 'op_send_only', name: 'Sam Send', email: 'send@msingi.io', tier: 'support', template: 'custom', capabilities: ['outreach.send'], isActive: true, status: 'active' },
  ];
});

afterAll(() => { process.env = ORIGINAL_ENV; });

describe('platform outreach routes', () => {
  test('requires a platform session', async () => {
    const response = await supertest(app).get('/api/platform/outreach/leads');
    expect(response.status).toBe(401);
  });

  test('sales can list and import leads', async () => {
    const cookie = `platform_token=${tokenFor('op_sales')}`;
    const list = await supertest(app).get('/api/platform/outreach/leads').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([{ id: 'lead_1' }]);

    const imported = await supertest(app).post('/api/platform/outreach/leads/import').set('Cookie', cookie).send({ csv: 'school_name,email\nExample,office@example.test' });
    expect(imported.status).toBe(200);
    expect(mockOutreach.importLeads).toHaveBeenCalled();
  });

  test('a read-only viewer cannot import or send', async () => {
    const cookie = `platform_token=${tokenFor('op_viewer')}`;
    expect((await supertest(app).post('/api/platform/outreach/leads/import').set('Cookie', cookie).send({ csv: 'school_name,email\nExample,office@example.test' })).status).toBe(403);
    expect((await supertest(app).post('/api/platform/outreach/templates/otpl_1/test').set('Cookie', cookie).send({ to: 'test@example.test' })).status).toBe(403);
  });

  test('mixed-case platform URLs cannot bypass outreach read permissions', async () => {
    const cookie = `platform_token=${tokenFor('op_viewer')}`;
    const response = await supertest(app).get('/API/PLATFORM/outreach/leads').set('Cookie', cookie);
    expect(response.status).toBe(403);
  });

  test('sales can preview, test and launch with the separate send capability', async () => {
    const cookie = `platform_token=${tokenFor('op_sales')}`;
    expect((await supertest(app).post('/api/platform/outreach/templates/otpl_1/preview').set('Cookie', cookie).send({})).status).toBe(200);
    expect((await supertest(app).post('/api/platform/outreach/templates/otpl_1/test').set('Cookie', cookie).send({ to: 'test@example.test' })).status).toBe(200);
    expect((await supertest(app).post('/api/platform/outreach/campaigns/camp_1/launch').set('Cookie', cookie).send({ dailyLimit: 25 })).status).toBe(200);
    expect((await supertest(app).post('/api/platform/outreach/campaigns/camp_1/launch').set('Cookie', cookie).send({ scheduledAt: new Date('2026-11-26T09:00:00+03:00').toISOString(), dailyLimit: 25 })).status).toBe(200);
  });

  test('invalid CSV input is rejected before the service runs', async () => {
    const cookie = `platform_token=${tokenFor('op_sales')}`;
    const response = await supertest(app).post('/api/platform/outreach/leads/import').set('Cookie', cookie).send({ csv: '' });
    expect(response.status).toBe(422);
    expect(mockOutreach.importLeads).not.toHaveBeenCalled();
  });

  test('a send-only operator cannot use a lead in a test email', async () => {
    const cookie = `platform_token=${tokenFor('op_send_only')}`;
    const response = await supertest(app)
      .post('/api/platform/outreach/templates/otpl_1/test')
      .set('Cookie', cookie)
      .send({ to: 'test@example.test', leadId: 'lead_1' });
    expect(response.status).toBe(400);
    expect(mockOutreach.testTemplate).not.toHaveBeenCalled();
  });
});
