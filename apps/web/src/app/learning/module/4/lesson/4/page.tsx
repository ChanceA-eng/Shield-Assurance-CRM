import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleFourLessonFourPage(): JSX.Element {
  return (
    <SectionLayout title="Module 4 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 4</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Field Positioning and Contract Review</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Contractors often sign transfer-heavy agreements without understanding the insurance obligations they create.
            This lesson provides a practical contract-review method and field scripts to explain required endorsements clearly.
          </p>
          <p className="leading-relaxed text-slate-700">
            The objective is simple: identify risk transfer language quickly and prevent uninsured contractual exposure before work starts.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Contract Review Key Clauses Highlighted]
        </div>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Five Clauses to Review Every Time</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Indemnification:</strong> who defends and who pays for losses.</li>
            <li><strong>Insurance requirements:</strong> limits, forms, and evidence requirements.</li>
            <li><strong>Additional Insured language:</strong> ongoing and completed operations expectations.</li>
            <li><strong>Primary and noncontributory language:</strong> order of response requirements.</li>
            <li><strong>Waiver of subrogation:</strong> post-payment litigation controls.</li>
          </ul>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Indemnification Clause Example]
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Indemnification Clause Breakdown</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Subcontractor shall indemnify, defend, and hold harmless upstream parties for claims arising from subcontractor work.
          </blockquote>
          <ul className="mt-4 list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Indemnify:</strong> reimburse losses.</li>
            <li><strong>Defend:</strong> provide legal defense.</li>
            <li><strong>Hold harmless:</strong> shield upstream party from liability impact.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            Insurance endorsements must align with this clause or the transfer fails in practice.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Scripts for Contractor Meetings</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>Liability follows the work:</strong> downstream-caused loss should be funded by downstream insurance.</li>
            <li><strong>Your insurance should not be first:</strong> use P and N to keep upstream policy from contributing first.</li>
            <li><strong>No lawsuits after payment:</strong> waiver wording helps block downstream insurer recovery actions.</li>
            <li><strong>Compliance before start date:</strong> missing endorsements equal immediate contractual exposure.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Contract Review Example</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            If a contract requires AI for ongoing and completed operations, primary and noncontributory wording, and waiver of subrogation,
            then the endorsement package must include corresponding AI and transfer-support forms to satisfy obligations.
          </p>
        </section>

        <InteractiveKnowledgeCheck
          question="A contract requires AI status for ongoing and completed operations. Which form is required for completed operations AI?"
          options={[
            { key: 'A', label: 'CG 20 10' },
            { key: 'B', label: 'CG 20 37' },
            { key: 'C', label: 'CG 24 04' },
          ]}
          correctKey="B"
          explanation="CG 20 37 is the completed operations AI form in the common ISO structure, while CG 20 10 addresses ongoing operations." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/4/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/4/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Proceed to Module Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
