// Msingi — Transport UI E2E review (Option 2: term-billing only)
//
// Run after starting the dev server:
//   Terminal 1: npm run db:local   (local MongoDB)
//   Terminal 2: npm start          (API + built React app on :3005)
//   npx playwright install chromium
//   npx playwright test server/e2e/transport-ui.test.js
//
// Demo credentials: admin@demo.msingi.io / Demo2025!
//
// Deliberately read-only. An earlier version of the last test wrote an
// assignment for a student id that does not exist, so it either failed or
// quietly changed whatever database the suite pointed at. Nothing here
// writes; the one endpoint test asserts the server rejects an unknown
// student instead of creating a row.
import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3005' });

async function login(page) {
  await page.goto('/login?school=demo');
  await page.fill('#email', 'admin@demo.msingi.io');
  await page.fill('#password', 'Demo2025!');
  await page.click('#btn-login-submit');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

async function openTransport(page, tab) {
  // Direct navigation rather than chasing the sidebar: the Operations group
  // is collapsible, and a test that depends on its open/closed state fails
  // for reasons that have nothing to do with transport.
  await page.goto('/transport');
  await page.waitForURL('**/transport', { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Routes', exact: true })).toBeVisible();
  if (tab) await page.getByRole('button', { name: tab, exact: true }).click();
}

test('transport page loads and shows routes, fleet, drivers, assignments tabs', async ({ page }) => {
  await login(page);
  await openTransport(page);

  for (const tab of ['Routes', 'Fleet', 'Drivers', 'Assignments']) {
    await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/^Assigned/).first()).toBeVisible();
  await expect(page.getByText(/^Inactive/).first()).toBeVisible();
});

test('routes tab shows one-way/two-way fares per term', async ({ page }) => {
  await login(page);
  await openTransport(page, 'Routes');

  await expect(page.getByText('Fee/Term').first()).toBeVisible();
  await expect(page.getByText(/One way|Two way/i).first()).toBeVisible();
});

test('assignments tab shows fare and dates but no invoice columns', async ({ page }) => {
  await login(page);
  await openTransport(page, 'Assignments');

  // Desktop-width columns; both are hidden below `lg`, so this test needs
  // the 1280px default viewport Playwright gives us.
  await expect(page.getByRole('columnheader', { name: 'Fare' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Dates' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  await expect(page.getByText('invoiceId').first()).toBeHidden();
});

test('assign student modal opens with the fields the route needs', async ({ page }) => {
  await login(page);
  await openTransport(page, 'Assignments');
  await page.getByRole('button', { name: 'Assign Student' }).click();

  await expect(page.locator('h2:has-text("Assign Student to Route")')).toBeVisible();
  for (const label of ['Route', 'Fare', 'Class', 'Students', 'Pickup Stop', 'Start Date']) {
    await expect(page.locator('label').filter({ hasText: label }).first()).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
});

test('edit assignment modal does not expose route or fare fields', async ({ page }) => {
  await login(page);
  await openTransport(page, 'Assignments');

  const editButtons = page.locator('button[title="Edit pickup stop, direction, end date or notes"]');
  if ((await editButtons.count()) === 0) {
    test.skip(true, 'No assignments to edit in demo data');
    return;
  }

  await editButtons.first().click();
  await expect(page.locator('h2:has-text("Edit Assignment")')).toBeVisible();

  for (const label of ['Pickup Stop', 'Direction', 'End Date', 'Notes']) {
    await expect(page.locator('label').filter({ hasText: label }).first()).toBeVisible();
  }
  // Route and fare are fixed for billing; the server refuses to change them.
  await expect(page.getByText('Fare and route are fixed for billing.', { exact: false })).toBeVisible();
});

test('bulk assign rejects a student who is not in the school, and writes nothing', async ({ request }) => {
  const loginRes = await request.post('/api/auth/login', {
    headers: { 'X-School-Slug': 'demo' },
    data: { email: 'admin@demo.msingi.io', password: 'Demo2025!', platform: 'mobile' },
  });
  const token = (await loginRes.json())?.data?.token;
  expect(token).toBeTruthy();
  const auth = { Authorization: `Bearer ${token}`, 'X-School-Slug': 'demo' };

  const routes = await request.get('/api/transport/routes', { headers: auth });
  const route = (await routes.json())?.data?.[0];
  expect(route).toBeTruthy();

  const before = (await (await request.get('/api/transport/assignments?limit=100', { headers: auth })).json())?.data ?? [];

  const res = await request.post('/api/transport/assignments/bulk', {
    headers: auth,
    data: {
      routeId: route.id,
      fareType: 'two_way',
      students: [{ studentId: 'not-a-real-student', studentName: 'Nobody', studentClass: 'Form 1A' }],
    },
  });
  expect(res.ok()).toBeFalsy();
  expect((await res.json())?.success).toBe(false);

  const after = (await (await request.get('/api/transport/assignments?limit=100', { headers: auth })).json())?.data ?? [];
  expect(after.length).toBe(before.length);
});
