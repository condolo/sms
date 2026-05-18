/**
 * One-off fix: patch provisioned user records that are missing the custom `id` field.
 * Root cause: same Mongoose virtual issue as schools — User.create({id: userId}) silently
 * drops the id field. Fixed in platform.js (now uses insertOne). This patches existing records.
 * Also sets mfaEnabled: false for provisioned test accounts so login works without email OTP.
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'innolearn' });
  const db = mongoose.connection.db;

  // Find users linked to provisioned schools (slug-based schoolIds) but missing id field
  const users = await db.collection('users').find({
    id: { $exists: false },
    schoolId: { $regex: /^sch_/ }
  }).toArray();

  console.log(`Users missing id field: ${users.length}`);

  for (const u of users) {
    // Derive a stable id from their email slug
    const slug = u.schoolId.replace(/^sch_/, '').replace(/_[a-z0-9]+$/, '');
    const customId = `u_${slug}_admin`;
    console.log(`  [FIX] ${u.email}: setting id = ${customId}, mfaEnabled = false`);
    await db.collection('users').updateOne(
      { _id: u._id },
      { $set: { id: customId, mfaEnabled: false } }
    );
  }

  const stillBroken = await db.collection('users').countDocuments({
    id: { $exists: false },
    schoolId: { $regex: /^sch_/ }
  });
  console.log(`\nDone. Users still missing id (provisioned schools): ${stillBroken}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
