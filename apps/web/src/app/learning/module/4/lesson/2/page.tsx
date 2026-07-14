import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleFourLessonTwoPage(): JSX.Element {
  return (
    <SectionLayout title="Module 4 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 4</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: Additional Insured Endorsements (Deep Dive)</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Additional Insured endorsements are the mechanism that converts contractual transfer language into insurance-funded performance.
            Contracts may shift liability, but AI endorsements determine whether upstream parties can access downstream coverage.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson covers CG 20 10, CG 20 37, and how AI wording functions in real claims and tender scenarios.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Additional Insured Flow - Subcontractor to GC to Owner]
        </div>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What AI Endorsements Do</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            AI endorsements extend insured status to designated upstream parties for liability arising out of the named insured's work.
          </p>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            If a subcontractor causes a covered loss, upstream parties should be able to access subcontractor insurance first.
          </blockquote>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core ISO Endorsement Pair</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li>
              <strong>CG 20 10:</strong> ongoing operations AI status while work is being performed.
              <span className="block text-xs text-slate-500">ISO Additional Insured ongoing operations form family.</span>
            </li>
            <li>
              <strong>CG 20 37:</strong> completed operations AI status for post-completion losses.
              <span className="block text-xs text-slate-500">ISO Additional Insured completed operations form family.</span>
            </li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            Most contracts require both. Issuing only ongoing operations wording can leave upstream parties exposed after handoff.
          </p>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Ongoing vs Completed Operations Coverage Timeline]
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">How AI Coverage Operates in Claims</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            AI language often hinges on whether the alleged loss arises out of the subcontractor work scope.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Upstream parties may receive defense and indemnity access tied to downstream work causation.</li>
            <li>Tender success depends on wording, timing, and relationship to the subcontractor operations.</li>
            <li>Completed operations allegations generally require completed-ops AI language.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Primary and Noncontributory plus Waiver</h2>
          <p className="leading-relaxed text-slate-700">
            AI status is necessary but not sufficient. P and N and waiver wording are often required to protect upstream insurance position
            and prevent recovery actions after claim payment.
          </p>
        </section>

        <InteractiveKnowledgeCheck
          question="A roofing subcontractor finishes work, and six months later water intrusion causes interior damage. The owner sues the GC. Which AI endorsement is most critical for the GC?"
          options={[
            { key: 'A', label: 'CG 20 10 ongoing operations only' },
            { key: 'B', label: 'CG 20 37 completed operations' },
            { key: 'C', label: 'Waiver of subrogation only' },
          ]}
          correctKey="B"
          explanation="The allegation arises after completion, so completed operations AI wording is essential. CG 20 37 addresses that timing pattern." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/4/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/4/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
