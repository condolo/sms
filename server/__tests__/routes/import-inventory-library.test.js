/* ============================================================
   Import/Export for Inventory and Library (2026-09, school-requested)

   Neither module had import/export at all before this — a school
   asked for it directly, alongside richer Add Item/Add Book fields
   (date of purchase, where bought, supplier, value, photo). Covers:

     1. Downloadable templates exist for both types (GET /template/:type)
        and their notes describe the actual, current field set.
     2. Import (_importInventoryItems): itemCode/name/categoryName
        required, categoryName resolved to categoryId the same way
        className resolves for students, duplicate itemCode silently
        skipped (matching _importClasses' own convention), origin
        validated against the shared PURCHASE_ORIGINS list, numeric
        fields (quantity, purchaseValue) validated.
     3. Import (_importLibraryBooks): only title required, no
        duplicate-title check (two schools may legitimately catalogue
        multiple copies/editions), same origin/purchaseValue validation.
     4. Export (GET /export/inventory and /export/library): correct
        headers, and photo is deliberately NOT one of them (a base64
        image has no place in a CSV export).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) };
}
function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => doc[k] === v);
  }
  return {
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) ?? null),
    insertMany: async (newDocs) => { docs.push(...newDocs); return newDocs; },
    _docs: () => docs,
  };
}

const SCHOOL = 'school_test_001';

let mockCurrentUser;
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? SCHOOL }),
  tenantModel: jest.fn((col) => mockStores[col]),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

const express   = require('express');
const supertest = require('supertest');
const importExportRouter = require('../../routes/import-export');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: 'text/csv' }));
  app.use('/api/import-export', importExportRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockStores = {
    schools:             makeStore([{ id: SCHOOL }]),
    inventory_items:     makeStore([]),
    inventory_categories: makeStore([{ id: 'cat_ict', schoolId: SCHOOL, name: 'ICT' }]),
    library_books:       makeStore([]),
  };
});

describe('GET /api/import-export/template/inventory', () => {
  test('downloads a CSV with the current field set', async () => {
    const res = await supertest(buildApp()).get('/api/import-export/template/inventory');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/itemCode,name,categoryName,quantity,unit,location,status,purchaseDate,origin,supplier,purchaseValue/);
    expect(res.text).toMatch(/origin\s+— OPTIONAL: local \| imported_china \| imported_other/);
  });
});

describe('GET /api/import-export/template/library', () => {
  test('downloads a CSV with the current field set', async () => {
    const res = await supertest(buildApp()).get('/api/import-export/template/library');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/title,author,isbn,category,publisher,publishYear,copies,location,purchaseDate,origin,supplier,purchaseValue/);
  });
});

describe('POST /api/import-export/inventory', () => {
  const BASE = { itemCode: 'ICT-100', name: 'Dell Laptop', categoryName: 'ICT' };

  test('a minimal valid row is created', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/inventory').send({ rows: [BASE] });
    expect(res.status).toBe(201);
    const doc = mockStores.inventory_items._docs()[0];
    expect(doc.categoryId).toBe('cat_ict');
    expect(doc.categoryName).toBe('ICT');
    expect(doc.status).toBe('active');
    expect(doc.unit).toBe('pcs');
  });

  test('missing itemCode is rejected', async () => {
    const { itemCode, ...row } = BASE;
    const res = await supertest(buildApp()).post('/api/import-export/inventory').send({ rows: [row] });
    expect(res.body.data.errors[0].field).toBe('itemCode');
  });

  test('missing categoryName is rejected', async () => {
    const { categoryName, ...row } = BASE;
    const res = await supertest(buildApp()).post('/api/import-export/inventory').send({ rows: [row] });
    expect(res.body.data.errors[0].field).toBe('categoryName');
  });

  test('an unknown category is rejected with a clear message', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/inventory').send({ rows: [{ ...BASE, categoryName: 'Nonexistent' }] });
    expect(res.body.data.errors[0].field).toBe('categoryName');
    expect(res.body.data.errors[0].message).toMatch(/not found/i);
  });

  test('a duplicate itemCode (already in the school) is silently skipped, not an error row', async () => {
    mockStores.inventory_items = makeStore([{ id: 'i1', schoolId: SCHOOL, itemCode: 'ICT-100' }]);
    const res = await supertest(buildApp()).post('/api/import-export/inventory').send({ rows: [BASE] });
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.skipped).toBe(1);
    expect(res.body.data.errors).toHaveLength(0);
  });

  test('a duplicate itemCode WITHIN the same batch is also skipped (not two items created)', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/inventory').send({ rows: [BASE, { ...BASE, name: 'Dell Laptop (2)' }] });
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.skipped).toBe(1);
  });

  test('an invalid origin is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/inventory').send({ rows: [{ ...BASE, origin: 'moon' }] });
    expect(res.body.data.errors[0].field).toBe('origin');
  });

  test('a valid origin, purchaseDate, supplier, and purchaseValue all round-trip', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/inventory').send({
      rows: [{ ...BASE, origin: 'imported_china', purchaseDate: '2026-01-15', supplier: 'ABC Traders', purchaseValue: '650000' }],
    });
    expect(res.status).toBe(201);
    const doc = mockStores.inventory_items._docs()[0];
    expect(doc.origin).toBe('imported_china');
    expect(doc.purchaseDate).toBe('2026-01-15');
    expect(doc.supplier).toBe('ABC Traders');
    expect(doc.purchaseValue).toBe(650000);
  });

  test('a negative purchaseValue is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/inventory').send({ rows: [{ ...BASE, purchaseValue: '-5' }] });
    expect(res.body.data.errors[0].field).toBe('purchaseValue');
  });
});

describe('POST /api/import-export/library', () => {
  test('a minimal valid row (title only) is created', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/library').send({ rows: [{ title: 'Things Fall Apart' }] });
    expect(res.status).toBe(201);
    const doc = mockStores.library_books._docs()[0];
    expect(doc.category).toBe('General');
    expect(doc.copies).toBe(1);
    expect(doc.available).toBe(1);
  });

  test('missing title is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/library').send({ rows: [{ author: 'Chinua Achebe' }] });
    expect(res.body.data.errors[0].field).toBe('title');
  });

  test('two rows with the IDENTICAL title both get created — no duplicate-title check', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/library')
      .send({ rows: [{ title: 'Atlas' }, { title: 'Atlas' }] });
    expect(res.body.data.created).toBe(2);
  });

  test('purchase fields round-trip the same way as Inventory', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/library').send({
      rows: [{ title: 'Atlas', origin: 'local', supplier: 'Text Book Centre', purchaseValue: '3500', purchaseDate: '2026-02-01' }],
    });
    const doc = mockStores.library_books._docs()[0];
    expect(doc.origin).toBe('local');
    expect(doc.supplier).toBe('Text Book Centre');
    expect(doc.purchaseValue).toBe(3500);
  });

  test('an invalid publishYear is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/library').send({ rows: [{ title: 'Atlas', publishYear: 'abcd' }] });
    expect(res.body.data.errors[0].field).toBe('publishYear');
  });
});

describe('GET /api/import-export/export/inventory and /export/library', () => {
  test('inventory export includes purchase fields but not photo', async () => {
    mockStores.inventory_items = makeStore([{
      id: 'i1', schoolId: SCHOOL, itemCode: 'ICT-100', name: 'Dell Laptop', categoryName: 'ICT',
      quantity: 10, unit: 'pcs', status: 'active', purchaseDate: '2026-01-15', origin: 'imported_china',
      supplier: 'ABC Traders', purchaseValue: 650000, photo: 'data:image/jpeg;base64,AAAA',
    }]);
    const res = await supertest(buildApp()).get('/api/import-export/export/inventory');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/itemCode,name,categoryName,quantity,unit,location,status,purchaseDate,origin,supplier,purchaseValue,createdAt/);
    expect(res.text).toMatch(/ICT-100.*ABC Traders.*650000/);
    expect(res.text).not.toMatch(/base64/);
  });

  test('library export includes purchase fields but not photo', async () => {
    mockStores.library_books = makeStore([{
      id: 'b1', schoolId: SCHOOL, title: 'Atlas', category: 'General', copies: 1,
      origin: 'local', supplier: 'Text Book Centre', purchaseValue: 3500, photo: 'data:image/jpeg;base64,AAAA',
    }]);
    const res = await supertest(buildApp()).get('/api/import-export/export/library');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/title,author,isbn,category,publisher,publishYear,copies,location,purchaseDate,origin,supplier,purchaseValue,createdAt/);
    expect(res.text).toMatch(/Atlas.*Text Book Centre.*3500/);
    expect(res.text).not.toMatch(/base64/);
  });
});
