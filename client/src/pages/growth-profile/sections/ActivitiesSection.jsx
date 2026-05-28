import { Music } from 'lucide-react';
import RecordSection from './RecordSection.jsx';

const CONFIG = {
  title:        'Activities',
  description:  'Co-curricular and extracurricular activities, clubs, sports, and enrichment.',
  icon:         Music,
  titlePlaceholder: 'e.g. School Orchestra, Chess Club, Swimming Team',
  categories: [
    'Sports', 'Music & Performing Arts', 'Debate & Public Speaking',
    'Science & Technology', 'Arts & Crafts', 'Language & Literature',
    'Clubs & Societies', 'Academic Competition', 'Cultural', 'Other',
  ],
  extraFields: ['level', 'organization', 'achievement'],
};

export default function ActivitiesSection({ studentId, canEdit, canVerify, isAdmin }) {
  return (
    <RecordSection
      type="activities"
      studentId={studentId}
      canEdit={canEdit}
      canVerify={canVerify}
      isAdmin={isAdmin}
      config={CONFIG}
    />
  );
}
