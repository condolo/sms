import { Heart } from 'lucide-react';
import RecordSection from './RecordSection.jsx';

const CONFIG = {
  title:        'Service',
  description:  'Community service, volunteering, social impact projects, and civic participation.',
  icon:         Heart,
  titlePlaceholder: 'e.g. Hospital Volunteering, Tree Planting Drive, Tutoring',
  categories: [
    'Community Volunteering', 'Environmental', 'Healthcare & Wellbeing',
    'Education & Tutoring', 'Disaster Relief', 'Religious & Faith-Based',
    'Animal Welfare', 'Cultural Preservation', 'Other',
  ],
  extraFields: ['hours', 'organization', 'location', 'achievement'],
};

export default function ServiceSection({ studentId, canEdit, canVerify, isAdmin }) {
  return (
    <RecordSection
      type="service"
      studentId={studentId}
      canEdit={canEdit}
      canVerify={canVerify}
      isAdmin={isAdmin}
      config={CONFIG}
    />
  );
}
