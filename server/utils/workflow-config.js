/* ============================================================
   Msingi — Workflow Configuration (Governance Spec §0)

   School-authored, ordered approval chains, stored the same
   tenant-scoped way as role_permissions. A step's assigneeValue is
   always a stable reference — a roleKey (matching role_permissions/
   custom_roles.key) or a real users.id — never a copied display
   name. custom_roles.label is independently editable and the role
   is deletable, so freezing a name into a step would silently go
   stale or dangle. Display names are resolved live via
   resolveAssigneeLabel(), only ever for point-in-time snapshots
   (e.g. an audit-log entry), never written back into the config.

   See docs/governance/GOVERNANCE_WORKFLOW_SPECIFICATION_v1.md §0.
   ============================================================ */
const { tenantModel } = require('./tenant-model');

const ASSIGNEE_TYPES = new Set(['role', 'user']);

function _validateStep(step) {
  if (!step || typeof step !== 'object') return 'Each step must be an object';
  if (!ASSIGNEE_TYPES.has(step.assigneeType)) return "assigneeType must be 'role' or 'user'";
  if (!step.assigneeValue || typeof step.assigneeValue !== 'string') return 'assigneeValue is required';
  if (step.fallback) {
    if (!ASSIGNEE_TYPES.has(step.fallback.assigneeType)) return "fallback.assigneeType must be 'role' or 'user'";
    if (!step.fallback.assigneeValue || typeof step.fallback.assigneeValue !== 'string') return 'fallback.assigneeValue is required';
  }
  return null;
}

/** minSteps: leave_approval enforces >=2 (platform floor before HR); single-step workflows (e.g. marks_unlock) pass 1. */
function validateSteps(steps, minSteps = 1) {
  if (!Array.isArray(steps) || steps.length < minSteps) {
    return `At least ${minSteps} step${minSteps === 1 ? '' : 's'} required`;
  }
  for (const step of steps) {
    const err = _validateStep(step);
    if (err) return err;
  }
  return null;
}

async function getWorkflowConfig(ctx, schoolId, workflowKey) {
  return tenantModel('workflow_configs', ctx).findOne({ schoolId, workflowKey }).lean();
}

async function saveWorkflowConfig(ctx, schoolId, workflowKey, { steps, notifyOnly = [] }, updatedBy, minSteps = 1) {
  const err = validateSteps(steps, minSteps);
  if (err) throw Object.assign(new Error(err), { statusCode: 400 });

  const now = new Date().toISOString();
  const doc = await tenantModel('workflow_configs', ctx).findOneAndUpdate(
    { schoolId, workflowKey },
    { $set: {
        id: `wfc_${workflowKey}_${schoolId}`,
        schoolId, workflowKey, steps, notifyOnly,
        updatedBy, updatedAt: now,
      }
    },
    { upsert: true, new: true }
  ).lean();
  return doc;
}

/* Who currently holds a role — matches the same {role|roles|extraRoles}
   resolution pattern already used elsewhere in the codebase (e.g.
   lesson-reminders.js's HOD lookup), since a role like "HOD" is often a
   flag in extraRoles rather than a user's primary role. */
async function _resolveAssignee(ctx, schoolId, assigneeType, assigneeValue) {
  const Users = tenantModel('users', ctx);
  if (assigneeType === 'user') {
    const u = await Users.findOne({ id: assigneeValue, schoolId, isActive: { $ne: false } })
      .select('id name email role').lean();
    return u ? [u] : [];
  }
  // assigneeType === 'role'
  const users = await Users.find({
    schoolId,
    isActive: { $ne: false },
    $or: [{ role: assigneeValue }, { roles: assigneeValue }, { extraRoles: assigneeValue }],
  }).select('id name email role').lean();
  return users;
}

/* Resolve a single step to a list of active, eligible userIds. Covers
   both failure cases a step can hit at resolution time: a vacant role
   (nobody currently holds it) and a dangling reference (the referenced
   custom role was deleted, or the referenced user was deactivated/
   deleted after the workflow was configured) — findOne/find above
   already exclude inactive users and simply return no match for a
   deleted custom_roles key, so both collapse into the same empty-result
   path here. Falls back once, per the step's own configured fallback;
   returns [] (no eligible assignee) if there's no fallback or it is
   also empty — callers must handle that as "flag for attention", not
   silently stall. */
async function resolveStep(ctx, schoolId, step) {
  const candidates = await _resolveAssignee(ctx, schoolId, step.assigneeType, step.assigneeValue);
  if (candidates.length > 0) return candidates;
  if (step.fallback) return _resolveAssignee(ctx, schoolId, step.fallback.assigneeType, step.fallback.assigneeValue);
  return [];
}

/* Live display-name resolution — for point-in-time snapshots (e.g. an
   audit-log entry) only. Never store the result back into a config. */
async function resolveAssigneeLabel(ctx, schoolId, assigneeType, assigneeValue) {
  if (assigneeType === 'user') {
    const u = await tenantModel('users', ctx).findOne({ id: assigneeValue, schoolId }).select('name').lean();
    return u?.name || assigneeValue;
  }
  const customRole = await tenantModel('custom_roles', ctx).findOne({ schoolId, key: assigneeValue }).select('label').lean();
  if (customRole?.label) return customRole.label;
  // Built-in role with no custom_roles doc — humanize the key (e.g. 'deputy_principal' -> 'Deputy Principal')
  return assigneeValue.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = {
  validateSteps,
  getWorkflowConfig,
  saveWorkflowConfig,
  resolveStep,
  resolveAssigneeLabel,
};
