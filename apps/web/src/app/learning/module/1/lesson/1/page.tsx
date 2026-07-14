import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleOneLessonOnePage(): JSX.Element {
  return (
    <SectionLayout title="Module 1 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 1</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: The Legal Landscape Contractors Operate In</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Every construction loss begins in one of three legal systems: Tort, Contract, or Statutory.
            These systems determine whether a contractor is covered, partially covered, or completely exposed.
            According to IRMI construction risk reporting, many contractor claim denials occur because the legal origin of the loss was classified incorrectly.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson gives you a clear foundation. Once you identify the legal lane correctly, you can match it to the right insurance asset
            and prevent the denials that generalist placements routinely create.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Key Terms for This Lesson</h2>
          <p className="mb-4 text-slate-700">These definitions reflect current industry standards and core legal doctrine.</p>

          <ul className="space-y-4 text-base text-slate-700">
            <li>
              <strong>CGL (Commercial General Liability): </strong>
              Covers bodily injury and property damage caused by an occurrence, as defined in ISO CG 00 01.
              It is not a performance bond and not designed to repair faulty work itself.
              <span className="block text-xs text-slate-500">Source: ISO Commercial Lines Manual.</span>
            </li>
            <li>
              <strong>Economic Loss Rule (ELR): </strong>
              A doctrine that limits tort recovery for purely financial losses arising from contract breaches.
              In Arizona, ELR analysis follows Flagstaff Affordable Housing Ltd. P'ship v. Design Alliance, Inc.
              <span className="block text-xs text-slate-500">Source: Arizona Supreme Court.</span>
            </li>
            <li>
              <strong>Tort Law: </strong>
              Civil liability for negligence causing physical injury or property damage.
              <span className="block text-xs text-slate-500">Source: Restatement (Second) of Torts section 281.</span>
            </li>
            <li>
              <strong>Contract Law: </strong>
              Liability arising from failure to meet specifications, schedules, or warranties.
              <span className="block text-xs text-slate-500">Source: ARS Title 47 (Uniform Commercial Code).</span>
            </li>
            <li>
              <strong>Statutory Law: </strong>
              Liability driven by code, licensing, or administrative violations.
              <span className="block text-xs text-slate-500">Source: Arizona Registrar of Contractors enforcement bulletins.</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">The Tripartite Framework</h2>

          <p className="mb-6 leading-relaxed text-slate-700">
            Every construction dispute falls into one of these three lanes. Once the lane is identified, the insurance response becomes much clearer.
          </p>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-2 text-sm font-bold text-slate-700">Legal Pathway</th>
                <th className="py-2 text-sm font-bold text-slate-700">Trigger</th>
                <th className="py-2 text-sm font-bold text-slate-700">Example</th>
                <th className="py-2 text-sm font-bold text-slate-700">Insurance</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700">
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Tort Law</td>
                <td>Negligence causing physical damage</td>
                <td>
                  Worker drops a beam onto a delivery truck.
                  <br />
                  <span className="text-xs text-slate-500">Source: IRMI construction case studies.</span>
                </td>
                <td><strong>CGL Coverage A</strong></td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Contract Law</td>
                <td>Failure to meet specifications</td>
                <td>
                  Wall built off-center causing delay and rework.
                  <br />
                  <span className="text-xs text-slate-500">Source: AGC construction claims research.</span>
                </td>
                <td><strong>Contractors E and O</strong></td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Statutory Law</td>
                <td>Code or administrative violation</td>
                <td>
                  Digging without required utility marking permits.
                  <br />
                  <span className="text-xs text-slate-500">Source: Arizona ROC enforcement bulletins.</span>
                </td>
                <td><strong>None (fines are generally non-insurable)</strong></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning: The Hammer vs Blueprint Drill</h2>

          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            If your guy drops a hammer and smashes tile, GL usually responds. If your crew misreads a blueprint and installs off-spec,
            GL may deny. My job is to protect your balance sheet from the mistakes that do not break windows but can break your business.
          </blockquote>

          <p className="mt-4 leading-relaxed text-slate-700">
            This drill gives contractors a plain-language understanding of why legal origin matters before certificates, limits, or endorsements are discussed.
          </p>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor pours a slab incorrectly due to blueprint misinterpretation. No physical damage occurs, and the developer loses revenue. Which coverage is the primary response asset?"
          options={[
            { key: 'A', label: 'Commercial General Liability (Coverage A)' },
            { key: 'B', label: 'Contractors Professional Liability (E and O)' },
            { key: 'C', label: 'Umbrella / Excess Liability' },
          ]}
          correctKey="B"
          explanation="Under Arizona ELR analysis, pure financial losses from contract-based performance failures generally stay outside tort recovery unless separate physical injury is present. Without physical damage, GL denial risk is high and E and O is the more appropriate primary lane."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/1/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
