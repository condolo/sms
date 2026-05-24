/**
 * One-off migration: patch schools and users that are missing the custom `id` field.
 * Root cause: School.create({ id: schoolId }) silently drops `id` because Mongoose
 * treats it as a virtual pointing to _id. Fixed in platform.js (now uses insertOne).
 * This script repairs existing broken records.
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'innolearn' });
  const db = mongoose.connection.db;

  // Find all schools without a stored custom id field
  const schools = await db.collection('schools').find({ id: { $exists: false } }).toArray();
  console.log(`Schools missing custom id field: ${schools.length}`);

  for (const school of schools) {
    const oid = school._id.toString();
    const slug = school.slug;

    // Find user(s) belonging to this school — they were created with the custom
    // schoolId string (sch_<slug>_<timestamp>) so we locate them by slug pattern.
    const users = await db.collection('users').find({
      schoolId: { $regex: slug }
    }).toArray();

    if (users.length === 0) {
      console.log(`  [SKIP] ${slug} — no users found with schoolId matching slug`);
      continue;
    }

    // The schoolId stored on the user IS the correct custom id we need on the school
    const customSchoolId = users[0].schoolId;
    console.log(`  [FIX] ${slug}: patching school id = ${customSchoolId} (ObjectId was ${oid}), affects ${users.length} user(s)`);

    await db.collection('schools').updateOne(
      { _id: school._id },
      { $set: { id: customSchoolId } }
    );
  }

  // Verify
  const stillBroken = await db.collection('schools').countDocuments({ id: { $exists: false } });
  console.log(`\nDone. Schools still missing id: ${stillBroken}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
