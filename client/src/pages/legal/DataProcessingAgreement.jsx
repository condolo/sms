import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const EFFECTIVE = '1 July 2026';
const CONTROLLER = 'Msingi Technologies Ltd';
const EMAIL = 'privacy@msingi.io';

const SECTIONS = [
  {
    title: '1. Definitions',
    body: [
      '"Controller" means the school or institution that determines the purposes and means of processing personal data within Msingi.',
      '"Processor" means Msingi Technologies Ltd, which processes personal data on behalf of the Controller.',
      '"Data Subject" means any identified or identifiable natural person whose personal data is processed — including students, parents, guardians, and staff.',
      '"Personal Data" means any information relating to an identified or identifiable natural person as defined under the Kenya Data Protection Act 2019 and applicable international standards.',
      '"Processing" means any operation performed on personal data, including collection, storage, use, transmission, and deletion.',
      '"Sub-processor" means any third party engaged by the Processor to carry out processing activities on behalf of the Controller.',
    ],
  },
  {
    title: '2. Scope and Purpose',
    body: [
      'This Data Processing Agreement ("DPA") forms part of the subscription agreement between the Controller (the school) and the Processor (Msingi Technologies Ltd). It governs all processing of personal data carried out by Msingi on behalf of the school.',
      'Msingi processes personal data solely to provide the services described in the subscription agreement — including student management, attendance, academic records, fee management, and parent communications. Msingi does not process school data for any other purpose.',
      'This DPA is governed by and interpreted in accordance with the Kenya Data Protection Act 2019 ("KDPA"), and is designed to be consistent with the principles of the EU General Data Protection Regulation (GDPR), Nigeria Data Protection Regulation (NDPR), and other applicable African data protection laws.',
    ],
  },
  {
    title: '3. Roles and Responsibilities',
    body: [
      'The school (Controller) is responsible for: determining what personal data is entered into Msingi; ensuring the lawful basis for processing exists before data is collected; managing data subject rights requests directed to the school; and ensuring staff are trained on appropriate use of the platform.',
      'Msingi (Processor) is responsible for: processing data only on documented instructions from the Controller; implementing appropriate technical and organisational security measures; assisting the Controller in responding to data subject rights requests; and notifying the Controller of any confirmed personal data breach without undue delay.',
      'Where Msingi processes data for its own purposes — such as service improvement analytics at an aggregate, anonymised level — it acts as a Controller for that limited processing. Msingi will not use identifiable school data to train third-party AI or machine learning models.',
    ],
  },
  {
    title: '4. Data Categories Processed',
    body: [
      'Student data: full name, date of birth, gender, nationality, admissions number, class, stream, attendance records, academic grades, behaviour records, fee balance, and growth profile entries.',
      'Parent and guardian data: full name, relationship to student, contact phone number, email address, and M-Pesa payment records where applicable.',
      'Staff data: full name, employment type, department, subject assignments, attendance, leave records, and salary grade (where HR module is used).',
      'Msingi does not require schools to enter data categories that are not necessary for the services selected. Schools retain full control over what data is entered and may export or delete records at any time.',
    ],
  },
  {
    title: '5. Data Residency',
    body: [
      'All personal data processed through Msingi is stored on infrastructure located in Africa. Primary data residency is in the East Africa region. Msingi does not transfer personal data to servers outside Africa without explicit written agreement from the Controller.',
      'Where cloud services hosted outside Africa are used for ancillary functions (such as email delivery or payment gateway processing), appropriate contractual safeguards including Standard Contractual Clauses are in place.',
    ],
  },
  {
    title: '6. Security Measures',
    body: [
      'Msingi implements the following technical and organisational security measures: AES-256 encryption at rest for all stored data; TLS 1.2 or higher encryption in transit; tenant isolation at the database layer ensuring no school can access another school\'s data; role-based access control (RBAC) enforced server-side on every API request; immutable academic records that cannot be silently edited after approval; and a full, permanent, attributable audit trail of all sensitive operations.',
      'Msingi conducts regular security reviews and penetration testing. Results are available to Controllers on written request under a mutual non-disclosure agreement.',
    ],
  },
  {
    title: '7. Sub-processors',
    body: [
      'Msingi may engage the following categories of sub-processors to deliver the service: cloud infrastructure providers; transactional email delivery services; payment gateway providers (for M-Pesa and bank integrations); and monitoring and error-reporting services.',
      'Msingi maintains a current list of sub-processors and will notify the Controller of any changes. The Controller has a reasonable right to object to a new sub-processor within 14 days of notification. All sub-processors are bound by contractual obligations consistent with this DPA.',
    ],
  },
  {
    title: '8. Data Subject Rights',
    body: [
      'Under the Kenya Data Protection Act 2019 and applicable international law, data subjects have rights including: the right to be informed; the right of access; the right to rectification; the right to erasure (where no overriding legal obligation exists to retain the record); the right to data portability; and the right to object to processing.',
      'Schools (as Controllers) are responsible for responding to data subject rights requests. Msingi provides technical tools to assist: full data export, record correction, and account deletion are available within the platform. Msingi will assist the Controller in fulfilling any request within the timelines required by applicable law.',
    ],
  },
  {
    title: '9. Data Breach Notification',
    body: [
      'In the event of a confirmed personal data breach affecting school data, Msingi will notify the Controller without undue delay and in any event within 72 hours of becoming aware of the breach.',
      'The notification will include: the nature of the breach; the categories and approximate number of data subjects affected; the likely consequences; and the measures taken or proposed to address the breach.',
      'The Controller is responsible for notifying the relevant data protection authority (the Office of the Data Protection Commissioner in Kenya) and affected data subjects where required by applicable law.',
    ],
  },
  {
    title: '10. Retention and Deletion',
    body: [
      'Msingi retains personal data for the duration of the active subscription. On termination of the subscription, the Controller may export all data within 30 days. After that period, Msingi will delete the data from active systems within 90 days, unless legal obligations require retention.',
      'Academic records may be subject to mandatory retention periods under Kenyan education law. Where such obligations apply, Msingi will inform the Controller and retain only the minimum data required.',
    ],
  },
  {
    title: '11. Governing Law and Jurisdiction',
    body: [
      'This DPA is governed by the laws of the Republic of Kenya. Any disputes arising from this DPA will be subject to the exclusive jurisdiction of the Kenyan courts, unless otherwise agreed in writing.',
      'For schools located in other jurisdictions, Msingi acknowledges and complies with applicable local data protection law, including the Nigeria Data Protection Regulation (NDPR), South Africa Protection of Personal Information Act (POPIA), Rwanda Data Protection and Privacy Law, and Uganda Data Protection and Privacy Act where relevant.',
    ],
  },
  {
    title: '12. Contact',
    body: [
      `Data protection queries and data subject rights requests directed to Msingi should be sent to: ${EMAIL}`,
      'For schools that require a signed DPA as part of their procurement process, a countersigned copy is available on request.',
    ],
  },
];

