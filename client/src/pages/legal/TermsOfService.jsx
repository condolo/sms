/**
 * Msingi — Terms of Service
 * Governing law: Republic of Kenya
 * Last updated: 14 June 2026
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, ArrowUp, ChevronRight } from 'lucide-react';

const LAST_UPDATED  = '14 June 2026';
const EFFECTIVE     = '14 June 2026';

const SECTIONS = [
  { id: 'intro',        title: '1. Introduction and Agreement'         },
  { id: 'definitions',  title: '2. Definitions'                        },
  { id: 'service',      title: '3. Service Description'                },
  { id: 'registration', title: '4. Account Registration and Eligibility'},
  { id: 'payment',      title: '5. Subscription and Payment'           },
  { id: 'conduct',      title: '6. School Responsibilities and Use'    },
  { id: 'data',         title: '7. Data Processing and Privacy'        },
  { id: 'ip',           title: '8. Intellectual Property'              },
  { id: 'confidential', title: '9. Confidentiality'                    },
  { id: 'availability', title: '10. Service Availability and Disclaimers'},
  { id: 'liability',    title: '11. Limitation of Liability'           },
  { id: 'indemnity',    title: '12. Indemnification'                   },
  { id: 'termination',  title: '13. Term and Termination'              },
  { id: 'modifications',title: '14. Modifications to Terms and Service'},
  { id: 'governing',    title: '15. Governing Law and Disputes'        },
  { id: 'general',      title: '16. General Provisions'               },
  { id: 'contact',      title: '17. Contact'                           },
];

function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-12 scroll-mt-24">
      <h2 className="text-xl font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">{title}</h2>
      <div className="space-y-4 text-slate-600 leading-relaxed text-[15px]">{children}</div>
    </section>
  );
}

function Sub({ id, title, children }) {
  return (
    <div id={id} className="mb-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-2">{title}</h3>
      <div className="text-slate-600 space-y-2">{children}</div>
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
    red:    'bg-red-50    border-red-200    text-red-900',
  };
  return (
    <div className={`border rounded-xl px-5 py-4 text-sm leading-relaxed ${styles[color]}`}>
      {children}
    </div>
  );
}

function List({ items }) {
  return (
    <ul className="space-y-1.5 list-none pl-0">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <ChevronRight size={14} className="text-indigo-400 flex-shrink-0 mt-1" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function AlphaList({ items }) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return (
    <ul className="space-y-2 pl-0 list-none">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="text-slate-400 font-medium flex-shrink-0">({letters[i]})</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function TermsOfService() {
  const [active, setActive]   = useState('intro');
  const [showTop, setShowTop] = useState(false);

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
    function onScroll() { setShowTop(window.scrollY > 400); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { obs.disconnect(); window.removeEventListener('scroll', onScroll); };
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">

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
          <Link to="/privacy" className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">
            ← Privacy Policy
          </Link>
        </div>
      </nav>

      {/* Header */}
      <header className="bg-gradient-to-br from-slate-50 to-indigo-50/40 border-b border-slate-100 py-12">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/25">
              <FileText size={18} className="text-white" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full">Legal</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 tracking-tight">Terms of Service</h1>
          <p className="text-slate-500 text-base max-w-2xl leading-relaxed mb-4">
            This agreement governs a school's subscription to and use of the Msingi school management platform. By using the platform, the school agrees to be bound by these terms.
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <span><strong className="text-slate-700">Effective:</strong> {EFFECTIVE}</span>
            <span><strong className="text-slate-700">Last updated:</strong> {LAST_UPDATED}</span>
            <span><strong className="text-slate-700">Governing law:</strong> Republic of Kenya</span>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-16">

          {/* TOC */}
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
                <a href="mailto:hello@msingi.io"
                  className="block text-xs px-3 py-2 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors font-medium">
                  hello@msingi.io
                </a>
              </div>
            </nav>
          </aside>

          {/* Content */}
          <main className="min-w-0">

            <Section id="intro" title="1. Introduction and Agreement">
              <p>
                These Terms of Service (<strong>"Terms"</strong>) constitute a legally binding agreement between <strong>InnoLearn Limited</strong>, a company incorporated in Kenya (trading as <strong>"Msingi"</strong>, <strong>"we"</strong>, <strong>"us"</strong>, <strong>"our"</strong>), and the school or educational institution (<strong>"School"</strong>, <strong>"you"</strong>, <strong>"your"</strong>) that registers for and uses the Msingi school management platform.
              </p>
              <p>
                By completing the school onboarding process, accessing the platform, or authorising any staff member, teacher, parent, or student to use the platform, the School agrees to be bound by these Terms and our <Link to="/privacy" className="text-indigo-600 hover:underline">Privacy Policy</Link>, which is incorporated herein by reference.
              </p>
              <Callout color="amber">
                <strong>Authority to bind:</strong> The individual who completes school registration and onboarding on behalf of the School represents and warrants that they have the full legal authority to bind the School and its governing body to these Terms. If you do not have such authority, or if you do not agree to these Terms, do not proceed with the registration or use of the platform.
              </Callout>
              <p>
                If there is a conflict between these Terms and any supplementary order form or written agreement signed by both parties, the supplementary agreement prevails to the extent of the conflict.
              </p>
            </Section>

            <Section id="definitions" title="2. Definitions">
              <Table
                headers={['Term', 'Meaning']}
                rows={[
                  ['"Platform"',        'The Msingi school management SaaS software, APIs, web interfaces, and related services made available at msingi.io and school-specific subdomains.'],
                  ['"School Data"',     'All personal data, academic records, financial records, timetable information, communications, and other content uploaded to or generated within the Platform by or on behalf of the School.'],
                  ['"Authorised Users"','School administrators, teachers, students, parents, and guardians who are granted access to the Platform by the School.'],
                  ['"Subscription"',    'The recurring licence to access and use the Platform on the terms agreed during onboarding and as set out in the current pricing schedule.'],
                  ['"Term"',            'The period during which the School holds an active Subscription.'],
                  ['"Data Processing Agreement" (DPA)', 'The agreement governing Msingi\'s processing of School Data as Data Processor on behalf of the School as Data Controller, incorporated into these Terms. Available at msingi.io/privacy or on request.'],
                  ['"Intellectual Property"', 'Patents, copyrights, trade marks, trade secrets, database rights, design rights, and all other intellectual property rights, whether registered or unregistered.'],
                  ['"KDPA"',            'The Kenya Data Protection Act, 2019, and the Data Protection (General) Regulations, 2021.'],
                  ['"Force Majeure"',   'Any event beyond a party\'s reasonable control, including acts of God, war, government action, power failures, internet infrastructure failures, or pandemics.'],
                ]}
              />
            </Section>

            <Section id="service" title="3. Service Description">
              <p>
                Msingi is a multi-tenant, cloud-hosted school management platform delivered as Software-as-a-Service (SaaS). Depending on the subscription tier, the Platform provides access to the following modules:
              </p>
              <div className="grid sm:grid-cols-2 gap-2 my-4">
                {[
                  'Student Records Management',
                  'Attendance Tracking',
                  'Academic Assessment and Grading',
                  'Report Card Generation and Distribution',
                  'Financial Management and Invoicing',
                  'M-Pesa Fee Collection (STK Push)',
                  'Class Timetabling',
                  'Behaviour and Co-Curricular Management',
                  'Library Management',
                  'Transport Management',
                  'Hostel Management',
                  'E-Learning Integration',
                  'HR and Staff Management',
                  'Student Growth Profiles',
                  'Analytics and Dashboards',
                  'Parent Communication Portal',
                  'Platform and Backup Administration',
                ].map(m => (
                  <div key={m} className="flex items-center gap-2 text-sm text-slate-600">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                    {m}
                  </div>
                ))}
              </div>
              <p>
                Feature availability is subject to the subscription tier selected. Msingi may add, update, or discontinue features as described in Section 14. The Platform is provided over the internet — the School is responsible for maintaining adequate internet access.
              </p>
            </Section>

            <Section id="registration" title="4. Account Registration and Eligibility">
              <Sub title="4.1 Eligibility">
                <p>Schools must be legally registered educational institutions, or authorised operators of such institutions (including management companies, trusts, proprietors, or NGO-operated schools).</p>
              </Sub>

              <Sub title="4.2 School subdomain">
                <p>Each school receives one dedicated subdomain (e.g., <code className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-xs">schoolname.msingi.io</code>). This subdomain is unique, non-transferable, and tied to the school's registration. The School may not transfer it or use it to service multiple unrelated institutions without Msingi's written consent.</p>
              </Sub>

              <Sub title="4.3 Credential security">
                <p>The School is solely responsible for maintaining the confidentiality and security of all administrator, teacher, student, and parent credentials. Msingi is not liable for unauthorised access or loss of data resulting from the School's failure to secure credentials or control access rights.</p>
              </Sub>

              <Sub title="4.4 Accurate information">
                <p>The School must provide accurate information during onboarding, including school name, physical address, country, type of institution, curriculum, and student count. Providing materially false information — including misrepresenting student counts for billing purposes — is grounds for immediate termination without refund.</p>
              </Sub>

              <Sub title="4.5 User awareness">
                <p>The School must ensure all Authorised Users are made aware of, and agree to comply with, these Terms and the Msingi Privacy Policy before they access the Platform.</p>
              </Sub>
            </Section>

            <Section id="payment" title="5. Subscription and Payment">
              <Sub title="5.1 Pricing and tiers">
                <p>Msingi is offered on per-student, per-term pricing as set out in the pricing schedule at msingi.io/plans. The applicable tier and rate are agreed during the onboarding process. Schools on the Starter tier have access to core modules; Standard and Premium tiers unlock additional modules as described in the pricing schedule.</p>
              </Sub>

              <Sub title="5.2 Billing cycle">
                <p>Subscription fees are invoiced at the start of each academic term based on the active enrolled student count as at the invoicing date, or as otherwise agreed in writing at onboarding. An invoice is issued to the school administrator email on record.</p>
              </Sub>

              <Sub title="5.3 Payment terms and methods">
                <p>Payment is due within <strong>14 days</strong> of the invoice date. Accepted payment methods include:</p>
                <List items={[
                  'M-Pesa Paybill (Safaricom)',
                  'Bank transfer (Kenya Shillings to Msingi\'s designated account)',
                  'Such other methods as Msingi may accept in writing from time to time',
                ]} />
              </Sub>

              <Sub title="5.4 Late payment and suspension">
                <p>If an invoice remains unpaid after the due date, Msingi reserves the right to:</p>
                <AlphaList items={[
                  'Issue a written reminder to the school administrator email;',
                  'Suspend platform access (read-only mode) until the outstanding amount is settled — the School retains the ability to export data during suspension;',
                  'Charge interest on overdue amounts at 2% per month (or the maximum rate permitted by applicable law, whichever is lower) calculated from the due date;',
                  'Terminate the subscription in accordance with Section 13 where the overdue amount remains unpaid for more than 60 days.',
                ]} />
              </Sub>

              <Sub title="5.5 Setup fee">
                <p>A one-time setup fee is charged at onboarding covering account configuration, initial data import assistance, and staff orientation. This fee is non-refundable once the onboarding process has commenced, regardless of whether the school proceeds to full subscription.</p>
              </Sub>

              <Sub title="5.6 Pricing changes">
                <p>Msingi may revise subscription rates by providing at least <strong>60 days'</strong> written notice before the start of the academic term to which the new rates apply. Continued use after the effective date of revised pricing constitutes acceptance.</p>
              </Sub>

              <Sub title="5.7 Taxes">
                <p>All fees quoted are exclusive of applicable taxes including Value Added Tax (VAT), withholding tax, and any other levies as required by Kenyan law or the law of any other applicable jurisdiction. The School is responsible for paying all applicable taxes on amounts invoiced.</p>
              </Sub>

              <Callout color="emerald">
                <strong>Refunds:</strong> Subscription fees are not refundable for partial terms. If the School terminates mid-term, no refund is issued for the remainder of the paid term. The School retains access until the end of the term for which payment was received.
              </Callout>
            </Section>

            <Section id="conduct" title="6. School Responsibilities and Acceptable Use">
              <Sub title="6.1 Lawful use">
                <p>The School must use the Platform only for lawful educational management purposes and in compliance with all applicable laws, including the KDPA, the Basic Education Act, 2013, the Kenya Children's Act, 2022, and any laws applicable to the school's sector and jurisdiction.</p>
              </Sub>

              <Sub title="6.2 Data accuracy">
                <p>The School is solely responsible for the accuracy, completeness, and currency of all School Data entered into the Platform. Msingi is not responsible for errors, regulatory penalties, or harm arising from inaccurate or incomplete data entry by the School or its Authorised Users.</p>
              </Sub>

              <Sub title="6.3 Parental and guardian consent">
                <p>The School, as Data Controller, is solely responsible for obtaining all necessary consents — including written parental or guardian consent for processing personal data of enrolled minor students — before uploading such data to the Platform. Msingi processes that data on the School's instruction only.</p>
              </Sub>

              <Sub title="6.4 Authorised access management">
                <p>The School must ensure that platform access is granted only to legitimate Authorised Users. Sharing credentials between users, or granting platform access to individuals who are not enrolled students, staff, or verified parents/guardians of enrolled students, is prohibited.</p>
              </Sub>

              <Sub title="6.5 Prohibited conduct">
                <p>The School and its Authorised Users must NOT:</p>
                <AlphaList items={[
                  'Upload content that is unlawful, discriminatory, defamatory, or infringes any third-party intellectual property rights;',
                  'Attempt to access data belonging to other schools, exploit any platform vulnerability, or conduct penetration testing without Msingi\'s prior written authorisation;',
                  'Reverse-engineer, decompile, disassemble, or attempt to extract the source code or trade secrets of the Platform;',
                  'Use the Platform for purposes unrelated to legitimate school management — including conducting business activities for unrelated third parties through the Platform;',
                  'Misrepresent the number of enrolled students for the purpose of reducing billing amounts;',
                  'Use the Platform in any way that could damage, overload, impair, or disrupt the Platform or its infrastructure, or interfere with other schools\' use;',
                  'Upload, store, or transmit malware, ransomware, scripts, or automated attack tools through the Platform;',
                  'Resell, sublicense, or provide access to the Platform to third parties not covered by the School\'s subscription;',
                  'Use the Platform to process or store data of individuals not enrolled in or employed by the School.',
                ]} />
              </Sub>

              <Sub title="6.6 Cross-jurisdictional compliance">
                <p>Schools operating in East African jurisdictions outside Kenya are responsible for ensuring their use of the Platform complies with applicable local data protection and education legislation, including the Uganda DPPA 2019, Tanzania PDPA 2022, Rwanda Law No. 058/2021, and any local ministry of education regulations.</p>
              </Sub>
            </Section>

            <Section id="data" title="7. Data Processing and Privacy">
              <p>
                The School is the <strong>Data Controller</strong> and Msingi is the <strong>Data Processor</strong> in respect of all School Data, as those terms are defined under the Kenya Data Protection Act, 2019.
              </p>
              <List items={[
                'The Data Processing Agreement (DPA), which forms part of these Terms, governs how Msingi processes School Data on behalf of the School. The DPA is available at msingi.io/privacy or by written request.',
                'The School authorises Msingi to engage the sub-processors listed in the DPA (updated from time to time with notice to the School) to the extent necessary to deliver the Platform services.',
                'Each party shall comply with its obligations under KDPA and applicable data protection legislation. The School, as Data Controller, bears primary responsibility for ensuring a lawful basis for all processing of School Data, including obtaining parental consent for student data.',
                'Msingi will process School Data only on the School\'s documented instructions, except where required by law. Msingi will promptly inform the School if an instruction conflicts with applicable data protection law.',
                'Full details of Msingi\'s data practices — including retention periods, security measures, data subject rights, and sub-processors — are set out in the Privacy Policy at msingi.io/privacy.',
              ]} />
            </Section>

            <Section id="ip" title="8. Intellectual Property">
              <Sub title="8.1 Msingi's intellectual property">
                <p>Msingi retains all intellectual property rights in the Platform, including all software, source code, algorithms, interfaces, design elements, documentation, and improvements thereto, whether or not patentable or registerable. These Terms grant the School a limited, non-exclusive, non-transferable, non-sublicensable licence to access and use the Platform solely during the Term for the School's own school management purposes.</p>
              </Sub>

              <Sub title="8.2 School Data ownership">
                <p>The School retains full ownership of all School Data. Msingi acquires no ownership interest in School Data by virtue of hosting or processing it. Upon termination, School Data is made available for export for 30 days before permanent deletion as described in Section 13.</p>
              </Sub>

              <Sub title="8.3 Licence grant to Msingi">
                <p>The School grants Msingi a limited, royalty-free licence to access, process, and store School Data solely for the purpose of delivering the contracted Platform services. This licence ends upon deletion of the School Data following termination.</p>
              </Sub>

              <Sub title="8.4 Feedback">
                <p>If the School or its users provide suggestions, feature requests, or feedback regarding the Platform, Msingi may incorporate such feedback into the Platform without obligation, attribution, compensation, or restriction. The School waives any claim to intellectual property rights in such feedback.</p>
              </Sub>

              <Sub title="8.5 Usage for platform improvement">
                <p>Msingi may use aggregated, anonymised, and de-identified data derived from Schools' use of the Platform (such as feature usage statistics, performance metrics, and aggregate usage patterns) for the purpose of improving the Platform. Such data contains no personal data and cannot be used to identify any individual student, parent, teacher, or school.</p>
              </Sub>
            </Section>

            <Section id="confidential" title="9. Confidentiality">
              <p>
                Each party (<strong>"Receiving Party"</strong>) agrees to hold in strict confidence any non-public information disclosed by the other party (<strong>"Disclosing Party"</strong>) in connection with these Terms, and to use such information only for the purposes of performing obligations under these Terms.
              </p>
              <Table
                headers={['Confidential information of', 'Examples']}
                rows={[
                  ['School (Disclosing Party)', 'All School Data, student records, financial records, school fee structures, internal policies, staff information, exam papers, and any other non-public information about the school\'s operations'],
                  ['Msingi (Disclosing Party)',  'Platform source code, algorithms, pricing structures, customer lists, roadmap, technical architecture, sub-processor identities, and commercial terms'],
                ]}
              />
              <p>Confidentiality obligations do not apply to information that:</p>
              <AlphaList items={[
                'Is or becomes publicly known through no breach by the Receiving Party;',
                'Was already in the Receiving Party\'s possession before disclosure, without confidentiality restriction;',
                'Is independently developed by the Receiving Party without reference to the Disclosing Party\'s information;',
                'Is required to be disclosed by law, court order, or regulatory authority — in which case the Receiving Party shall provide prompt notice to the Disclosing Party before disclosure to the extent permitted by law.',
              ]} />
            </Section>

            <Section id="availability" title="10. Service Availability and Disclaimers">
              <Sub title="10.1 Uptime target">
                <p>Msingi targets <strong>99.9% monthly uptime</strong> for the Platform. Planned maintenance will be communicated at least 48 hours in advance where operationally feasible. Unplanned outages will be addressed as promptly as technically practicable. The uptime calculation excludes scheduled maintenance windows, internet connectivity issues outside Msingi's infrastructure, and Force Majeure events.</p>
              </Sub>

              <Sub title="10.2 No warranty">
                <p>To the maximum extent permitted by applicable law, the Platform is provided <strong>"as is"</strong> and <strong>"as available"</strong>. Msingi expressly disclaims all warranties, express or implied, including but not limited to:</p>
                <AlphaList items={[
                  'Implied warranties of merchantability or fitness for a particular purpose;',
                  'Warranties that the Platform will be entirely error-free, uninterrupted, or free from security vulnerabilities;',
                  'Warranties that the Platform will meet any specific requirements of the School beyond the documented features;',
                  'Warranties regarding the accuracy of any data analytics, projections, or reports generated by the Platform based on School Data.',
                ]} />
              </Sub>

              <Sub title="10.3 Third-party services">
                <p>The Platform integrates with third-party services including Safaricom's M-Pesa payment infrastructure. Msingi is not responsible for downtime, transaction failures, delays, or errors originating from Safaricom's systems or any other third-party service provider. The School agrees that M-Pesa payments are subject to Safaricom's own terms and conditions.</p>
              </Sub>

              <Sub title="10.4 Internet dependency">
                <p>The Platform requires stable internet connectivity. Msingi is not liable for degraded performance or unavailability caused by the School's internet service provider, power infrastructure, local network issues, or regulatory-imposed internet restrictions in the School's jurisdiction.</p>
              </Sub>
            </Section>

            <Section id="liability" title="11. Limitation of Liability">
              <Callout color="red">
                <strong>Important:</strong> Please read this section carefully. It limits Msingi's financial liability to the School.
              </Callout>

              <Sub title="11.1 Cap on liability">
                <p>To the maximum extent permitted by applicable law, Msingi's total cumulative liability to the School arising from or related to these Terms or the School's use of the Platform — whether based in contract, tort (including negligence), statute, equity, or any other legal theory — shall not exceed the total subscription fees paid by the School to Msingi in the <strong>twelve (12) months immediately preceding the event giving rise to the claim</strong>.</p>
              </Sub>

              <Sub title="11.2 Excluded losses">
                <p>In no event shall Msingi be liable for:</p>
                <AlphaList items={[
                  'Indirect, incidental, special, consequential, exemplary, or punitive damages;',
                  'Loss of profit, revenue, goodwill, anticipated savings, business opportunity, or contracts;',
                  'Loss of, corruption of, or inability to recover data — provided Msingi maintains its standard backup practices;',
                  'Errors, omissions, or regulatory penalties arising from inaccurate data entered by the School or its Authorised Users;',
                  'Damages resulting from M-Pesa downtime, Safaricom infrastructure failures, or disputes between the School and parents regarding fee transactions;',
                  'Damages caused by Force Majeure events, internet provider failures, or power infrastructure failures;',
                  'Damages arising from the School\'s failure to comply with KDPA or applicable data protection law in its capacity as Data Controller.',
                ]} />
              </Sub>

              <Sub title="11.3 Exceptions">
                <p>Nothing in these Terms excludes or limits liability for:</p>
                <AlphaList items={[
                  'Death or personal injury caused by Msingi\'s negligence;',
                  'Fraud or fraudulent misrepresentation by Msingi;',
                  'Any liability that cannot be excluded or limited under applicable law in Kenya or the School\'s jurisdiction.',
                ]} />
              </Sub>
            </Section>

            <Section id="indemnity" title="12. Indemnification">
              <p>The School agrees to indemnify, defend, and hold harmless Msingi, its directors, officers, employees, contractors, and agents from and against any and all claims, damages, losses, fines, penalties, and costs (including reasonable legal fees) arising from or related to:</p>
              <AlphaList items={[
                'The School\'s breach of any provision of these Terms;',
                'The School\'s violation of any applicable law, including KDPA obligations as Data Controller, education regulations, and consumer protection laws;',
                'School Data that infringes, violates, or misappropriates any third-party intellectual property rights, privacy rights, or applicable regulations;',
                'The School\'s failure to obtain appropriate parental or guardian consent before uploading minor student data to the Platform;',
                'Unauthorised access to the Platform facilitated by the School\'s failure to maintain credential security or control Authorised User access;',
                'Any claim brought by a parent, guardian, student, or staff member arising from the School\'s data protection obligations in its capacity as Data Controller;',
                'Any misrepresentation made by the School during the onboarding or subscription process.',
              ]} />
            </Section>

            <Section id="termination" title="13. Term and Termination">
              <Sub title="13.1 Commencement">
                <p>These Terms commence on the date the School completes the onboarding process and continues until terminated in accordance with this section.</p>
              </Sub>

              <Sub title="13.2 Termination by the School">
                <p>The School may terminate its subscription at any time by providing <strong>30 days' written notice</strong> to <a href="mailto:hello@msingi.io" className="text-indigo-600 hover:underline">hello@msingi.io</a>. Termination does not entitle the School to a refund of any fees already paid for the current term.</p>
              </Sub>

              <Sub title="13.3 Termination by Msingi for breach">
                <p>Msingi may terminate the School's access immediately upon written notice if:</p>
                <AlphaList items={[
                  'The School materially breaches these Terms and fails to remedy the breach within 14 days of written notice from Msingi;',
                  'The School engages in fraudulent activity, including misrepresentation of student counts;',
                  'The School\'s use of the Platform creates material legal liability or regulatory risk for Msingi;',
                  'The School\'s use of the Platform causes harm to other schools on the Platform or to the integrity of the shared infrastructure.',
                ]} />
              </Sub>

              <Sub title="13.4 Termination for sustained non-payment">
                <p>Msingi may terminate the subscription if fees remain unpaid more than 60 days after the due date, following the suspension procedure described in Section 5.4.</p>
              </Sub>

              <Sub title="13.5 Effect of termination — data handling">
                <Callout color="amber">
                  <strong>Data export window:</strong> On the effective date of termination (for any reason), the School's active platform access is deactivated. The School will have <strong>30 days</strong> to export all School Data using the Platform's built-in backup export function. After 30 days, <strong>all School Data will be permanently and irreversibly deleted</strong> from all Msingi systems, including all backup copies. This deletion is final — Msingi cannot recover data after this deletion has been completed.
                </Callout>
              </Sub>

              <Sub title="13.6 Survival">
                <p>The following sections survive termination: Section 8 (Intellectual Property), Section 9 (Confidentiality), Section 11 (Limitation of Liability), Section 12 (Indemnification), Section 15 (Governing Law and Disputes), and any payment obligations accrued before termination.</p>
              </Sub>
            </Section>

            <Section id="modifications" title="14. Modifications to Terms and Service">
              <Sub title="14.1 Changes to Terms">
                <p>Msingi may update these Terms from time to time. For <strong>material changes</strong> (those that reduce the School's rights, increase the School's obligations, or significantly alter the commercial terms), Msingi will:</p>
                <List items={[
                  'Send written notice to the school administrator email address on record at least 30 days before the changes take effect;',
                  'Clearly identify what has changed and why;',
                  'Provide an opportunity to raise objections before the effective date.',
                ]} />
                <p className="mt-3">Continued use of the Platform after the effective date of updated Terms constitutes acceptance. If the School does not accept a material change, it may terminate the subscription by providing notice before the effective date in accordance with Section 13.2.</p>
              </Sub>

              <Sub title="14.2 Changes to the Platform">
                <p>Msingi may update, add, modify, or discontinue Platform features and modules. Where a feature central to the School's subscribed tier is permanently removed, Msingi will provide at least 60 days' notice and, where appropriate, a proportional subscription credit or an alternative feature offering. Minor updates, bug fixes, and security patches may be applied without notice.</p>
              </Sub>
            </Section>

            <Section id="governing" title="15. Governing Law and Dispute Resolution">
              <Sub title="15.1 Governing law">
                <p>These Terms and any dispute or claim arising out of or in connection with them (including non-contractual disputes or claims) are governed by and construed in accordance with the laws of the <strong>Republic of Kenya</strong>.</p>
              </Sub>

              <Sub title="15.2 Step 1 — Negotiation">
                <p>In the event of any dispute, controversy, or claim arising out of or relating to these Terms or the Platform, the parties agree to first attempt to resolve the matter through good-faith written negotiation. Either party may initiate the process by sending a written notice of dispute to the other party. The parties shall attempt to resolve the dispute within <strong>30 days</strong> of the notice date.</p>
              </Sub>

              <Sub title="15.3 Step 2 — Arbitration">
                <p>If the parties fail to resolve the dispute within 30 days of the written notice (or such longer period as agreed in writing), the dispute shall be finally resolved by binding arbitration administered by the <strong>Nairobi Centre for International Arbitration (NCIA)</strong> in Nairobi, Kenya, in accordance with the NCIA Rules in effect at the time. The arbitration shall be:</p>
                <List items={[
                  'Conducted in the English language;',
                  'Before a sole arbitrator unless the claim exceeds KES 5,000,000, in which case a panel of three arbitrators shall be convened;',
                  'Confidential — neither party shall disclose the existence, content, or outcome of the arbitration without the other\'s consent, except as required by law.',
                ]} />
              </Sub>

              <Sub title="15.4 Emergency relief">
                <p>Notwithstanding Section 15.3, either party may seek emergency injunctive relief or other provisional remedies from the Kenyan courts (High Court or Environment and Land Court, as appropriate) without first exhausting the negotiation or arbitration process. Seeking such relief shall not waive the right to arbitration on the underlying dispute.</p>
              </Sub>
            </Section>

            <Section id="general" title="16. General Provisions">
              <Sub title="16.1 Entire agreement">
                <p>These Terms, together with the Privacy Policy and Data Processing Agreement, constitute the entire agreement between the parties regarding the Platform and supersede all prior negotiations, representations, warranties, and agreements, whether oral or written. No verbal representation made by any Msingi employee or agent modifies these Terms unless confirmed in writing.</p>
              </Sub>

              <Sub title="16.2 Severability">
                <p>If any provision of these Terms is found to be invalid, illegal, or unenforceable by a court or arbitrator of competent jurisdiction, that provision shall be modified to the minimum extent necessary to make it enforceable while preserving the intent of the original. All other provisions shall remain in full force and effect.</p>
              </Sub>

              <Sub title="16.3 Waiver">
                <p>Failure by either party to enforce any provision of these Terms, or to exercise any right hereunder, shall not constitute a waiver of that provision or right, nor prevent enforcement of that provision or right on any future occasion.</p>
              </Sub>

              <Sub title="16.4 Assignment">
                <p>The School may not assign, transfer, or novate any rights or obligations under these Terms to any third party without Msingi's prior written consent. Msingi may assign its rights and obligations to a successor entity in the event of a merger, acquisition, or reorganisation, provided the successor entity assumes all Msingi's obligations to the School under these Terms.</p>
              </Sub>

              <Sub title="16.5 Force Majeure">
                <p>Neither party shall be liable to the other for delays or failures in performance resulting from a Force Majeure event, provided that the affected party: (a) promptly notifies the other party; (b) takes all reasonable steps to minimise the impact; and (c) resumes performance as soon as the Force Majeure event ceases. If a Force Majeure event continues for more than 60 days, either party may terminate the affected subscription on 14 days' notice without penalty.</p>
              </Sub>

              <Sub title="16.6 Notices">
                <p>Legal notices under these Terms must be delivered by email to:</p>
                <Table
                  headers={['Party', 'Notice email']}
                  rows={[
                    ['Msingi', 'hello@msingi.io (or legal@msingi.io for formal legal notices)'],
                    ['School', 'The primary administrator email address registered on the Platform during onboarding'],
                  ]}
                />
                <p className="text-sm text-slate-500">Notices sent by email are effective on transmission, provided no delivery failure notification is received by the sender within 24 hours.</p>
              </Sub>

              <Sub title="16.7 Relationship of parties">
                <p>The parties are independent contractors. Nothing in these Terms creates a partnership, joint venture, agency, employment, or franchise relationship between Msingi and the School.</p>
              </Sub>

              <Sub title="16.8 Language">
                <p>These Terms are drafted in the English language. In the event of any translation into another language, the English version shall prevail to the extent of any inconsistency.</p>
              </Sub>

              <Sub title="16.9 Electronic signature">
                <p>The School's electronic acceptance of these Terms during the onboarding process, whether by clicking "I agree," completing the registration form, or accessing the Platform, constitutes a valid and binding electronic signature in accordance with the Kenya Information and Communications (Electronic Certification and Domain Administration) Regulations, 2010.</p>
              </Sub>
            </Section>

            <Section id="contact" title="17. Contact">
              <p>For questions, notices, or concerns regarding these Terms:</p>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">InnoLearn Limited</p>
                  <p className="text-slate-500 text-xs">Trading as Msingi</p>
                </div>
                <div className="space-y-1.5 text-slate-600">
                  <p>General enquiries: <a href="mailto:hello@msingi.io" className="text-indigo-600 hover:underline">hello@msingi.io</a></p>
                  <p>Legal notices: <a href="mailto:legal@msingi.io" className="text-indigo-600 hover:underline">legal@msingi.io</a></p>
                  <p>Privacy and data: <a href="mailto:privacy@msingi.io" className="text-indigo-600 hover:underline">privacy@msingi.io</a></p>
                  <p>Website: <a href="https://msingi.io" className="text-indigo-600 hover:underline">msingi.io</a></p>
                </div>
              </div>

              <Callout color="indigo">
                Schools are encouraged to contact <strong>hello@msingi.io</strong> with any questions before signing up. We are happy to answer compliance questions, provide the Data Processing Agreement in advance, or discuss customised arrangements for large institutions.
              </Callout>

              <div className="mt-6 pt-6 border-t border-slate-100 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="text-sm text-slate-500">
                  Also see our <Link to="/privacy" className="text-indigo-600 hover:underline font-medium">Privacy Policy</Link> for full details on data processing and your rights.
                </div>
                <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
                  <ArrowLeft size={14} />
                  Back to Msingi
                </Link>
              </div>
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
            <Link to="/privacy" className="hover:text-slate-700 transition-colors">Privacy Policy</Link>
            <a href="mailto:hello@msingi.io" className="hover:text-slate-700 transition-colors">hello@msingi.io</a>
          </div>
        </div>
      </footer>

      {/* Back to top */}
      {showTop && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all">
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );
}
