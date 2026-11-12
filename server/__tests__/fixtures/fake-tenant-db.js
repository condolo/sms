/* ============================================================
   Tiny in-memory stand-in for tenantModel(name, ctx) — enough of the
   Mongoose query surface (find/findOne/select/sort/limit/lean, create,
   updateMany, countDocuments, distinct) for route tests that need real
   filtering rather than a single canned result.

   Supports equality, $in, $ne, $exists, $or, $and, array-contains
   equality, and dotted paths. Not a general Mongo emulator.
   ============================================================ */
'use strict';

function getPath(doc, path) {
  return path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
}

function matchValue(actual, cond) {
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
    return Object.entries(cond).every(([op, v]) => {
      switch (op) {
        // ObjectId-like values (e.g. _id: { $in: [new ObjectId(hex)] }) compare by their string form.
        case '$in': { const vs = v.map(x => (x && typeof x === 'object' ? String(x) : x)); return Array.isArray(actual) ? actual.some(a => vs.includes(a)) : vs.includes(actual); }
        case '$ne': return Array.isArray(actual) ? !actual.includes(v) : actual !== v;
        case '$exists': return v ? actual !== undefined : actual === undefined;
        case '$gte': return actual >= v;
        case '$lte': return actual <= v;
        default: throw new Error(`fake-tenant-db: unsupported operator ${op}`);
      }
    });
  }
  if (Array.isArray(actual)) return actual.includes(cond);
  return actual === cond;
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return cond.some(f => matches(doc, f));
    if (k === '$and') return cond.every(f => matches(doc, f));
    return matchValue(getPath(doc, k), cond);
  });
}

/* select('a b c') keeps only those fields (+ always nothing else);
   select('-a -b') drops them. Honoured so allow-list leaks show up. */
function project(row, spec) {
  if (!spec) return row;
  const fields = spec.split(/\s+/).filter(Boolean);
  if (fields.every(f => f.startsWith('-'))) {
    const out = { ...row };
    for (const f of fields) delete out[f.slice(1)];
    return out;
  }
  const out = {};
  // Like MongoDB, _id comes back unless explicitly excluded ('-_id').
  if (row._id !== undefined && !fields.includes('-_id')) out._id = row._id;
  for (const f of fields) if (row[f] !== undefined) out[f] = row[f];
  return out;
}

function query(rowsFn) {
  let sortSpec = null;
  let lim = null;
  let selectSpec = null;
  const q = {
    select(spec) { selectSpec = spec; return q; },
    sort(spec) { sortSpec = spec; return q; },
    limit(n) { lim = n; return q; },
    skip() { return q; },
    lean() { return Promise.resolve(run()); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    catch(fn) { return Promise.resolve(run()).catch(fn); },
  };
  function run() {
    let rows = rowsFn().map(r => JSON.parse(JSON.stringify(r)));
    if (sortSpec) {
      const [[key, dir]] = Object.entries(sortSpec);
      rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
    }
    if (lim != null) rows = rows.slice(0, lim);
    return rows.map(r => project(r, selectSpec));
  }
  return q;
}

function createFakeDb(seed = {}) {
  const data = {};
  for (const [name, rows] of Object.entries(seed)) data[name] = rows.map(r => ({ ...r }));
  let seq = 0;

  function model(name) {
    if (!data[name]) data[name] = [];
    const rows = () => data[name];
    return {
      find: (filter) => query(() => rows().filter(r => matches(r, filter))),
      findOne: (filter) => {
        const q = query(() => rows().filter(r => matches(r, filter)).slice(0, 1));
        const lean = q.lean;
        q.lean = () => lean().then(r => r[0] ?? null);
        q.then = (res, rej) => q.lean().then(res, rej);
        return q;
      },
      countDocuments: async (filter) => rows().filter(r => matches(r, filter)).length,
      distinct: async (field, filter) => [...new Set(rows().filter(r => matches(r, filter)).map(r => r[field]))],
      create: async (doc) => {
        const row = { createdAt: new Date(Date.now() + (seq++)).toISOString(), ...doc };
        rows().push(row);
        return { ...row, toObject: () => ({ ...row }) };
      },
      updateMany: async (filter, update) => {
        let n = 0;
        for (const r of rows()) {
          if (!matches(r, filter)) continue;
          n += 1;
          for (const [path, v] of Object.entries(update.$set || {})) {
            const keys = path.split('.');
            let o = r;
            for (const k of keys.slice(0, -1)) o = (o[k] = o[k] || {});
            o[keys[keys.length - 1]] = v;
          }
        }
        return { modifiedCount: n };
      },
      updateOne: async (filter, update) => {
        const r = rows().find(x => matches(x, filter));
        if (!r) return { modifiedCount: 0 };
        for (const [path, v] of Object.entries(update.$set || {})) {
          const keys = path.split('.');
          let o = r;
          for (const k of keys.slice(0, -1)) o = (o[k] = o[k] || {});
          o[keys[keys.length - 1]] = v;
        }
        return { modifiedCount: 1 };
      },
      // Plain-object updates (Mongoose's implicit $set) or { $set }; returns the doc ({ new: true }).
      findOneAndUpdate: (filter, update) => {
        const run = () => {
          const r = rows().find(x => matches(x, filter));
          if (!r) return null;
          const set = update.$set || Object.fromEntries(Object.entries(update).filter(([k]) => !k.startsWith('$')));
          for (const [path, v] of Object.entries(set)) {
            const keys = path.split('.');
            let o = r;
            for (const k of keys.slice(0, -1)) o = (o[k] = o[k] || {});
            o[keys[keys.length - 1]] = v;
          }
          return JSON.parse(JSON.stringify(r));
        };
        return { lean: () => Promise.resolve(run()), then: (res, rej) => Promise.resolve(run()).then(res, rej) };
      },
      insertMany: async (docs) => {
        for (const d of docs) rows().push({ createdAt: new Date(Date.now() + (seq++)).toISOString(), ...JSON.parse(JSON.stringify(d)) });
        return docs;
      },
      deleteMany: async (filter) => {
        const before = rows().length;
        data[name] = rows().filter(r => !matches(r, filter));
        return { deletedCount: before - data[name].length };
      },
    };
  }

  return { data, model };
}

module.exports = { createFakeDb, matches };
