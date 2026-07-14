import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleTwoLessonThreePage(): JSX.Element {
  return (
    <SectionLayout title="Module 2 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 2</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: Completed Operations</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Completed operations coverage addresses losses that occur after work is finished and turned over. If defective work later causes
            bodily injury or property damage, the completed operations portion of the CGL form may respond.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains what completed operations means, how coverage is triggered, and how business-risk exclusions still shape outcomes.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Completed Operations Means</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            This hazard applies to bodily injury or property damage occurring after the contractor's work is completed.
          </p>
          <ul className="space-y-4 text-base text-slate-700">
            <li>
              Work is considered complete when finished and accepted by the customer.
              <span className="block text-xs text-slate-500">Source: ISO CG 00 01, products-completed operations hazard definition.</span>
            </li>
            <li>The injury or damage must occur after completion.</li>
            <li>Faulty work itself is not covered, but resulting damage may be.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">How Coverage Is Triggered</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>The contractor's scope is complete.</li>
            <li>A defect causes bodily injury or property damage.</li>
            <li>The injury or damage arises after completion.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            If damage is only to the contractor's work itself, claim denial risk is high. If other property is damaged, Coverage A under
            completed operations may respond.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Business-Risk Exclusions Still Apply</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Completed operations does not erase business-risk exclusions. These exclusions maintain the line between warranty and insurance.
          </p>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Damage to Your Work:</strong> replacement of defective work itself is excluded.</li>
            <li><strong>Damage to Your Product:</strong> product-only damage is excluded.</li>
            <li><strong>Impaired Property:</strong> loss of use without physical damage is often excluded.</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Source: ISO CG 00 01, Section I exclusions.</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Examples</h2>
          <ul className="space-y-5 text-base text-slate-700">
            <li><strong>Balcony failure after handoff:</strong> injury occurs months later; completed operations may respond.</li>
            <li><strong>Roof defect after completion:</strong> water damages interior drywall; resulting damage may be covered.</li>
            <li><strong>Flooring fails with no collateral damage:</strong> no resulting damage; denial risk is high.</li>
          </ul>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor installs exterior stucco. Six months later, water intrusion damages interior framing. Which coverage applies?"
          options={[
            { key: 'A', label: 'Coverage A - Completed Operations' },
            { key: 'B', label: 'Contractors E and O' },
            { key: 'C', label: 'No coverage applies' },
          ]}
          correctKey="A"
          explanation="The work was completed and the defect caused resulting damage to other property. That pattern can trigger Coverage A under completed operations analysis."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/2/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/2/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
