import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleFiveLessonThreePage(): JSX.Element {
  return (
    <SectionLayout title="Module 5 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 5</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: Subcontractor Labor, 1099s, and Statutory Penalties</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Many contractors assume 1099 classification avoids workers compensation obligations. In practice, state tests control classification,
            and misclassification can trigger retroactive premium, penalties, and uninsured injury liability.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson focuses on labor-chain risk: uninsured subs, labor brokers, and how claim responsibility can flow upstream fast.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: 1099 Misclassification and Upstream Liability Flow]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">1099 Does Not Override Statute</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Tax forms do not decide workers compensation status. Regulators evaluate control, direction, economic dependence,
            and operational integration to determine whether a worker is effectively an employee.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Uniforms, scheduling control, and tool requirements can support employee-like status.</li>
            <li>Single-source income dependence can support employee-like status.</li>
            <li>Routine integration into contractor workflow can support employee-like status.</li>
          </ul>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Uninsured Subcontractor Injury Chain]
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Uninsured Subcontractor Exposure</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            If downstream labor has no workers compensation in force, injured worker costs can push upstream under statutory or contractual pressure.
          </p>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Immediate injury cost pressure:</strong> medical and wage obligations can surface fast.</li>
            <li><strong>Audit and premium effects:</strong> uninsured labor can produce adverse audit outcomes.</li>
            <li><strong>Project disruption:</strong> enforcement actions can halt operations and trigger breach concerns.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Common Penalty Patterns</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Stop-work orders:</strong> mandatory suspension until compliance is restored.</li>
            <li><strong>Civil monetary penalties:</strong> assessed for noncompliant periods or uninsured payroll.</li>
            <li><strong>Retroactive premium and assessments:</strong> back-calculated costs after audit findings.</li>
            <li><strong>Contract and licensing impact:</strong> disqualification risk on upstream projects.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Calling labor a 1099 does not remove workers compensation obligations. If state tests treat that person as an employee,
            your company can absorb injury costs, penalties, and enforcement action.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor hires uninsured 1099 labor. A worker is seriously injured and regulators classify the worker as an employee. What is the primary risk outcome?"
          options={[
            { key: 'A', label: 'CGL automatically takes over all benefits and penalties' },
            { key: 'B', label: 'No impact because a 1099 form was signed' },
            { key: 'C', label: 'Workers compensation and penalty exposure can shift to the hiring contractor' },
          ]}
          correctKey="C"
          explanation="State classification controls. If labor is treated as employee status, workers compensation obligations and statutory penalties can move directly to the hiring contractor." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/5/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/5/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
