import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleTwoLessonOnePage(): JSX.Element {
  return (
    <SectionLayout title="Module 2 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 2</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: Coverage A - Bodily Injury and Property Damage</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Coverage A is the core of the Commercial General Liability policy. It protects contractors when operations cause bodily injury
            or property damage to others. This lesson explains what Coverage A covers, how occurrence is interpreted, and how exclusions
            shape coverage for faulty work.
          </p>
          <p className="leading-relaxed text-slate-700">
            By the end of this lesson, you will understand the Coverage A trigger, the definition of occurrence, and the resulting damage
            distinction that drives many claim outcomes.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Coverage A Covers</h2>

          <p className="mb-4 leading-relaxed text-slate-700">
            Coverage A applies when the insured is legally obligated to pay damages because of bodily injury or property damage caused by an occurrence.
          </p>

          <ul className="space-y-4 text-base text-slate-700">
            <li>
              <strong>Bodily Injury:</strong> Physical harm, sickness, or disease.
              <span className="block text-xs text-slate-500">Source: ISO CG 00 01, Section V Definitions.</span>
            </li>
            <li>
              <strong>Property Damage:</strong> Physical injury to tangible property or loss of use.
              <span className="block text-xs text-slate-500">Source: ISO CG 00 01, Section V Definitions.</span>
            </li>
            <li>
              <strong>Occurrence:</strong> An accident, including continuous or repeated exposure to substantially the same harmful conditions.
              <span className="block text-xs text-slate-500">Source: ISO CG 00 01, Section V Definitions.</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Understanding Occurrence</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Coverage A responds to accidental losses. Intentional acts are outside the coverage grant. Faulty work itself is usually not covered,
            but faulty work that causes damage to other property can trigger coverage.
          </p>
          <p className="text-xs text-slate-500">Source: IRMI construction defect analysis and ISO CG 00 01 wording.</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Resulting Damage Under Coverage A</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Coverage A may apply when faulty work causes damage to property other than the faulty work itself.
          </p>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-2 text-sm font-bold text-slate-700">Scenario</th>
                <th className="py-2 text-sm font-bold text-slate-700">Outcome</th>
                <th className="py-2 text-sm font-bold text-slate-700">Coverage</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700">
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Faulty plumbing causes water damage to drywall</td>
                <td>Resulting damage</td>
                <td><strong>CGL Coverage A may respond</strong></td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Faulty plumbing discovered before any collateral damage occurs</td>
                <td>No resulting damage</td>
                <td><strong>CGL denial risk is high; E and O lane applies</strong></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Business-Risk Exclusions</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            These exclusions prevent the policy from functioning as a warranty for the contractor's own work quality.
          </p>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Damage to Your Work:</strong> excludes replacement of the insured's own defective work.</li>
            <li><strong>Damage to Your Product:</strong> excludes damage to the insured's own product.</li>
            <li><strong>Damage to Impaired Property:</strong> excludes many pure loss-of-use scenarios without physical damage.</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Source: ISO CG 00 01, Section I Exclusions.</p>
        </section>

        <InteractiveKnowledgeCheck
          question="A plumber installs a pipe incorrectly. The pipe bursts and damages the homeowner's hardwood floors. Which coverage applies?"
          options={[
            { key: 'A', label: 'CGL Coverage A' },
            { key: 'B', label: 'Contractors E and O' },
            { key: 'C', label: 'No coverage applies' },
          ]}
          correctKey="A"
          explanation="Faulty workmanship that causes damage to other property is resulting damage. Under ISO CG 00 01, resulting damage may trigger Coverage A."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/2/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
