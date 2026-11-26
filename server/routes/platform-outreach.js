/* ============================================================
   Platform outreach API — /api/platform/outreach/*

   Mounted separately from the large platform.js router so the
   sales workspace has one clear home. Authentication, CSRF and
   capability enforcement are identical to the rest of /platform.
   ============================================================ */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { platformSession, requirePlatformCapability } = require('../middleware/auth');
const { ok, created, E, strParam } = require('../utils/response');
const outreach = require('../services/outreachService');

const router = express.Router();
router.use(platformSession, requirePlatformCapability);

const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many outreach actions. Try again shortly.' } },
});

function actor(req) {
  return req.platformOperator
    ? { userId: req.platformOperator.id, name: req.platformOperator.name, email: req.platformOperator.email, role: `platform_${req.platformOperator.tier}` }
    : { userId: 'platform', name: 'Platform Admin', email: null, role: 'platform_owner' };
}

function fail(error, res, status = 400) {
  return E.fail(res, 'OUTREACH_ERROR', String(error?.message || error || 'Request failed.'), status);
}

const LeadPatchSchema = z.object({
  schoolName: z.string().trim().min(1).max(200).optional(),
  contactName: z.string().trim().max(160).optional().nullable(),
  email: z.string().trim().email().max(300).optional(),
  phone: z.string().trim().max(50).optional().nullable(),
  role: z.string().trim().max(100).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  schoolSize: z.string().trim().max(60).optional().nullable(),
  curriculum: z.string().trim().max(120).optional().nullable(),
  website: z.string().trim().max(300).optional().nullable(),
  source: z.string().trim().max(100).optional().nullable(),
  ownerId: z.string().trim().max(120).optional().nullable(),
  ownerName: z.string().trim().max(160).optional().nullable(),
  status: z.enum(outreach.LEAD_STATUSES).optional(),
  nextFollowUpAt: z.string().datetime().optional().nullable(),
  demoRequestId: z.string().trim().max(120).optional().nullable(),
});

const TemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).optional(),
  category: z.enum(['initial', 'followup']).optional(),
  subject: z.string().trim().min(1).max(200),
  preheader: z.string().trim().max(300).optional(),
  headline: z.string().trim().min(1).max(200),
  intro: z.string().trim().min(1).max(3000),
  benefits: z.array(z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500) })).min(1).max(3),
  ctaLabel: z.string().trim().min(1).max(80).optional(),
  ctaUrl: z.string().trim().min(1).max(500).optional(),
  closing: z.string().trim().min(1).max(2000),
});

const CampaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  templateIds: z.array(z.string().trim().min(1).max(120)).min(1).max(3).optional(),
  leadIds: z.array(z.string().trim().min(1).max(120)).max(5000).optional(),
  dailyLimit: z.coerce.number().int().min(1).max(100).optional(),
});

const OutreachSettingsSchema = z.object({
  enabled: z.boolean(),
  fromName: z.string().trim().min(1).max(120),
  fromRole: z.string().trim().min(1).max(120),
  replyTo: z.union([z.string().trim().email().max(300), z.literal('')]),
  dailyLimit: z.coerce.number().int().min(1).max(100),
  logoUrl: z.string().trim().url().max(500),
  phone: z.string().trim().max(50),
  trustLine: z.string().trim().max(300),
  pricingLine: z.string().trim().max(300),
  legalName: z.string().trim().min(1).max(200),
  postalAddress: z.string().trim().max(300),
});

router.get('/config', async (_req, res) => {
  try {
    const settings = await outreach.getOutreachSettings();
    return ok(res, {
      ready: await outreach.outreachReady(),
      settings,
      dailyLimit: settings.dailyLimit,
      statuses: { leads: outreach.LEAD_STATUSES, campaigns: outreach.CAMPAIGN_STATUSES, sends: outreach.SEND_STATUSES },
    });
  } catch (error) { return fail(error, res, 500); }
});

