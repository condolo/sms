/* ============================================================
   Msingi — where a school's users sign in.

   A school in an organisation signs in at the organisation's portal
   (https://<org slug>.msingi.io). A school on its own signs in at its
   own address (https://<school slug>.msingi.io). The marketing site is
   only the fallback when neither is known. Used in links that go to users
   (message and announcement emails), so they never land on the marketing page.
   ============================================================ */
'use strict';

const { _model } = require('./model');

const APP_URL = process.env.APP_URL || 'https://msingi.io';

async function schoolLoginUrl(schoolId) {
  try {
    const school = await _model('schools').findOne({ id: schoolId }).select('slug organizationId').lean();
    if (school?.organizationId) {
      const org = await _model('organizations').findOne({ id: school.organizationId }).select('slug').lean();
      if (org?.slug) return `https://${org.slug}.msingi.io`;
    }
    if (school?.slug) return `https://${school.slug}.msingi.io`;
  } catch (err) {
    // A failed lookup must not stop a message or announcement from being sent. The marketing address is the fallback.
    console.error('[school-url] lookup failed, using fallback:', err.message);
  }
  return APP_URL;
}

module.exports = { schoolLoginUrl };
