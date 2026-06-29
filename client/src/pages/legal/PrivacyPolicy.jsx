/**
 * Msingi — Privacy Policy
 * Compliant with: KDPA 2019, Data Protection (General) Regulations 2021,
 * Uganda DPPA 2019, Tanzania PDPA 2022, Rwanda Law 058/2021, GDPR (where applicable).
 * Last updated: 14 June 2026
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Shield, ChevronRight } from 'lucide-react';
import FloatingActions from '@/components/landing/FloatingActions';

const LAST_UPDATED  = '14 June 2026';
const EFFECTIVE     = '14 June 2026';
const CONTACT_EMAIL = 'privacy@msingi.io';

const SECTIONS = [
  { id: 'intro',        title: '1. Introduction'                        },
  { id: 'role',         title: '2. Our Role in Data Processing'         },
  { id: 'collected',    title: '3. Information We Collect'              },
  { id: 'use',          title: '4. How We Use Your Information'         },
  { id: 'legal-basis',  title: '5. Legal Basis for Processing'         },
  { id: 'children',     title: '6. Children\'s Data'                   },
  { id: 'sharing',      title: '7. Data Sharing and Disclosure'        },
  { id: 'transfers',    title: '8. International Data Transfers'       },
  { id: 'security',     title: '9. Data Security'                      },
  { id: 'breach',       title: '10. Data Breach Notification'          },
  { id: 'retention',    title: '11. Data Retention'                    },
  { id: 'rights',       title: '12. Your Rights'                       },
  { id: 'cookies',      title: '13. Cookies and Tracking'              },
  { id: 'changes',      title: '14. Changes to This Policy'            },
  { id: 'contact',      title: '15. Contact and Supervisory Authorities'},
];

function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-12 scroll-mt-24">
      <h2 className="text-xl font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">{title}</h2>
      <div className="space-y-4 text-slate-600 leading-relaxed text-[15px]">{children}</div>
    </section>
  );
}

function Sub({ title, children }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-slate-800 mb-1.5">{title}</h3>
      <div className="text-slate-600">{children}</div>
    </div>
  );
}

function Table({ headers, rows }) {
  return (
    <div className="overflow-x-auto my-4 rounded-xl border border-slate-200">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50">
            {headers.map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-slate-600 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ color = 'indigo', children }) {
  const styles = {
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-900',
    amber:  'bg-amber-50  border-amber-200  text-amber-900',
    emerald:'bg-emerald-50 border-emerald-200 text-emerald-900',
  };
  return (
    <div className={`border rounded-xl px-5 py-4 text-sm leading-relaxed ${styles[color]}`}>
      {children}
    </div>
  );
}

export default function PrivacyPolicy() {
  const [active, setActive] = useState('intro');

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => { obs.disconnect(); };
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">

      <Helmet>
        <title>Privacy Policy — Msingi School Management Platform</title>
        <meta name="description" content="Msingi privacy policy. How we collect, use, store, and protect school data in compliance with Kenya's Data Protection Act 2019 and East African data regulations." />
        <link rel="canonical" href="https://msingi.io/privacy" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>

      {/* Nav */}
      <nav className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors text-sm font-medium">
            <ArrowLeft size={15} />
            Back to Msingi
          </Link>
          <Link to="/" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[9px] font-bold">M</div>
            <span className="text-sm font-bold text-slate-900">Msingi</span>
          </Link>
          <Link to="/terms" className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">
            Terms of Service →
          </Link>
        </div>
      </nav>

      {/* Header */}
      <header className="bg-gradient-to-br from-slate-50 to-indigo-50/40 border-b border-slate-100 py-12">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/25">
              <Shield size={18} className="text-white" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full">Legal</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 tracking-tight">Privacy Policy</h1>
          <p className="text-slate-500 text-base max-w-2xl leading-relaxed mb-4">
            This policy explains how InnoLearn Limited (trading as "Msingi") collects, processes, stores, and protects personal data in connection with our school management platform.
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <span><strong className="text-slate-700">Effective:</strong> {EFFECTIVE}</span>
            <span><strong className="text-slate-700">Last updated:</strong> {LAST_UPDATED}</span>
            <span><strong className="text-slate-700">Applies to:</strong> msingi.io and all school subdomains</span>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-16">

          {/* TOC — sticky on desktop */}
          <aside className="hidden lg:block">
            <nav className="sticky top-20 space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 px-3">Contents</p>
              {SECTIONS.map(s => (
                <a key={s.id} href={`#${s.id}`}
                  className={`block text-xs px-3 py-2 rounded-lg transition-all leading-snug ${
                    active === s.id
                      ? 'bg-indigo-50 text-indigo-700 font-semibold'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                  }`}>
                  {s.title}
                </a>
              ))}
              <div className="pt-4 border-t border-slate-100 mt-4">
                <a href={`mailto:${CONTACT_EMAIL}`}
                  className="block text-xs px-3 py-2 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors font-medium">
                  privacy@msingi.io
                </a>
              </div>
            </nav>
          </aside>

          {/* Content */}
          <main className="min-w-0">

            <Section id="intro" title="1. Introduction">
              <p>
                InnoLearn Limited (trading as <strong>"Msingi"</strong>, <strong>"we"</strong>, <strong>"us"</strong>, <strong>"our"</strong>) is committed to protecting the personal data of every individual whose information is processed through our platform. This Privacy Policy sets out the basis on which we collect, use, store, and share personal data.
              </p>
              <p>
                This policy is published in compliance with the following legislation:
              </p>
              <ul className="list-none space-y-2 pl-0">
                {[
                  ['Kenya', 'Data Protection Act, 2019 (KDPA); Data Protection (General) Regulations, 2021'],
                  ['Uganda', 'Data Protection and Privacy Act, 2019 (DPPA)'],
                  ['Tanzania', 'Personal Data Protection Act, 2022 (PDPA)'],
                  ['Rwanda', 'Law No. 058/2021 on the Protection of Personal Data and Privacy'],
                  ['International', 'EU General Data Protection Regulation (GDPR) and UK GDPR — where schools have EU/UK connections'],
                ].map(([region, law]) => (
                  <li key={region} className="flex gap-3">
                    <ChevronRight size={14} className="text-indigo-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-slate-700">{region}:</strong> {law}</span>
                  </li>
                ))}
              </ul>
              <Callout color="indigo">
                <strong>Who this policy applies to:</strong> School administrators, teachers, parents, students, and any individual whose personal data is processed by or uploaded to the Msingi platform. If you are a student or parent, your primary point of contact for data rights is the school you are enrolled in, as the school is the Data Controller for your records.
              </Callout>
            </Section>

            <Section id="role" title="2. Our Role in Data Processing">
              <p>The legal distinction between <strong>Data Controller</strong> and <strong>Data Processor</strong> is fundamental to understanding how responsibility is allocated for your personal data on the Msingi platform.</p>

              <Sub title="Msingi as Data Processor (school-uploaded data)">
                <p>When a school subscribes to Msingi and uploads or generates student, parent, teacher, and staff data within the platform, the <strong>school acts as the Data Controller</strong>. The school determines the purposes and means of that processing. Msingi acts as the <strong>Data Processor</strong>, processing such data only on the documented instructions of the school as governed by our Data Processing Agreement (DPA).</p>
              </Sub>

              <Sub title="Msingi as Data Controller (platform account data)">
                <p>In respect of school administrator accounts, platform usage logs, and billing records, <strong>Msingi is the Data Controller</strong> and is solely responsible for how that data is handled.</p>
              </Sub>

              <Callout color="amber">
                <strong>What this means for you:</strong> If you are a student, parent, or teacher and you want to access, correct, or delete your records on the school's Msingi platform, you should contact your school directly. The school, as Data Controller, is responsible for fulfilling your rights. Msingi will support schools in doing so.
              </Callout>
            </Section>

            <Section id="collected" title="3. Information We Collect">
              <Sub title="3.1 Data processed on behalf of schools (Msingi as Processor)">
                <p className="mb-2">When a school subscribes, the school uploads and manages the following categories of personal data:</p>
                <Table
                  headers={['Category', 'Data Elements']}
                  rows={[
                    ['Student personal data',   'Full name, date of birth, gender, admission number, national ID / birth certificate number, photograph, current class and section, academic history'],
                    ['Student sensitive data',   'Medical notes, dietary requirements, disabilities, special educational needs — classified as sensitive personal data under KDPA s.2 and GDPR Art. 9'],
                    ['Student academic data',    'Grades, examination scores, assessment marks, attendance records, behaviour incidents and awards, report cards, growth profile and co-curricular records, lesson coverage'],
                    ['Parent / guardian data',   'Full names, relationship to student, phone numbers, email addresses, M-Pesa phone numbers for fee payment prompts'],
                    ['Teacher / staff data',     'Full names, email addresses, national ID numbers, staff numbers, subjects taught, class assignments'],
                    ['Financial data',           'Fee invoices, payment records, M-Pesa transaction confirmation codes, receipt numbers. We do not store full bank account numbers or payment card details.'],
                  ]}
                />
              </Sub>

              <Sub title="3.2 Data collected directly by Msingi (Msingi as Controller)">
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>School administrator accounts: email address, full name, role, school association</li>
                  <li>Platform usage logs: features accessed, session timestamps, IP addresses (for security monitoring only)</li>
                  <li>Technical data: browser type, device type, operating system (for platform optimisation — not profiling)</li>
                  <li>Billing and subscription data: contact name, email, subscription tier, payment history</li>
                </ul>
              </Sub>

              <Sub title="3.3 Data we do NOT collect">
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>Full bank account or payment card numbers</li>
                  <li>Government-issued biometric data (fingerprints, iris scans)</li>
                  <li>Social media profiles or third-party tracking identifiers</li>
                  <li>Data from children directly — all student data is uploaded by schools on the basis of the school's lawful authority</li>
                </ul>
              </Sub>
            </Section>

            <Section id="use" title="4. How We Use Your Information">
              <Sub title="4.1 As Data Processor (on behalf of schools)">
                <p>We process school-uploaded data exclusively to deliver the Msingi services to that school, including:</p>
                <ul className="space-y-1.5 list-disc list-inside mt-2">
                  <li>Displaying student, attendance, financial, and academic data within the platform</li>
                  <li>Generating report cards, invoices, and analytical dashboards</li>
                  <li>Facilitating M-Pesa STK Push payment prompts to parent phone numbers</li>
                  <li>Sending automated notifications (fee reminders, absence alerts, report card publication)</li>
                  <li>Creating and maintaining AES-256-encrypted daily backups of school data</li>
                  <li>Providing authorised technical support when requested by the school</li>
                </ul>
                <p className="mt-3 font-medium text-slate-700">We do not use school-uploaded data for our own marketing, profiling, model training, or any purpose beyond the contracted service.</p>
              </Sub>

              <Sub title="4.2 As Data Controller (our own data)">
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>Creating and maintaining school administrator accounts</li>
                  <li>Delivering and improving the Msingi platform</li>
                  <li>Sending service-related communications (security alerts, billing notifications, major updates)</li>
                  <li>Ensuring platform security and preventing fraud or abuse</li>
                  <li>Meeting our legal and regulatory obligations</li>
                  <li>Resolving disputes and enforcing our Terms of Service</li>
                </ul>
              </Sub>

              <Callout color="emerald">
                <strong>Our commitment:</strong> We do not sell, rent, trade, or otherwise disclose personal data to third parties for their marketing or commercial purposes. Your data is not the product.
              </Callout>
            </Section>

            <Section id="legal-basis" title="5. Legal Basis for Processing">
              <p>Under KDPA Section 26 and equivalent East African data protection legislation, all processing must have a lawful basis. Our primary lawful bases are:</p>
              <Table
                headers={['Processing Activity', 'Lawful Basis', 'Relevant Law']}
                rows={[
                  ['School-uploaded student, parent, staff data (as processor)', 'Performance of the Data Processing Agreement; Controller\'s documented instructions', 'KDPA s.44; GDPR Art. 28'],
                  ['School administrator accounts', 'Performance of the subscription contract', 'KDPA s.26(b); GDPR Art. 6(1)(b)'],
                  ['Platform security monitoring and fraud prevention', 'Legitimate interests — protecting data and platform integrity', 'KDPA s.26(f); GDPR Art. 6(1)(f)'],
                  ['Service communications (billing, security alerts)', 'Performance of contract; Legal obligation', 'KDPA s.26(b)(c)'],
                  ['Billing and financial records', 'Legal obligation — tax and financial regulations', 'KDPA s.26(c); Kenya Revenue Authority Act'],
                  ['Backup and disaster recovery', 'Legitimate interests; Security of data obligation', 'KDPA s.41; GDPR Art. 32'],
                  ['Processing sensitive student data (medical notes etc.)', 'Explicit consent obtained by the school from parents/guardians as Data Controller', 'KDPA s.29; GDPR Art. 9(2)(a)'],
                ]}
              />
              <p className="text-sm text-slate-500 mt-2">Where processing is based on consent, the relevant data subject has the right to withdraw consent at any time without affecting the lawfulness of processing before withdrawal.</p>
            </Section>

            <Section id="children" title="6. Children's Data">
              <p>
                Our platform processes personal data of school students, the majority of whom are minors under the age of 18. We treat children's data with the highest level of care and impose enhanced protections.
              </p>

              <Sub title="School's responsibility as Data Controller">
                <p>Schools, as Data Controllers, are solely responsible for:</p>
                <ul className="space-y-1.5 list-disc list-inside mt-2">
                  <li>Ensuring they have the appropriate legal basis — typically written parental or guardian consent — to collect and upload student personal data to Msingi</li>
                  <li>Compliance with the Kenya Children's Act, 2022, Basic Education Act, 2013, and any applicable national laws governing the processing of data relating to minors in their jurisdiction</li>
                  <li>Providing parents and guardians with notice of how their children's data is used on the platform</li>
                </ul>
              </Sub>

              <Sub title="Msingi's commitments for children's data">
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>We will not process student data for any purpose other than delivering the contracted service to the school</li>
                  <li>We will not use student data for advertising, commercial profiling, or training AI/ML models</li>
                  <li>We apply enhanced technical security measures to all data that may relate to minors</li>
                  <li>We will support schools in responding to parental access, rectification, and erasure requests relating to student records</li>
                  <li>Student data is never shared with third parties except sub-processors required to deliver the service (see Section 7)</li>
                </ul>
              </Sub>

              <Callout color="amber">
                Msingi does not knowingly collect personal data directly from children. All student data is entered into the platform by school staff (administrators and teachers) on the basis of the school's lawful authority over enrolled students.
              </Callout>
            </Section>

            <Section id="sharing" title="7. Data Sharing and Disclosure">
              <Sub title="7.1 Sub-processors (service providers)">
                <p>We engage the following categories of sub-processors to deliver our services. All are bound by data processing agreements requiring data protection standards equivalent to our own:</p>
                <Table
                  headers={['Category', 'Purpose', 'Location']}
                  rows={[
                    ['Database hosting (MongoDB Atlas)', 'Storing all school data at rest, encrypted', 'Configurable region; EU/US available'],
                    ['Cloud backup storage (S3-compatible)', 'Storing AES-256-GCM encrypted daily backup files', 'Configurable; school may specify'],
                    ['Email delivery (SMTP)', 'Sending system notifications, fee reminders, password resets', 'Kenya / International'],
                    ['Error monitoring (optional)', 'Capturing anonymous error traces to improve platform stability. No personal data included in payloads.', 'International'],
                  ]}
                />
                <p className="text-sm text-slate-500">A current list of sub-processors is available on request at {CONTACT_EMAIL}.</p>
              </Sub>

              <Sub title="7.2 Disclosure required by law">
                <p>We may disclose personal data where required by a court order, government authority (including the Kenya Revenue Authority, Directorate of Criminal Investigations, or equivalent), or regulatory authority acting under lawful authority. We will notify the affected school of any such requests to the extent permitted by law before complying.</p>
              </Sub>

              <Sub title="7.3 Business transfers">
                <p>In the event of a merger, acquisition, or sale of assets, personal data may be transferred to a successor entity. We will provide at least 60 days' notice to schools and ensure equivalent data protection commitments are maintained by any successor.</p>
              </Sub>

              <Sub title="7.4 We do NOT share personal data with">
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>Advertisers or advertising networks</li>
                  <li>Data brokers or data aggregators</li>
                  <li>Third-party marketers or research firms</li>
                  <li>Any other school on the Msingi platform — tenant data is architecturally isolated</li>
                </ul>
              </Sub>
            </Section>

            <Section id="transfers" title="8. International Data Transfers">
              <p>
                Msingi primarily stores and processes data within cloud infrastructure. Where data is transferred outside Kenya or the processing school's country, we ensure one or more of the following safeguards is in place:
              </p>
              <ul className="space-y-2 list-disc list-inside">
                <li>Processing only in countries recognised by the Kenya Data Protection Commissioner (ODPC) as providing adequate data protection</li>
                <li>Standard contractual clauses (SCCs) approved by the relevant supervisory authority incorporated into sub-processor agreements</li>
                <li>Data Processing Agreements with all sub-processors requiring equivalent standards to those we apply</li>
              </ul>
              <p className="mt-3">
                Our database infrastructure (MongoDB Atlas) may replicate data across geographic regions for high availability and disaster recovery. All such replication is encrypted in transit (TLS 1.2+) and at rest (AES-256). Schools may request that their data be confined to a specific region where the technical configuration permits.
              </p>
            </Section>

            <Section id="security" title="9. Data Security">
              <p>We implement the following technical and organisational measures in accordance with KDPA Section 41 and international best practices:</p>

              <Sub title="Technical measures">
                <Table
                  headers={['Measure', 'Detail']}
                  rows={[
                    ['Backup encryption',       'AES-256-GCM authenticated encryption on all backup files. Encryption keys never stored alongside data.'],
                    ['Data in transit',         'TLS 1.2 minimum enforced across all connections. HTTP Strict Transport Security (HSTS) enabled.'],
                    ['Password storage',        'Bcrypt hashing with salt. Plain-text passwords are never stored or logged.'],
                    ['Access control',          'Role-based access control (RBAC) enforced at the API layer. Teachers see their classes only; parents see their children only; cross-tenant access is architecturally prevented.'],
                    ['Tenant isolation',        'Every school\'s data is isolated at the database layer. No cross-school queries are possible.'],
                    ['Audit trail',             'Every login, grade entry, payment record, and approval action is permanently logged with attribution, timestamp, and IP address.'],
                    ['Security headers',        'Content Security Policy, X-Content-Type-Options, X-Frame-Options, and Referrer-Policy headers active on all responses.'],
                    ['Rate limiting',           'Authentication endpoints are rate-limited to prevent brute-force attacks.'],
                    ['OTP / token generation',  'All one-time tokens are generated using cryptographically secure random number generation (Node.js crypto.randomInt — never Math.random).'],
                  ]}
                />
              </Sub>

              <Sub title="Organisational measures">
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>Access to production infrastructure is restricted to authorised Msingi personnel only</li>
                  <li>Regular internal security reviews of authentication, authorisation, and data handling code</li>
                  <li>Documented incident response procedure</li>
                  <li>All new personnel with data access undergo security awareness training</li>
                </ul>
              </Sub>

              <Callout color="amber">
                No system is completely immune to security incidents. We maintain controls proportionate to the sensitivity of the data processed. In the event of a security incident affecting your data, we will respond as described in Section 10.
              </Callout>
            </Section>

            <Section id="breach" title="10. Data Breach Notification">
              <p>In the event of a personal data breach that is likely to result in a risk to the rights and freedoms of data subjects, Msingi will:</p>
              <ul className="space-y-2.5 list-none">
                {[
                  ['Within 72 hours', 'Notify the Kenya Data Protection Commissioner (ODPC) and relevant East African supervisory authorities, as required by KDPA Section 42 and equivalent national legislation.'],
                  ['Without undue delay', 'Notify affected schools with sufficient detail to enable the school to assess the scope and risk of the breach.'],
                  ['Within 72 hours of school notification', 'Provide schools with the information they need to notify affected data subjects (students, parents, staff) where required by law.'],
                  ['Ongoing', 'Maintain an internal breach register recording all incidents, their scope, and remediation actions, retained for a minimum of 5 years.'],
                ].map(([when, what]) => (
                  <li key={when} className="flex gap-3">
                    <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full whitespace-nowrap h-fit mt-0.5">{when}</span>
                    <span>{what}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4">Where a breach is determined to pose no risk to data subjects, we will document the incident internally but may not be required to notify supervisory authorities. Our assessment will be documented and available to the ODPC on request.</p>
            </Section>

            <Section id="retention" title="11. Data Retention">
              <p>We retain personal data only for as long as necessary for the purpose for which it was collected, or as required by law.</p>
              <Table
                headers={['Data Category', 'Retention Period', 'Basis']}
                rows={[
                  ['Active school data — students, staff, finances, academic records', 'Duration of active subscription', 'Contract performance'],
                  ['School data after subscription termination', '30-day export window, then permanent and irreversible deletion', 'Data minimisation; KDPA s.40'],
                  ['School administrator accounts (after school offboards)', '90 days from termination date, then deletion', 'Legitimate interests (dispute resolution)'],
                  ['Encrypted backup files', 'The 7 most recent daily backups (rolling — older backups are automatically deleted)', 'Security obligation'],
                  ['Platform audit logs and security logs', '12 months from date of generation', 'Security; legal obligation'],
                  ['Billing and financial records', '7 years from transaction date', 'Kenya Revenue Authority requirements; Tax Procedures Act'],
                  ['Data breach records', '5 years minimum', 'KDPA regulatory requirement'],
                  ['Consent records', 'Duration of the relationship + 3 years', 'Legal obligation to evidence lawful basis'],
                ]}
              />
              <p className="text-sm text-slate-500 mt-2">Schools may request deletion of their data at any time. On termination, a 30-day export window is provided before permanent deletion is triggered. After deletion, recovery is not possible — this is intentional and consistent with KDPA erasure obligations.</p>
            </Section>

            <Section id="rights" title="12. Your Rights as a Data Subject">
              <p>Under KDPA Section 34 and equivalent East African data protection legislation, you have the following rights in relation to your personal data:</p>
              <Table
                headers={['Right', 'What it means', 'How to exercise']}
                rows={[
                  ['Access (KDPA s.34(a))', 'Request a copy of personal data we hold about you', 'Contact privacy@msingi.io; or contact your school for school-held data'],
                  ['Rectification (KDPA s.34(b))', 'Request correction of inaccurate or incomplete personal data', 'Contact your school (for school records); or privacy@msingi.io (for account data)'],
                  ['Erasure (KDPA s.34(c); s.40)', 'Request deletion of your data where no longer necessary or where consent is withdrawn', 'Contact privacy@msingi.io; note that legal obligations may require retention of some records'],
                  ['Restriction (KDPA s.34(d))', 'Request that we limit processing of your data in certain circumstances', 'Contact privacy@msingi.io with your specific request'],
                  ['Data Portability (KDPA s.34(e))', 'Receive your data in a structured, machine-readable format (e.g., JSON or CSV)', 'Schools may export all their data using the built-in backup function; individuals may request via privacy@msingi.io'],
                  ['Object (KDPA s.34(f))', 'Object to processing based on legitimate interests or for direct marketing', 'Contact privacy@msingi.io with the specific processing you object to'],
                  ['Withdraw consent', 'Withdraw consent at any time where processing is consent-based, without affecting prior lawful processing', 'Contact privacy@msingi.io or your school depending on whose processing is consent-based'],
                ]}
              />
              <Callout color="indigo">
                <strong>Response time:</strong> We will respond to all data rights requests within <strong>30 days</strong> of receipt. Where requests are complex or numerous, we may extend this by a further 60 days with notification and explanation. We do not charge a fee for rights requests unless they are manifestly unfounded or excessive.
              </Callout>
              <p className="mt-4 text-sm">
                <strong>Important:</strong> For requests relating to data held within a school's Msingi platform (e.g., a parent requesting access to their child's records, or a teacher requesting their own employment data), the school is the Data Controller and is the correct first point of contact. Msingi will support the school in fulfilling valid requests but will not override the school's lawful authority over that data.
              </p>
            </Section>

            <Section id="cookies" title="13. Cookies and Tracking Technologies">
              <p>The Msingi platform uses the following session storage technologies:</p>
              <Table
                headers={['Technology', 'Purpose', 'Duration']}
                rows={[
                  ['Authentication token (browser localStorage)', 'Maintains your login session so you do not have to re-authenticate on every page', 'Until you log out or the token expires (typically 7 days)'],
                  ['School slug (browser localStorage)', 'Remembers your school so the correct branded login page is shown on return visits', 'Until cleared by the user'],
                  ['Functional session state', 'Maintains UI state (e.g., selected tab, expanded sections) within a session', 'Session only — cleared when browser is closed'],
                ]}
              />
              <Sub title="What we do NOT use">
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>Advertising or retargeting cookies</li>
                  <li>Cross-site tracking technologies</li>
                  <li>Third-party analytics that profile individual user behaviour (such as Google Analytics with advertising features enabled)</li>
                  <li>Fingerprinting or device tracking technologies</li>
                </ul>
              </Sub>
              <p className="text-sm text-slate-500">You may clear browser storage at any time through your browser settings. This will require you to log in again on your next visit.</p>
            </Section>

            <Section id="changes" title="14. Changes to This Privacy Policy">
              <p>We may update this Privacy Policy from time to time to reflect changes in the law, our data processing practices, or the platform's features. When we make changes, we will:</p>
              <ul className="space-y-2 list-disc list-inside">
                <li>Update the "Last Updated" date at the top of this page</li>
                <li>For material changes: notify school administrator email addresses with at least <strong>30 days' notice</strong> before changes take effect, clearly describing what has changed and why</li>
                <li>For minor clarifications: update the page without separate notification, but note the change in the version history</li>
              </ul>
              <p className="mt-3">Continued use of the platform after the effective date of material changes constitutes acceptance of the updated policy. If you do not accept a material change, you may terminate your subscription in accordance with the Terms of Service.</p>
            </Section>

            <Section id="contact" title="15. Contact and Supervisory Authorities">
              <Sub title="Contact Msingi on privacy matters">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
                  <p><strong>InnoLearn Limited</strong> (trading as Msingi)</p>
                  <p>Privacy enquiries: <a href="mailto:privacy@msingi.io" className="text-indigo-600 hover:underline">privacy@msingi.io</a></p>
                  <p>General: <a href="mailto:hello@msingi.io" className="text-indigo-600 hover:underline">hello@msingi.io</a></p>
                  <p>Website: <a href="https://msingi.io" className="text-indigo-600 hover:underline">msingi.io</a></p>
                </div>
              </Sub>

              <Sub title="Supervisory Authorities">
                <p className="mb-3">If you are unsatisfied with our response to a privacy concern, you have the right to lodge a complaint with the relevant supervisory authority in your jurisdiction:</p>
                <Table
                  headers={['Country', 'Authority', 'Contact']}
                  rows={[
                    ['Kenya',    'Office of the Data Protection Commissioner (ODPC)', 'odpc.go.ke'],
                    ['Uganda',   'Personal Data Protection Office (PDPO)',           'pdpo.go.ug'],
                    ['Tanzania', 'Personal Data Protection Commission (PDPC)',       'Official government portal'],
                    ['Rwanda',   'National Cyber Security Authority (NCSA)',         'ncsa.gov.rw'],
                    ['EU/EEA',  'Your national supervisory authority (e.g., ICO for UK; CNIL for France)', 'edpb.europa.eu'],
                  ]}
                />
              </Sub>

              <Callout color="indigo">
                We encourage you to contact us at <strong>privacy@msingi.io</strong> before lodging a formal complaint — most issues can be resolved quickly through direct communication. We are committed to responding within 30 days.
              </Callout>
            </Section>

          </main>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[9px] font-bold">M</div>
            <span className="font-semibold text-slate-700">Msingi</span>
          </Link>
          <p className="text-center">Last updated {LAST_UPDATED}. © {new Date().getFullYear()} InnoLearn Limited. All rights reserved.</p>
          <div className="flex gap-5">
            <Link to="/terms" className="hover:text-slate-700 transition-colors">Terms of Service</Link>
            <a href="mailto:privacy@msingi.io" className="hover:text-slate-700 transition-colors">privacy@msingi.io</a>
          </div>
        </div>
      </footer>

      <FloatingActions />
    </div>
  );
}
