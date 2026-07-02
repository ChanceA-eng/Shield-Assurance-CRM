import SectionLayout from '../../../components/crm/SectionLayout';
import NewPersonalSubmission from './submission-form';

export default function NewPersonalSubmissionPage(): JSX.Element {
  return (
    <SectionLayout title="Personal - New Submission">
      <NewPersonalSubmission />
    </SectionLayout>
  );
}
