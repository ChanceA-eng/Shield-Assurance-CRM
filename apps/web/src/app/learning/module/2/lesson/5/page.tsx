import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleTwoLessonFivePage(): JSX.Element {
  return (
    <SectionLayout title="Module 2 - Lesson 5">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 2</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 5: Additional Insured Endorsements</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Additional Insured endorsements extend the subcontractor's liability coverage to upstream parties such as general contractors
            and owners. They are core tools in contractual risk transfer.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains ongoing versus completed operations AI forms, primary and noncontributory wording, and waiver of subrogation.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What AI Endorsements Do</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            AI wording gives another party access to the contractor's liability limits for claims arising out of that contractor's work.
          </p>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            If your subcontractor causes the loss, you want their insurance to respond first.
          </blockquote>
          <p className="mt-4 text-xs text-slate-500">Source: ISO CG 20 10 and CG 20 37.</p>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Ongoing vs Completed Operations</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>CG 20 10:</strong> ongoing operations while work is in progress.</li>
            <li><strong>CG 20 37:</strong> completed operations after work is finished.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            Many contracts require both. Issuing only ongoing operations language can leave the upstream party exposed after completion.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Primary and Noncontributory</h2>
          <p className="leading-relaxed text-slate-700">
            Contract language often requires the subcontractor policy to respond first and not seek contribution from the upstream party's policy.
            This preserves the intended risk-transfer structure.
          </p>
          <p className="mt-2 text-xs text-slate-500">Source: ISO CG 20 01.</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Waiver of Subrogation</h2>
          <p className="leading-relaxed text-slate-700">
            A waiver of subrogation prevents an insurer from suing certain project parties after paying a loss. This helps avoid circular litigation.
          </p>
          <p className="mt-2 text-xs text-slate-500">Source: ISO CG 24 04.</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Example</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            A subcontractor's wiring fails after completion and causes a fire. The owner sues the general contractor.
          </p>
          <p className="leading-relaxed text-slate-700">
            If AI completed operations coverage is in place, the subcontractor policy may defend and indemnify the upstream party.
            If it is missing, the general contractor's policy is more likely to absorb the loss.
          </p>
        </section>

        <InteractiveKnowledgeCheck
          question="A subcontractor names a GC as Additional Insured under CG 20 10 only. Six months after completion, the subcontractor's work fails and causes property damage. Which is correct?"
          options={[
            { key: 'A', label: 'The GC is covered because CG 20 10 applies to all operations.' },
            { key: 'B', label: 'The GC is not covered for completed operations without CG 20 37.' },
            { key: 'C', label: 'Coverage depends only on whether E and O exists.' },
          ]}
          correctKey="B"
          explanation="CG 20 10 is ongoing operations wording. Completed operations AI exposure is typically addressed with CG 20 37 or equivalent completed-ops language."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/2/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/2/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Go to Final Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
