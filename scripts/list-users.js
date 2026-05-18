const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'innolearn' });
  const db = mongoose.connection.db;
  const users = await db.collection('users')
    .find({ schoolId: 'sch_innolearn_001' })
    .project({ email: 1, role: 1, name: 1, isActive: 1, password: 1 })
    .toArray();

  const byRole = {};
  users.forEach(u => {
    if (!byRole[u.role]) byRole[u.role] = [];
    const isPlain = u.password && !u.password.startsWith('$2');
    byRole[u.role].push({ email: u.email, name: u.name, active: u.isActive, plainPwd: isPlain });
  });
  console.log(JSON.stringify(byRole, null, 2));
  await mongoose.disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
