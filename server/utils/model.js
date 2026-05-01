/* ============================================================
   InnoLearn — Shared Mongoose Model Factory
   Call _model('collection_name') to get a Mongoose model.
   Caches models so each collection is only defined once.
   Matches the pattern used in sync.js and platform.js.
   ============================================================ */
const mongoose = require('mongoose');

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  schema.index({ schoolId: 1 });
  schema.index({ id: 1 });
  return mongoose.model(name, schema, col);
}

module.exports = { _model };
