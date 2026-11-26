jest.mock('../../services/outreachService', () => ({
  verifyUnsubscribeToken: jest.fn(),
  unsubscribeByToken: jest.fn(),
}));

const express = require('express');
const supertest = require('supertest');
const outreach = require('../../services/outreachService');
const router = require('../../routes/outreach-public');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/outreach', router);

beforeEach(() => { jest.clearAllMocks(); });

describe('public outreach unsubscribe', () => {
  test('shows a styled confirmation page for a valid token', async () => {
    outreach.verifyUnsubscribeToken.mockReturnValue({ sendId: 'send_1', exp: Date.now() + 1000 });
    const response = await supertest(app).get('/api/outreach/unsubscribe/valid.token');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Unsubscribe from Msingi emails');
    expect(response.text).toContain('name="token" value="valid.token"');
  });

  test('rejects an invalid link', async () => {
    outreach.verifyUnsubscribeToken.mockReturnValue(null);
    const response = await supertest(app).get('/api/outreach/unsubscribe/bad.token');
    expect(response.status).toBe(400);
    expect(response.text).toContain('Link unavailable');
  });

  test('supports the confirmation form POST', async () => {
    outreach.unsubscribeByToken.mockResolvedValue({ ok: true, email: 'office@example.test' });
    const response = await supertest(app).post('/api/outreach/unsubscribe').type('form').send({ token: 'valid.token' });
    expect(response.status).toBe(200);
    expect(outreach.unsubscribeByToken).toHaveBeenCalledWith('valid.token');
  });

  test('returns a branded confirmation page for browser form submissions', async () => {
    outreach.unsubscribeByToken.mockResolvedValue({ ok: true, email: 'office@example.test' });
    const response = await supertest(app)
      .post('/api/outreach/unsubscribe')
      .set('Accept', 'text/html')
      .type('form')
      .send({ token: 'valid.token' });
    expect(response.status).toBe(200);
    expect(response.text).toContain('You have been unsubscribed');
    expect(response.text).toContain('api/public/platform-asset/logo');
  });

  test('supports one-click mail-client POST to the token URL', async () => {
    outreach.unsubscribeByToken.mockResolvedValue({ ok: true, email: 'office@example.test' });
    const response = await supertest(app).post('/api/outreach/unsubscribe/valid.token').send({ 'List-Unsubscribe': 'One-Click' });
    expect(response.status).toBe(200);
    expect(outreach.unsubscribeByToken).toHaveBeenCalledWith('valid.token');
  });
});
