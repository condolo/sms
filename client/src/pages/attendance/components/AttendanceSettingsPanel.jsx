/* ============================================================
   AttendanceSettingsPanel — admin-only configuration sub-module for
   Attendance. Raised directly: the Attendance Conflict Resolver
   assignment used to live inline on the operational Conflicts queue
   view — moved here, its own dedicated configuration area, rather than
   sitting on top of the day-to-day list. Also holds the new Absentee
   Alert Recipient assignment (who gets notified — in-app, and by email
   if the school has that channel on under Settings → Notifications —
   the moment a student is marked absent).

   Both use the same {role|user} assignment primitive (workflow-config.js)
   Behaviour Officer already established — see AttendanceAssigneeSection.
   ============================================================ */
import { attendance as attendanceApi } from '@/api/client.js';
import AttendanceAssigneeSection from './AttendanceAssigneeSection.jsx';

const STAFF_ROLES = [
  { key: 'admin',              label: 'Admin' },
  { key: 'deputy_principal',   label: 'Deputy Principal' },
  { key: 'admissions_officer', label: 'Admissions Officer' },
  { key: 'section_head',       label: 'Section Head' },
  { key: 'front_office',       label: 'Front Office' },
];

export default function AttendanceSettingsPanel() {
  return (
    <div className="max-w-screen-xl mx-auto px-6 py-5 space-y-4">
      <AttendanceAssigneeSection
        title="Absentee Alert Recipient"
        description={'Notified in-app — and by email if enabled under Settings → Notifications → "Student Marked Absent (Staff Alert)" — the moment a student is marked absent. Most schools assign this to Admissions, since they’re the ones who call the parent.'}
        accent="amber"
        queryKey={['attendance', 'absentee-officer-config']}
        roleOptions={STAFF_ROLES}
        getConfig={() => attendanceApi.absenteeOfficerConfig.get()}
        saveConfig={(steps) => attendanceApi.absenteeOfficerConfig.save(steps)}
        emptyLabel="Nobody assigned yet — absences still show on the Absentees tab, just without a real-time alert."
        savedLabel="Absentee Alert Recipient updated."
      />
      <AttendanceAssigneeSection
        title="Attendance Conflict Resolver"
        description="Notified when a student is marked both present and absent the same day, and can resolve the case (with a reason, kept as a permanent record) regardless of their own role's normal permissions. Most schools assign this to Admissions too."
        accent="sky"
        queryKey={['attendance', 'conflict-officer-config']}
        roleOptions={STAFF_ROLES}
        getConfig={() => attendanceApi.conflictOfficerConfig.get()}
        saveConfig={(steps) => attendanceApi.conflictOfficerConfig.save(steps)}
        emptyLabel={'Nobody assigned yet — grant "Attendance Conflicts" explicitly under Roles & Permissions instead.'}
        savedLabel="Attendance Conflict Resolver updated."
      />
    </div>
  );
}
