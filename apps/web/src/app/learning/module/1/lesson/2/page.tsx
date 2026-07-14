import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleOneLessonTwoPage(): JSX.Element {
  return (
    <SectionLayout title="Module 1 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 1</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: Physical vs Economic vs Contractual Loss</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Contractors face three fundamentally different loss types: physical, economic, and contractual.
            Coverage response depends on this classification. If the loss type is misread, coverage is misaligned and denial risk increases.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson simplifies how each loss behaves, how carriers evaluate it, and how to match each lane to the correct insurance asset.
            The framework aligns with ISO wording, Arizona legal doctrine, and common construction risk practice.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Key Loss Types</h2>

          <ul className="space-y-6 text-base text-slate-700">
            <li>
              <strong>Physical Loss</strong>
              <br />
              Damage to tangible property or bodily injury. This is the core trigger lane for CGL Coverage A.
              <span className="block text-xs text-slate-500">Source: ISO CG 00 01, Section I, Coverage A.</span>
            </li>
            <li>
              <strong>Economic Loss</strong>
              <br />
              Financial harm without physical damage, such as delay, rework cost, and lost revenue.
              Under ELR analysis, this lane usually cannot be recovered in tort absent separate physical injury.
              <span className="block text-xs text-slate-500">Source: Flagstaff Affordable Housing v. Design Alliance.</span>
            </li>
            <li>
              <strong>Contractual Loss</strong>
              <br />
              Losses from failure to meet specifications, schedule, or warranty obligations.
              <span className="block text-xs text-slate-500">Source: ARS Title 47 (Uniform Commercial Code).</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">The Resulting Damage Rule</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            A core distinction in contractor coverage analysis is whether faulty work damages property other than the faulty work itself.
            That is the resulting damage threshold.
          </p>
          <p className="mb-6 leading-relaxed text-slate-700">
            If faulty work causes resulting damage, CGL may respond. If faulty work only affects the work itself, CGL denial risk is high.
          </p>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-2 text-sm font-bold text-slate-700">Scenario</th>
                <th className="py-2 text-sm font-bold text-slate-700">Outcome</th>
                <th className="py-2 text-sm font-bold text-slate-700">Insurance</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700">
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Faulty flashing causes water intrusion into drywall</td>
                <td>Resulting damage</td>
                <td><strong>CGL Coverage A may respond</strong></td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Faulty flashing discovered before rain; no collateral damage occurs</td>
                <td>No resulting damage</td>
                <td><strong>CGL often denies; E and O lane becomes critical</strong></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Source: ISO CG 00 01 damage to your work exclusion analysis and IRMI construction defect guidance.</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Examples</h2>

          <ul className="space-y-6 text-base text-slate-700">
            <li>
              <strong>Physical Loss Example:</strong>
              <br />
              A roofer drops material onto a client vehicle. Physical property damage exists. <strong>CGL responds.</strong>
            </li>
            <li>
              <strong>Economic Loss Example:</strong>
              <br />
              A slab is poured incorrectly and occupancy is delayed. No physical injury exists. <strong>CGL denial risk is high; E and O lane applies.</strong>
            </li>
            <li>
              <strong>Contractual Loss Example:</strong>
              <br />
              A framing wall is out of plumb and must be rebuilt to meet specification. <strong>Contractual lane controls.</strong>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning: The Three Buckets Drill</h2>

          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Every loss your company faces falls into one of three buckets: physical, economic, or contractual.
            If it is physical, GL may respond. If it is economic or contractual, GL may deny and E and O becomes essential.
            My job is to make sure your program protects all three buckets.
          </blockquote>

          <p className="mt-4 leading-relaxed text-slate-700">
            This drill is simple, memorable, and operationally useful in prospect meetings.
          </p>
        </section>

        <InteractiveKnowledgeCheck
          question="A subcontractor installs flooring incorrectly. The flooring must be torn out and replaced, but no other property is damaged. What type of loss is this?"
          options={[
            { key: 'A', label: 'Physical Loss' },
            { key: 'B', label: 'Economic Loss' },
            { key: 'C', label: 'Contractual Loss' },
          ]}
          correctKey="C"
          explanation="Faulty workmanship damaging only the work itself is commonly treated as business-risk or contractual lane. This is why contractors need E and O support alongside GL architecture."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/1/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/1/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
