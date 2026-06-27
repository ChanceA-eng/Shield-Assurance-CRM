import SectionLayout from '../../components/crm/SectionLayout';
import RashiChatWorkspace from '../../components/rashi/rashi-chat-workspace';

export default function RashiHomePage(): JSX.Element {
  return (
    <SectionLayout title="Rashi Chat">
      <RashiChatWorkspace
        title="Rashi Underwriting Chat"
        description="Conversational underwriting intelligence grounded in your carrier, state, and policy knowledge base."
      />
    </SectionLayout>
  );
}