export default function DataProcessingAgreement() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Data Processing Agreement | Msingi</title>
        <meta name="description" content="Msingi Data Processing Agreement — how we process school data under the Kenya Data Protection Act 2019 and international data protection standards." />
        <link rel="canonical" href="https://msingi.io/legal/dpa" />
      </Helmet>

      <BreadcrumbSchema items={[
        { name: 'Legal', href: '/privacy' },
        { name: 'Data Processing Agreement', href: '/legal/dpa' },
      ]} />
      <PublicNav />

      <main className="pt-32 pb-24">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Legal</p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter text-slate-900 mb-4">
              Data Processing Agreement
            </h1>
            <p className="text-slate-500 text-sm">Effective date: {EFFECTIVE} · Controller: your school · Processor: {CONTROLLER}</p>
          </div>

          <div className="prose prose-slate max-w-none">
            <p className="text-slate-600 leading-relaxed mb-10">
              This agreement governs how Msingi Technologies Ltd processes personal data on behalf of schools using the Msingi platform. It is designed to be compliant with the Kenya Data Protection Act 2019, the EU GDPR, and applicable data protection law across East and West Africa.
            </p>

            {SECTIONS.map((section, i) => (
              <div key={i} className="mb-10">
                <h2 className="text-lg font-bold text-slate-900 mb-4">{section.title}</h2>
                {section.body.map((para, j) => (
                  <p key={j} className="text-slate-600 leading-relaxed mb-3 last:mb-0 text-sm">
                    {para}
                  </p>
                ))}
              </div>
            ))}
          </div>

          <div className="mt-16 pt-8 border-t border-slate-200">
            <p className="text-sm text-slate-500 mb-6">
              For questions about this agreement or to request a countersigned copy, contact{' '}
              <a href={`mailto:${EMAIL}`} className="text-slate-900 underline underline-offset-2">{EMAIL}</a>.
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link to="/privacy" className="text-slate-500 hover:text-slate-900 transition-colors">Privacy Policy →</Link>
              <Link to="/terms" className="text-slate-500 hover:text-slate-900 transition-colors">Terms of Service →</Link>
              <Link to="/security" className="text-slate-500 hover:text-slate-900 transition-colors">Security →</Link>
            </div>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