router.put('/settings', actionLimiter, async (req, res) => {
  const parsed = OutreachSettingsSchema.safeParse(req.body || {});
  if (!parsed.success) return E.validation(res, parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })));
  try { return ok(res, await outreach.updateOutreachSettings({ input: parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.get('/leads/stats', async (_req, res) => {
  try { return ok(res, await outreach.getLeadStats()); } catch (error) { return fail(error, res, 500); }
});

router.post('/leads', actionLimiter, async (req, res) => {
  const parsed = LeadPatchSchema.omit({ status: true, ownerId: true, ownerName: true }).safeParse(req.body || {});
  if (!parsed.success) return E.validation(res, parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })));
  try { return created(res, await outreach.createLead({ input: parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.get('/leads', async (req, res) => {
  try {
    const result = await outreach.listLeads({
      q: strParam(req.query.q) || '', status: strParam(req.query.status) || '',
      page: req.query.page, pageSize: req.query.pageSize,
    });
    return ok(res, result.data, result.pagination);
  } catch (error) { return fail(error, res, 500); }
});

router.post('/leads/import', actionLimiter, async (req, res) => {
  const parsed = z.object({ csv: z.string().min(1).max(2 * 1024 * 1024) }).safeParse(req.body || {});
  if (!parsed.success) return E.validation(res, parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })));
  try { return ok(res, await outreach.importLeads({ csv: parsed.data.csv, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const lead = await outreach.getLead(req.params.id);
    return lead ? ok(res, lead) : E.notFound(res, 'Lead not found.');
  } catch (error) { return fail(error, res, 500); }
});

router.patch('/leads/:id', actionLimiter, async (req, res) => {
  const parsed = LeadPatchSchema.safeParse(req.body || {});
  if (!parsed.success) return E.validation(res, parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })));
  try { return ok(res, await outreach.updateLead({ id: req.params.id, patch: parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.post('/leads/:id/notes', actionLimiter, async (req, res) => {
  const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body || {});
  if (!parsed.success) return E.badRequest(res, 'Write a note first.');
  try { return ok(res, await outreach.addLeadNote({ id: req.params.id, body: parsed.data.body, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.get('/templates', async (_req, res) => {
  try { return ok(res, await outreach.listTemplates()); } catch (error) { return fail(error, res, 500); }
});

router.post('/templates', actionLimiter, async (req, res) => {
  const parsed = TemplateSchema.safeParse(req.body || {});
  if (!parsed.success) return E.validation(res, parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })));
  try { return created(res, await outreach.createTemplate({ input: parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.get('/templates/:id', async (req, res) => {
  try {
    const template = await outreach.getTemplate(req.params.id);
    return template ? ok(res, template) : E.notFound(res, 'Template not found.');
  } catch (error) { return fail(error, res, 500); }
});

router.patch('/templates/:id', actionLimiter, async (req, res) => {
  const parsed = TemplateSchema.partial().safeParse(req.body || {});
  if (!parsed.success) return E.validation(res, parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })));
  try { return ok(res, await outreach.updateTemplate({ id: req.params.id, input: parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.post('/templates/:id/preview', async (req, res) => {
  const parsed = z.object({ leadId: z.string().trim().max(120).optional() }).safeParse(req.body || {});
  if (!parsed.success) return E.badRequest(res, 'Invalid preview request.');
  try { return ok(res, await outreach.previewTemplate({ templateId: req.params.id, ...parsed.data })); } catch (error) { return fail(error, res); }
});

router.post('/templates/:id/test', actionLimiter, async (req, res) => {
  const parsed = z.object({ to: z.string().trim().email().max(300) }).strict().safeParse(req.body || {});
  if (!parsed.success) return E.badRequest(res, 'Enter a valid test email address.');
  try { return ok(res, await outreach.testTemplate({ templateId: req.params.id, ...parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.get('/campaigns', async (_req, res) => {
  try { return ok(res, await outreach.listCampaigns()); } catch (error) { return fail(error, res, 500); }
});

router.post('/campaigns', actionLimiter, async (req, res) => {
  const parsed = CampaignSchema.safeParse(req.body || {});
  if (!parsed.success) return E.validation(res, parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })));
  try { return created(res, await outreach.createCampaign({ input: parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const campaign = await outreach.getCampaign({
      id: req.params.id,
      page: req.query.page,
      pageSize: req.query.pageSize,
      status: strParam(req.query.status) || '',
    });
    return campaign ? ok(res, campaign) : E.notFound(res, 'Campaign not found.');
  } catch (error) { return fail(error, res, 500); }
});

router.post('/campaigns/:id/launch', actionLimiter, async (req, res) => {
  const parsed = z.object({ scheduledAt: z.string().datetime().optional(), dailyLimit: z.coerce.number().int().min(1).max(100).optional() }).safeParse(req.body || {});
  if (!parsed.success) return E.validation(res, parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })));
  try { return ok(res, await outreach.launchCampaign({ id: req.params.id, ...parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.post('/campaigns/:id/pause', actionLimiter, async (req, res) => {
  try { return ok(res, await outreach.setCampaignStatus({ id: req.params.id, status: 'paused', actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.post('/campaigns/:id/resume', actionLimiter, async (req, res) => {
  try { return ok(res, await outreach.setCampaignStatus({ id: req.params.id, status: 'running', actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.post('/campaigns/:id/cancel', actionLimiter, async (req, res) => {
  try { return ok(res, await outreach.setCampaignStatus({ id: req.params.id, status: 'cancelled', actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.post('/sends/:id/retry', actionLimiter, async (req, res) => {
  try { return ok(res, await outreach.retrySend({ id: req.params.id, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.post('/sends/:id/outcome', actionLimiter, async (req, res) => {
  const parsed = z.object({ outcome: z.enum(['replied', 'bounced', 'unsubscribed']) }).safeParse(req.body || {});
  if (!parsed.success) return E.badRequest(res, 'Choose a valid outcome.');
  try { return ok(res, await outreach.recordSendOutcome({ id: req.params.id, ...parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

router.get('/suppressions', async (req, res) => {
  try {
    const result = await outreach.listSuppressions({ q: strParam(req.query.q) || '', page: req.query.page, pageSize: req.query.pageSize });
    return ok(res, result.data, result.pagination);
  } catch (error) { return fail(error, res, 500); }
});

router.post('/suppressions', actionLimiter, async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email().max(300), reason: z.string().trim().max(120).optional() }).safeParse(req.body || {});
  if (!parsed.success) return E.badRequest(res, 'Enter a valid email address.');
  try { return created(res, await outreach.addSuppression({ ...parsed.data, actor: actor(req) })); } catch (error) { return fail(error, res); }
});

module.exports = router;
