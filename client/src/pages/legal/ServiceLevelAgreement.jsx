import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const EFFECTIVE = '1 July 2026';
const EMAIL = 'support@msingi.io';

const TIERS = [
  { label: 'Critical', desc: 'Platform completely unavailable or data loss in progress', response: '2 hours', resolution: '8 hours' },
  { label: 'High',     desc: 'Core module unavailable (attendance, grades, finance)', response: '4 hours', resolution: '24 hours' },
  { label: 'Medium',   desc: 'Feature degraded but workaround exists', response: '8 hours', resolution: '72 hours' },
  { label: 'Low',      desc: 'Cosmetic issue, documentation request, or feature query', response: '2 business days', resolution: 'Next release cycle' },
];

const SECTIONS = [
  {
    title: '1. Scope',
    body: [
      'This Service Level Agreement ("SLA") applies to all schools subscribed to Msingi on a paid plan. It defines the availability commitments, support response times, and remedies available to schools when those commitments are not met.',
      'This SLA does not apply to: free trials; beta features explicitly marked as such; third-party services integrated with Msingi (including M-Pesa, payment gateways, and SMS providers); or outages caused by factors outside Msingi\'s reasonable control.',
    ],
  },
  {
    title: '2. Availability Commitment',
    body: [
      'Msingi commits to a monthly uptime of 99.5% for the core platform, measured across all production services. Uptime is calculated as: (Total minutes in month − minutes of downtime) ÷ Total minutes in month × 100.',
      '"Downtime" means the platform is completely inaccessible to all users of an affected school. Partial degradation (where some features are unavailable but the core platform remains accessible) does not count as downtime for SLA calculation purposes.',
      'Scheduled maintenance windows are communicated at least 48 hours in advance via in-platform notice and email. Scheduled maintenance does not count as downtime.',
    ],
  },
  {
    title: '3. Support Channels',
    body: [
      `Primary support is available via email at ${EMAIL}. Schools are encouraged to use email for all non-critical issues so that a written record is maintained.`,
      'WhatsApp support is available for schools that have a named implementation contact. WhatsApp is appropriate for high and medium severity issues during business hours (Monday–Friday, 8 AM–6 PM EAT).',
      'Critical incidents (complete platform outage) may be escalated by phone. The emergency contact number is provided to each school at onboarding and included in the implementation handover document.',
    ],
  },
  {
    title: '4. Response and Resolution Times',
    body: [
      'Response time is defined as the time between a school submitting a support request and Msingi acknowledging the request and assigning it to a support engineer.',
      'Resolution time is defined as the time between acknowledgement and the issue being resolved or a confirmed workaround being in place. Complex issues may require deployment of a fix in the next release cycle.',
      'Times below apply during business hours (Monday–Friday, 8 AM–6 PM EAT) unless otherwise stated. Critical incidents are treated as 24/7.',
    ],
  },
  {
    title: '5. Planned Maintenance',
    body: [
      'Msingi may perform planned maintenance during low-traffic periods, typically 10 PM–2 AM EAT. Schools are notified at least 48 hours in advance for any maintenance expected to cause service interruption.',
      'Msingi targets zero-downtime deployments for routine releases. Where a deployment requires a brief restart, it is scheduled outside school hours.',
      'Emergency patches (security vulnerabilities, critical bug fixes) may be deployed with shorter notice. Msingi will communicate the reason and estimated impact as quickly as possible.',
    ],
  },
  {
    title: '6. Service Credits',
    body: [
      'If monthly uptime falls below 99.5%, the school is entitled to a service credit applied to the following billing period. Credits are calculated as follows: uptime between 99.0%–99.5% = 5% credit; uptime between 95.0%–99.0% = 10% credit; uptime below 95.0% = 25% credit.',
      'Service credits are the school\'s sole remedy for SLA breaches. Credits are not transferable and have no cash value. A credit claim must be submitted within 14 days of the end of the affected month by emailing the support address with the subject line "SLA Credit Request".',
      'Msingi\'s total liability for SLA credits in any calendar month shall not exceed the amount paid by the school for that month.',
    ],
  },
  {
    title: '7. Exclusions',
    body: [
      'The availability commitment and service credits do not apply where the incident was caused by: the school\'s own configuration changes or user error; third-party services outside Msingi\'s control (M-Pesa downtime, SMS gateway outages, internet connectivity at the school); force majeure events including natural disasters, government action, or widespread internet infrastructure failures; attacks on the school\'s own network or devices.',
    ],
  },
  {
    title: '8. Data Backup',
    body: [
      'Msingi performs automated encrypted backups of all school data. Backups are taken daily and retained for a minimum of 30 days. Backups are stored in a separate availability zone from production data.',
      'In the event of data loss caused by a Msingi-side failure, Msingi will restore data to the most recent backup point available. Schools are encouraged to export their data periodically using the platform\'s built-in export functions.',
    ],
  },
  {
    title: '9. Reporting',
    body: [
      'Msingi publishes a status page at status.msingi.io where schools can monitor current platform health and review historical uptime. Incidents are posted in real time.',
      'Monthly uptime reports are available to schools on written request. Automated monthly summary emails will be introduced in a future release.',
    ],
  },
  {
    title: '10. Changes to this SLA',
    body: [
      'Msingi may update this SLA with 30 days\' written notice. Updates will not reduce the availability commitment or support response times during an active subscription period without the school\'s consent.',
      'If a school does not accept a material reduction in SLA terms, it may terminate the subscription within 30 days of the notice and receive a pro-rated refund for the unused period.',
    ],
  },
];

export default function ServiceLevelAgreement() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Service Level Agreement | Msingi</title>
        <meta name="description" content="Msingi SLA — 99.5% uptime commitment, support response times, and service credits for schools on paid plans." />
        <link rel="canonical" href="https://msingi.io/legal/sla" />
      </Helmet>

      <BreadcrumbSchema items={[
        { name: 'Legal', href: '/privacy' },
        { name: 'Service Level Agreement', href: '/legal/sla' },
      ]} />
      <PublicNav />

      <main className="pt-32 pb-24">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Legal</p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter text-slate-900 mb-4">
              Service Level Agreement
            </h1>
            <p className="text-slate-500 text-sm">Effective date: {EFFECTIVE} · Applies to all paid Msingi subscriptions</p>
          </div>

          {/* Uptime headline */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 mb-2">Uptime Commitment</p>
            <p className="text-3xl font-bold text-emerald-800 mb-1">99.5%</p>
            <p className="text-sm text-emerald-700">Monthly uptime, measured across all production services.</p>
          </div>

          {/* Response time table */}
          <div className="mb-12">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Support Response Times</h2>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Severity</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden sm:table-cell">Description</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Response</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Resolution target</th>
                  </tr>
                </thead>
                <tbody>
                  {TIERS.map((tier, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-slate-900">{tier.label}</td>
                      <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{tier.desc}</td>
                      <td className="px-4 py-3 text-slate-700">{tier.response}</td>
                      <td className="px-4 py-3 text-slate-700">{tier.resolution}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="prose prose-slate max-w-none">
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
              SLA queries and credit requests: <a href={`mailto:${EMAIL}`} className="text-slate-900 underline underline-offset-2">{EMAIL}</a>
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link to="/privacy" className="text-slate-500 hover:text-slate-900 transition-colors">Privacy Policy →</Link>
              <Link to="/terms" className="text-slate-500 hover:text-slate-900 transition-colors">Terms of Service →</Link>
              <Link to="/legal/dpa" className="text-slate-500 hover:text-slate-900 transition-colors">Data Processing Agreement →</Link>
            </div>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
