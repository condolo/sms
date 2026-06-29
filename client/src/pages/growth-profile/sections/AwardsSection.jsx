import { Award } from 'lucide-react';
import RecordSection from './RecordSection.jsx';

const CONFIG = {
  title:        'Awards',
  description:  'Prizes, certificates, competitions, recognition, and honours received.',
  icon:         Award,
  titlePlaceholder: 'e.g. First Prize — National Science Fair',
  categories: [
    'Academic Excellence', 'Science & Technology', 'Arts & Culture',
    'Sports', 'Leadership', 'Community Service', 'Language',
    'Music & Performing Arts', 'Scholarship', 'Other',
  ],
  extraFields: ['level', 'issuer', 'achievement', 'evidenceUrl'],
};

export default function AwardsSection({ studentId, canEdit, canVerify, isAdmin }) {
  return (
    <RecordSection
      type="awards"
      studentId={studentId}
      canEdit={canEdit}
      canVerify={canVerify}
      isAdmin={isAdmin}
      config={CONFIG}
    />
  );
}
