import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleTwoLessonFourPage(): JSX.Element {
  return (
    <SectionLayout title="Module 2 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 2</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Business-Risk Exclusions</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Business-risk exclusions are one of the most misunderstood parts of the CGL form. They prevent liability insurance from acting
            as a warranty for the contractor's own work quality.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson breaks down the key exclusions in plain language and explains how they interact with resulting damage analysis.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core Principle</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Insurance is designed for accidents, not quality-control costs. Exclusions draw a line between self-inflicted business cost and
            covered third-party harm.
          </p>
          <ul className="space-y-3 list-disc pl-4 text-base text-slate-700">
            <li><strong>Faulty work itself:</strong> typically not covered.</li>
            <li><strong>Damage caused by faulty work:</strong> may be covered if it reaches other property.</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Source: ISO CG 00 01, Section I exclusions.</p>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Key Exclusions to Know</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li>
              <strong>Damage to Your Work:</strong> excludes repair and replacement of the insured's own defective work.
              <span className="block text-xs text-slate-500">ISO CG 00 01, Exclusion L.</span>
            </li>
            <li>
              <strong>Damage to Your Product:</strong> excludes damage to the insured's own product.
              <span className="block text-xs text-slate-500">ISO CG 00 01, Exclusion K.</span>
            </li>
            <li>
              <strong>Damage to Impaired Property:</strong> excludes many loss-of-use claims without physical injury.
              <span className="block text-xs text-slate-500">ISO CG 00 01, Exclusion M.</span>
            </li>
            <li>
              <strong>Recall Exclusion:</strong> excludes product recall and withdrawal expense.
              <span className="block text-xs text-slate-500">ISO CG 00 01, Exclusion N.</span>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Examples</h2>
          <ul className="space-y-5 text-base text-slate-700">
            <li><strong>Siding replacement only:</strong> excluded as damage to your work.</li>
            <li><strong>Siding defect causes interior damage:</strong> resulting damage may trigger coverage.</li>
            <li><strong>Defective product fails with no collateral damage:</strong> product-only damage is excluded.</li>
            <li><strong>Faulty wiring causes fire to structure:</strong> other-property damage may be covered.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning: Warranty vs Insurance</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Insurance covers accidents, not the cost of redoing poor workmanship. If faulty work damages other property, that may be an insurance claim.
            If it only damages itself, that is usually a warranty-quality issue.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor installs windows incorrectly. The windows leak and damage interior drywall. Which coverage lane is most accurate?"
          options={[
            { key: 'A', label: 'Excluded - Damage to Your Work' },
            { key: 'B', label: 'Coverage A - Resulting Damage' },
            { key: 'C', label: 'Contractors E and O only' },
          ]}
          correctKey="B"
          explanation="The defective installation caused damage to other property (interior drywall). That resulting damage pattern may trigger Coverage A despite business-risk exclusions on the work itself."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/2/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/2/lesson/5" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
