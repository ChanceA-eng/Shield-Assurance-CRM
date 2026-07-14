import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleOneLessonThreePage(): JSX.Element {
  return (
    <SectionLayout title="Module 1 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 1</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: The Economic Loss Rule (Arizona Focus)</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            The Economic Loss Rule is one of the most important doctrines in contractor liability. It helps determine whether
            a contractor error is treated as tort exposure or contract exposure. If this is misclassified, coverage is misaligned and claims are denied.
          </p>
          <p className="leading-relaxed text-slate-700">
            Arizona applies a clear ELR framework. This lesson simplifies the doctrine, shows how courts apply it,
            and translates it into practical coverage decision-making.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What the Economic Loss Rule Says</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            The Economic Loss Rule generally prevents tort recovery for purely financial losses when the dispute is rooted in contract duties.
          </p>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            If the loss is financial and contract-based, tort recovery is usually barred unless separate physical damage to other property exists.
          </blockquote>
          <p className="mt-3 text-xs text-slate-500">Source: Flagstaff Affordable Housing Ltd. P'ship v. Design Alliance, Inc., 223 Ariz. 320.</p>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">The Other Property Requirement</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Arizona courts repeatedly focus on whether faulty work caused damage beyond the work itself. That boundary is often decisive
            when determining GL response versus E and O response.
          </p>

          <ul className="space-y-4 text-base text-slate-700">
            <li>
              <strong>If faulty work damages only itself:</strong>
              <br />
              This is primarily contractual lane. <strong>CGL denial risk is high; E and O is the key lane.</strong>
            </li>
            <li>
              <strong>If faulty work damages other property:</strong>
              <br />
              Tort exposure may exist. <strong>CGL Coverage A may respond.</strong>
            </li>
          </ul>

          <p className="mt-3 text-xs text-slate-500">Source: Sullivan v. Pulte Home Corp., 232 Ariz. 344 (App.).</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real Case Example: Flagstaff Affordable Housing</h2>

          <p className="mb-4 leading-relaxed text-slate-700">
            In Flagstaff Affordable Housing, alleged design failures produced economic losses. The Arizona Supreme Court held that where losses were
            contract-based and purely financial, tort recovery was barred.
          </p>
          <p className="leading-relaxed text-slate-700">
            This doctrine is a major reason contractors need E and O architecture for financial-loss scenarios that do not include separate physical damage.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Coverage Decision Matrix</h2>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-2 text-sm font-bold text-slate-700">Loss Type</th>
                <th className="py-2 text-sm font-bold text-slate-700">Description</th>
                <th className="py-2 text-sm font-bold text-slate-700">Insurance Response</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700">
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Physical Damage</td>
                <td>Faulty work damages other property</td>
                <td><strong>CGL Coverage A may respond</strong></td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Pure Economic Loss</td>
                <td>Delay, rework, lost revenue, diminished value</td>
                <td><strong>Contractors E and O responds</strong></td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Statutory Violation</td>
                <td>Fines, penalties, licensing issues</td>
                <td><strong>None (generally non-insurable)</strong></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Sources: ISO CG 00 01, IRMI construction defect analysis, Arizona ROC enforcement bulletins.</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning: The Blueprint Liability Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            If your crew misreads a blueprint and installs work off-spec, that is a contract-lane exposure. With no physical damage,
            GL may deny. My job is to ensure E and O is in place so a paper mistake does not become a six-figure balance-sheet loss.
          </blockquote>
          <p className="mt-4 leading-relaxed text-slate-700">
            This script converts legal doctrine into language contractors understand in under one minute.
          </p>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor installs a fire suppression system incorrectly. No fire occurs, but delays create major rental income loss. Which coverage lane is primary?"
          options={[
            { key: 'A', label: 'Commercial General Liability (Coverage A)' },
            { key: 'B', label: 'Contractors Professional Liability (E and O)' },
            { key: 'C', label: 'Umbrella / Excess Liability' },
          ]}
          correctKey="B"
          explanation="Under Arizona ELR doctrine, pure economic losses from contract-lane failures are generally outside tort recovery absent separate physical damage to other property. E and O is the primary response lane."
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <a href="/learning/module/1/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/1/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Go to Final Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
