import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleSixLessonFourPage(): JSX.Element {
  return (
    <SectionLayout title="Module 6 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 6</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Field Positioning and Contractor Scripts</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            This lesson translates coverage mechanics into practical sales and advisory language for contractor conversations.
            It focuses on common objections and clear responses that improve understanding and compliance outcomes.
          </p>
          <p className="leading-relaxed text-slate-700">
            The goal is to simplify a complex topic without losing legal and claims accuracy.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Contractor Meeting - Auto Liability Education Script]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Four Common Myths to Address</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Myth 1:</strong> We do not own vehicles, so we do not need auto coverage.</li>
            <li><strong>Myth 2:</strong> Employee personal auto insurance always protects the employer.</li>
            <li><strong>Myth 3:</strong> Rental company coverage is automatically sufficient.</li>
            <li><strong>Myth 4:</strong> CGL can absorb auto accidents if needed.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Auto exposure follows business activity, not just vehicle ownership.
            If driving supports your operation, your company can be pulled into the claim.
            Commercial auto plus hired and non-owned structure protects that exposure.
          </blockquote>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Scenario-Specific Messaging</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>No fleet contractor:</strong> employee jobsite driving still creates employer liability.</li>
            <li><strong>Rental-heavy operations:</strong> hired-auto protection is needed when rental limits and terms are thin.</li>
            <li><strong>Personal-vehicle crews:</strong> non-owned auto is required because business-use denials are common.</li>
            <li><strong>Fast-growth contractors:</strong> written driving policy and coverage scope must scale with headcount.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Objection Handling</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Objection:</strong> We have never had a major auto claim. <strong>Response:</strong> Severity is unpredictable, and one event can exceed years of premium savings.</li>
            <li><strong>Objection:</strong> Employees carry personal insurance. <strong>Response:</strong> Business-use denials are common and employer lawsuits follow.</li>
            <li><strong>Objection:</strong> We can use CGL if needed. <strong>Response:</strong> CGL has auto exclusions that prevent that fallback strategy.</li>
          </ul>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor says, 'We do not own any vehicles, so auto liability is not an issue for us.' What is the best response?"
          options={[
            { key: 'A', label: 'Correct, ownership is the only trigger for business auto liability' },
            { key: 'B', label: 'Ownership is not the only trigger; business-use driving can still create employer liability' },
            { key: 'C', label: 'CGL coverage replaces commercial auto when no vehicles are titled to the company' },
          ]}
          correctKey="B"
          explanation="Employer exposure can arise from hired and non-owned driving activity tied to business operations, even without owned vehicles." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/6/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/6/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Proceed to Module Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
