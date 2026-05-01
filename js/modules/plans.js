/* ============================================================
   InnoLearn — Plans & Feature Gating Module
   Controls which modules are accessible based on the school's
   subscription plan (core / standard / premium / enterprise).
   ============================================================ */

const Plans = (() => {

  /* ── Plan definitions ───────────────────────────────────────
     Each plan ADDS modules on top of the previous tier.
  ─────────────────────────────────────────────────────────── */
  const PLAN_MODULES = {
    core: [
      'dashboard','students','admissions','classes','subjects',
      'attendance','academics','exams','communication',
      'events','reports','settings','help','changelog'
    ],
    standard: ['timetable','behaviour'],
    premium:  ['finance','hr'],
    enterprise: ['lms']
  };

  const PLAN_LABELS = {
    core:       'Core',
    standard:   'Standard',
    premium:    'Premium',
    enterprise: 'Enterprise'
  };

  const PLAN_PRICES = {
    core:       { monthly: 15000, label: 'KES 15,000/month' },
    standard:   { monthly: 35000, label: 'KES 35,000/month' },
    premium:    { monthly: 65000, label: 'KES 65,000/month' },
    enterprise: { monthly: null,  label: 'Custom pricing'   }
  };

  // Which plan first unlocks a given module
  const MODULE_PLAN = {
    dashboard:     'core', students:'core', admissions:'core', classes:'core',
    subjects:      'core', attendance:'core', academics:'core', exams:'core',
    communication: 'core', events:'core', reports:'core', settings:'core',
    help:          'core', changelog:'core',
    timetable:     'standard', behaviour:'standard',
    finance:       'premium', hr:'premium',
    lms:           'enterprise'
  };

  /* ── What modules does a plan include? ── */
  function allowedModules(plan, addOns = []) {
    const included = [...PLAN_MODULES.core];
    if (['standard','premium','enterprise'].includes(plan))
      included.push(...PLAN_MODULES.standard);
    if (['premium','enterprise'].includes(plan))
      included.push(...PLAN_MODULES.premium);
    if (plan === 'enterprise')
      included.push(...PLAN_MODULES.enterprise);
    return [...new Set([...included, ...addOns])];
  }

  /* ── Can the current school access this module? ── */
  function can(moduleName) {
    const school = Auth.currentSchool;
    if (!school) return false;
    // Enterprise and any school with no plan recorded gets full access
    if (school.plan === 'enterprise' || !school.plan) return true;
    return allowedModules(school.plan, school.addOns || []).includes(moduleName);
  }

  /* ── Which plan is required for a module? ── */
  function requiredPlan(moduleName) {
    return MODULE_PLAN[moduleName] || 'core';
  }

  /* ── Render an upgrade wall for a locked module ── */
  function renderUpgradeWall(moduleName) {
    const school     = Auth.currentSchool;
    const current    = school?.plan || 'core';
    const needed     = requiredPlan(moduleName);
    const neededLabel = PLAN_LABELS[needed] || needed;
    const neededPrice = PLAN_PRICES[needed]?.label || '';
    const currentLabel = PLAN_LABELS[current] || current;

    // What the next plan includes
    const nextPlanModules = {
      standard: ['Advanced Timetable', 'Behaviour & Pastoral'],
      premium:  ['Finance & Invoicing', 'M-Pesa Integration', 'HR & Payroll', 'Leave Management'],
      enterprise: ['LMS / E-learning', 'Mobile App', 'White-label Domain', 'Dedicated Support']
    };
    const extras = nextPlanModules[needed] || [];

    App.renderPage(`
    <div style="display:flex;align-items:center;justify-content:center;min-height:60vh;padding:40px 20px">
      <div style="max-width:480px;width:100%;text-align:center">

        <div style="font-size:56px;margin-bottom:16px">🔒</div>

        <h2 style="font-size:22px;font-weight:800;color:var(--gray-900);margin-bottom:8px">
          ${_moduleLabel(moduleName)} is not included in your plan
        </h2>
        <p style="color:var(--gray-500);font-size:14px;margin-bottom:28px;line-height:1.6">
          You're on the <strong>${currentLabel}</strong> plan.
          Upgrade to <strong>${neededLabel}</strong> to unlock this module.
        </p>

        <div style="background:linear-gradient(135deg,var(--primary-light),#ede9fe);border-radius:16px;padding:24px;margin-bottom:28px;text-align:left">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--primary);margin-bottom:12px">
            ${neededLabel} Plan — ${neededPrice}
          </div>
          ${extras.map(f => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px;color:var(--gray-700)">
              <i class="fas fa-check-circle" style="color:var(--primary);width:16px"></i> ${f}
            </div>`).join('')}
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px;color:var(--gray-700)">
            <i class="fas fa-check-circle" style="color:var(--primary);width:16px"></i>
            Everything in ${currentLabel}
          </div>
        </div>

        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <a href="mailto:sales@InnoLearn.co.ke?subject=Upgrade to ${neededLabel} — ${school?.name || ''}"
             class="btn" style="background:var(--primary);color:#fff;padding:12px 28px">
            <i class="fas fa-arrow-up"></i> Upgrade to ${neededLabel}
          </a>
          <button class="btn btn-secondary" onclick="history.back()">
            <i class="fas fa-arrow-left"></i> Go Back
          </button>
        </div>

        <p style="margin-top:20px;font-size:12px;color:var(--gray-400)">
          Contact us at <a href="mailto:sales@InnoLearn.co.ke" style="color:var(--primary)">sales@InnoLearn.co.ke</a>
          or call <strong>+254 700 000 000</strong>
        </p>
      </div>
    </div>`);
  }

  function _moduleLabel(mod) {
    const labels = {
      finance:'Finance & Invoicing', hr:'HR & Staff', behaviour:'Behaviour & Pastoral',
      timetable:'Advanced Timetable', lms:'LMS / E-learning'
    };
    return labels[mod] || mod.charAt(0).toUpperCase() + mod.slice(1);
  }

  return { can, allowedModules, requiredPlan, renderUpgradeWall, PLAN_LABELS, PLAN_PRICES, PLAN_MODULES };
})();
