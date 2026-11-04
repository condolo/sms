/* ============================================================
   server/routes/transport.js — fleet, drivers, and the route links

   Three things are worth pinning, because they are where a transport
   module quietly breaks a parent's evening:
     • a registration is unique per school (the office types a plate once);
     • a route that points at a vehicle/driver gets its display fields from
       that record, and a client cannot invent its own bus or driver name;
     • editing the vehicle or driver pushes the change onto the routes that
       use them, so the parent/student cards never show a stale plate.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
/* AuditService writes to its own collections; a no-op keeps the audit trail
   from being the reason a transport write test fails. */
jest.mock('../../services/audit', () => ({ log: async () => {} }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

const SCHOOL = 'sch_1';

/* ── minimal filmable collections ──────────────────────────── */
const mockStore = {};
const mockIdMatches = (doc, filter) => Object.entries(filter || {}).every(([k, v]) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('$in' in v) return v.$in.includes(doc[k]);
    if ('$ne' in v) return doc[k] !== v.$ne;
    if ('$gt' in v) return doc[k] > v.$gt;
  }
  return doc[k] === v;
});
function mockCollection(name) {
  const docs = (mockStore[name] = mockStore[name] || []);
  const chain = (rows) => ({ select: () => chain(rows), sort: () => chain(rows), skip: () => chain(rows), limit: () => chain(rows), lean: () => Promise.resolve(rows) });
  return {
    _docs: () => docs,
    find: (f) => chain(f ? docs.filter(d => mockIdMatches(d, f)) : [...docs]),
    findOne: (f) => chain(docs.find(d => mockIdMatches(d, f)) ?? null),
    deleteMany: (f) => { const keep = f ? docs.filter(d => !mockIdMatches(d, f)) : []; mockStore[name] = keep; return Promise.resolve({ deletedCount: docs.length - keep.length }); },
    updateOne: () => Promise.resolve({ modifiedCount: 1 }),
    create: async (doc) => { docs.push({ ...doc }); return { ...doc, toObject: () => ({ ...doc }) }; },
    countDocuments: (f) => Promise.resolve(f ? docs.filter(d => mockIdMatches(d, f)).length : docs.length),
    findOneAndUpdate: (f, update) => {
      const doc = docs.find(d => mockIdMatches(d, f));
      if (!doc) return chain(null);
      Object.assign(doc, update.$set);
      return chain({ ...doc });
    },
    findOneAndDelete: (f) => {
      const i = docs.findIndex(d => mockIdMatches(d, f));
      if (i < 0) return chain(null);
      return chain(docs.splice(i, 1)[0]);
    },
    updateMany: (f, update) => {
      const rows = docs.filter(d => mockIdMatches(d, f));
      rows.forEach(d => Object.assign(d, update.$set));
      return Promise.resolve({ modifiedCount: rows.length });
    },
    insertMany: async (rows) => { docs.push(...rows); return { insertedCount: rows.length }; },
    aggregate: () => Promise.resolve([]),
  };
}

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (name) => mockCollection(name),
}));
/* rbac() resolves the role's permissions from role_permissions (and the
   caller's own overrides). The super-role check runs first and returns true
   for admin/superadmin, so this never fires for the cases above — but it must
   exist or the middleware answers 500 before any handler runs. */
jest.mock('../../middleware/rbac', () => {
  const SUPER = new Set(['admin', 'superadmin']);
  return {
    rbac: () => (req, res, next) => {
      const roles = req.jwtUser?.roles ?? [req.jwtUser?.role ?? ''];
      if (!req.jwtUser?.schoolId || (!SUPER.has(req.jwtUser.role) && !roles.some(r => SUPER.has(r)))) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'denied' } });
      }
      next();
    },
    hasPermission: async () => true,
    hasExplicitSubGrant: async () => false,
    invalidatePermCache: () => {},
    _mergeUserOverrides: (a) => a,
    _loadPerms: async () => ({}),
    _loadUserPerms: async () => null,
  };
});

