// Pain-point FAQs — landing page teaser + /faq page
export const FAQ_CATEGORIES = [
  {
    category: 'Fees & Payments',
    faqs: [
      {
        q: 'How does Msingi handle M-Pesa school fee collection?',
        a: 'Msingi sends an STK Push directly to the parent\'s phone. When they approve, the payment is confirmed and reconciled to the student\'s fee account automatically — no manual matching, no separate spreadsheet. Paybill, bank transfer, and cash are all recorded in the same register with receipt numbers, so the bursar sees one complete ledger regardless of how each family pays.',
      },
      {
        q: 'Can our school switch from Excel fee tracking to Msingi?',
        a: 'Yes. Schools that previously managed fees in Excel typically complete the transition in one term. Student records and fee structures are imported via CSV, and from day one every payment — whether M-Pesa, bank, or cash — posts directly to each student\'s ledger without manual reconciliation. The bursar\'s job shifts from matching entries to reviewing exceptions.',
      },
      {
        q: 'What if a parent disputes a fee payment or receipt?',
        a: 'Every payment is permanently logged with the M-Pesa transaction reference, receipt number, amount, and entry timestamp. If a parent questions a payment, you can show them the exact record in seconds — including whether it came via STK Push, Paybill, or cash entry. There is no ambiguity and no manual digging through bank statements.',
      },
    ],
  },
  {
    category: 'Data & Security',
    faqs: [
      {
        q: 'What happens to school data if a staff member leaves?',
        a: 'All data is stored in the cloud under your school\'s account — not on any individual\'s device, personal email, or spreadsheet. When a staff member leaves, you revoke their login in seconds. Everything they created, approved, or recorded stays exactly where it was. The permanent audit trail shows their actions with attribution, but the data belongs to the institution, not the person.',
      },
      {
        q: 'Is our school\'s data stored securely and kept separate from other schools?',
        a: 'Yes. Every school\'s data is architecturally isolated at the database layer — no school can ever read another school\'s records. All data is encrypted in transit and at rest, backed up automatically every day, and accessible only to users with an active account at that school. Every action taken in the system is permanently logged with name, timestamp, and context.',
      },
    ],
  },
  {
    category: 'Academic & Curriculum',
    faqs: [
      {
        q: 'Does Msingi support CBC and 8-4-4 curriculum?',
        a: 'Yes. Msingi supports CBC, 8-4-4, IGCSE, Cambridge, IB, and fully custom grading frameworks. Schools running more than one curriculum — for example, offering both CBC and IGCSE streams — manage them within the same system with no duplication. Grade boundaries, assessment weighting, and report card templates are configured per curriculum.',
      },
      {
        q: 'How long does it take to publish report cards?',
        a: 'Report cards that previously took a week of chasing signatures can be published in hours. Msingi enforces a five-stage approval chain — Teacher → HOD → Deputy → Principal → Parent Portal — and runs stages in parallel where possible. Publication is blocked until every stage is cleared for every student in the class. The moment the principal approves, parents are notified and the report card is live in their portal.',
      },
      {
        q: 'What if a parent disputes a grade?',
        a: 'Every mark entry, HOD review, and moderation step is permanently logged with the name of the person who took the action and the exact timestamp. If a parent questions a grade, you can show them the full approval chain in seconds — who submitted, who reviewed, who moderated, and when. The audit trail is permanent and cannot be edited after the fact.',
      },
    ],
  },
  {
    category: 'Portals & Parents',
    faqs: [
      {
        q: 'Can parents view school fees, attendance, and report cards online?',
        a: 'Yes — on the Family tier, parents get a dedicated portal showing their child\'s current fee balance, term attendance record, published report cards, and the curriculum topics covered in each subject. They receive automatic notifications when a payment is confirmed or a report card is published, without any manual message from staff.',
      },
    ],
  },
  {
    category: 'Getting Started',
    faqs: [
      {
        q: 'Can we import existing student records and keep our admission numbers?',
        a: 'Yes. Msingi accepts a CSV import that preserves your existing admission numbers so there is no disruption to your numbering system. If your last admission number was MLA-330297, the system picks up from 298 automatically. Historical records — attendance, grades, fees — can also be imported for continuity. Data migration support is included in the one-time setup fee.',
      },
      {
        q: 'How long does it take to set up Msingi for a new school?',
        a: 'Most schools are operational within 2–4 weeks. The setup process covers data migration from your existing records, class and subject configuration, staff account creation, and a training session for all users. Onboarding is included in the one-time setup fee and is coordinated by our team from first call to go-live.',
      },
      {
        q: 'Does Msingi work for boarding schools and schools with transport routes?',
        a: 'Yes. Msingi includes a Hostel module for boarding houses, room assignments, and occupancy tracking, with boarding fees billed through the same Finance module as tuition. The Transport module manages routes, stops, vehicle capacity, and driver contacts — capacity enforcement is built in, so a vehicle can never be over-assigned. Both modules are included in every plan.',
      },
    ],
  },
];

// The 3 questions shown as a teaser on the landing page
export const LANDING_FAQ_TEASER = [
  {
    q: 'How does Msingi handle M-Pesa school fee collection?',
    a: 'Msingi sends an STK Push directly to the parent\'s phone. When they approve, the payment is confirmed and reconciled to the student\'s fee account automatically — no manual matching, no separate spreadsheet. Paybill, bank, and cash all land in one live register with receipt numbers.',
  },
  {
    q: 'What happens to school data if a staff member leaves?',
    a: 'All data is stored in the cloud under your school\'s account — not on any individual\'s device or spreadsheet. When a staff member leaves, you revoke their login in seconds. Everything they created stays exactly where it was, with a permanent audit trail showing who did what.',
  },
  {
    q: 'How long does it take to publish report cards?',
    a: 'Report cards that previously took a week of chasing signatures can be published in hours. Msingi enforces a five-stage approval chain and blocks publication until every stage is cleared. The moment the principal approves, parents are notified and the report card is live in their portal.',
  },
];

// Flat list of all Q&A pairs for JSON-LD FAQPage schema
export const ALL_FAQS_FLAT = FAQ_CATEGORIES.flatMap(c => c.faqs);
