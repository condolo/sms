import { Crown } from 'lucide-react';
import RecordSection from './RecordSection.jsx';

const CONFIG = {
  title:        'Leadership',
  description:  'Positions held, roles, responsibilities, and leadership experiences.',
  icon:         Crown,
  titlePlaceholder: 'e.g. Head Boy, Prefect, Club President',
  categories: [
    'School Council', 'Prefect / Head Boy / Girl', 'Club Officer',
    'Team Captain', 'Community Leader', 'Peer Mentor', 'Other',
  ],
  extraFields: ['level', 'organization', 'achievement'],
};

export default function LeadershipSection({ studentId, canEdit, canVerify, isAdmin }) {
  return (
    <RecordSection
      type="leadership"
      studentId={studentId}
      canEdit={canEdit}
      canVerify={canVerify}
      isAdmin={isAdmin}
      config={CONFIG}
    />
  );
}