const express   = require('express');
const supertest = require('supertest');
const transportRouter = require('../../routes/transport');

const app = express();
app.use(express.json());
app.use('/api/transport', transportRouter);

const admin = () => { global.__mockJwtUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin' }; };

beforeEach(() => {
  admin();
  for (const k of Object.keys(mockStore)) delete mockStore[k];
});

const VEHICLE = {
  registration: 'KDH 485Z', vehicleType: 'bus', make: 'Toyota', model: 'Coaster',
  capacity: 40, insuranceExpiry: '2027-12-31', inspectionExpiry: '2026-09-30',
};

describe('fleet', () => {
  test('a registration may only be used once per school', async () => {
    const first = await supertest(app).post('/api/transport/vehicles').send(VEHICLE);
    expect(first.status).toBe(201);

    const dupe = await supertest(app).post('/api/transport/vehicles').send(VEHICLE);
    expect(dupe.status).toBe(409);
  });

  test('create returns the vehicle with its (empty) route list', async () => {
    const res = await supertest(app).post('/api/transport/vehicles').send(VEHICLE);
    expect(res.body.data).toMatchObject({ registration: 'KDH 485Z', vehicleType: 'bus', capacity: 40, status: 'active' });
    expect(res.body.data.routes).toEqual([]);
  });

  test('editing the vehicle pushes the change onto the routes that use it', async () => {
    await supertest(app).post('/api/transport/vehicles').send(VEHICLE);
    const vehicleId = mockStore.transport_vehicles[0].id;

    await supertest(app).post('/api/transport/routes').send({
      name: 'Westlands Express', vehicleId, driverId: '', fares: [{ fareType: 'two_way', amount: 12000 }],
    });

    await supertest(app).put(`/api/transport/vehicles/${vehicleId}`).send({ ...VEHICLE, registration: 'KDH 486Z', capacity: 51 });

    const route = mockStore.transport_routes[0];
    expect(route.vehicleReg).toBe('KDH 486Z');     // the copy the portals read
    expect(route.capacity).toBe(51);
  });

  test('a vehicle on a route cannot be deleted', async () => {
    await supertest(app).post('/api/transport/vehicles').send(VEHICLE);
    const vehicleId = mockStore.transport_vehicles[0].id;
    await supertest(app).post('/api/transport/routes').send({
      name: 'Westlands Express', vehicleId, driverId: '', fares: [{ fareType: 'two_way', amount: 12000 }],
    });

    const res = await supertest(app).delete(`/api/transport/vehicles/${vehicleId}`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/1 route/);
  });

  test('a vehicle on no route deletes cleanly', async () => {
    await supertest(app).post('/api/transport/vehicles').send(VEHICLE);
    const vehicleId = mockStore.transport_vehicles[0].id;
    const res = await supertest(app).delete(`/api/transport/vehicles/${vehicleId}`);
    expect(res.status).toBe(200);
    expect(mockStore.transport_vehicles).toHaveLength(0);
  });
});

describe('drivers', () => {
  test('a driver record carries the fields a parent needs to call them', async () => {
    const res = await supertest(app).post('/api/transport/drivers').send({
      name: 'Mr. John Nderitu', phone: '+254 712 345 678',
      licenceNumber: 'DL-2019-44812', licenceExpiry: '2027-03-31',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Mr. John Nderitu', phone: '+254 712 345 678',
      licenceNumber: 'DL-2019-44812', licenceExpiry: '2027-03-31', status: 'active',
    });
  });

  test('editing the driver pushes name and phone onto their routes', async () => {
    await supertest(app).post('/api/transport/drivers').send({ name: 'John', phone: '0712 000 000' });
    const driverId = mockStore.transport_drivers[0].id;
    await supertest(app).post('/api/transport/routes').send({
      name: 'Eastlands', vehicleId: '', driverId, fares: [{ fareType: 'one_way', amount: 6000 }],
    });

    await supertest(app).put(`/api/transport/drivers/${driverId}`).send({ name: 'John Nderitu', phone: '+254 700 111 222' });

    expect(mockStore.transport_routes[0].driverName).toBe('John Nderitu');
    expect(mockStore.transport_routes[0].driverPhone).toBe('+254 700 111 222');
  });

  test('a driver on a route cannot be deleted', async () => {
    await supertest(app).post('/api/transport/drivers').send({ name: 'John', phone: '0712 000 000' });
    const driverId = mockStore.transport_drivers[0].id;
    await supertest(app).post('/api/transport/routes').send({
      name: 'Eastlands', vehicleId: '', driverId, fares: [{ fareType: 'one_way', amount: 6000 }],
    });
    const res = await supertest(app).delete(`/api/transport/drivers/${driverId}`);
    expect(res.status).toBe(400);
  });
});

describe('route → vehicle/driver links', () => {
  test('a route that points at the fleet is filled from that record, not from the request', async () => {
    await supertest(app).post('/api/transport/vehicles').send(VEHICLE);
    const vehicleId = mockStore.transport_vehicles[0].id;
    await supertest(app).post('/api/transport/drivers').send({ name: 'Real Driver', phone: '0700 000 000' });
    const driverId = mockStore.transport_drivers[0].id;

    const res = await supertest(app).post('/api/transport/routes').send({
      name: 'Westlands Express', vehicleId, driverId, fares: [{ fareType: 'two_way', amount: 12000 }],
      // the client must not be able to name its own bus
      vehicleReg: 'TOTALLY FAKE', driverName: 'TOTALLY FAKE', driverPhone: 'TOTALLY FAKE',
      vehicleType: 'matatu', capacity: 3,
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      vehicleReg: 'KDH 485Z', driverName: 'Real Driver', driverPhone: '0700 000 000',
      vehicleType: 'bus', capacity: 40, driverId, vehicleId,
    });
  });

  test('a vehicle from another school is refused', async () => {
    global.__mockJwtUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin' };
    const res = await supertest(app).post('/api/transport/routes').send({
      name: 'Sneaky', vehicleId: 'not_my_bus', fares: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not on this school/);
    global.__mockJwtUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin' };
  });

  test('a route with no vehicle or driver may still describe them in words', async () => {
    const res = await supertest(app).post('/api/transport/routes').send({
      name: 'Old Route', vehicleReg: 'KBZ 921F', driverName: 'Mr. Peter',
      capacity: 33, fares: [{ fareType: 'one_way', amount: 6000 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ vehicleReg: 'KBZ 921F', driverName: 'Mr. Peter', capacity: 33 });
  });

  test('the fleet and driver lists state where each is used', async () => {
    await supertest(app).post('/api/transport/vehicles').send(VEHICLE);
    const vehicleId = mockStore.transport_vehicles[0].id;
    await supertest(app).post('/api/transport/drivers').send({ name: 'John', phone: '0712 000 000' });
    const driverId = mockStore.transport_drivers[0].id;
    await supertest(app).post('/api/transport/routes').send({
      name: 'Westlands Express', vehicleId, driverId, fares: [{ fareType: 'two_way', amount: 12000 }],
    });

    const vehicles = await supertest(app).get('/api/transport/vehicles');
    expect(vehicles.body.data[0].routes).toEqual([{ id: mockStore.transport_routes[0].id, name: 'Westlands Express' }]);

    const drivers = await supertest(app).get('/api/transport/drivers');
    expect(drivers.body.data[0].routes).toEqual([{ id: mockStore.transport_routes[0].id, name: 'Westlands Express' }]);
  });

  test('the summary counts the fleet and the drivers too', async () => {
    await supertest(app).post('/api/transport/vehicles').send(VEHICLE);
    await supertest(app).post('/api/transport/drivers').send({ name: 'John', phone: '0712 000 000' });
    const res = await supertest(app).get('/api/transport/summary');
    expect(res.body.data).toMatchObject({ totalVehicles: 1, totalDrivers: 1, totalRoutes: 0 });
  });
});
