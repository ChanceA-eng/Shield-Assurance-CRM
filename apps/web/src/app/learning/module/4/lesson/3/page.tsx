import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleFourLessonThreePage(): JSX.Element {
  return (
    <SectionLayout title="Module 4 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 4</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: Primary and Noncontributory plus Waiver of Subrogation</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Additional Insured status alone does not complete risk transfer. Primary and noncontributory wording and waiver of subrogation
            are required to prevent upstream insurance contribution and post-payment recovery litigation.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains how these endorsements function and why they are required in serious construction contract programs.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Primary and Noncontributory plus Waiver Flowchart]
        </div>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Primary and Noncontributory</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            P and N wording is used to keep upstream insurance from sharing claim cost when downstream operations cause the loss.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Downstream policy is intended to respond first.</li>
            <li>Upstream policy contribution is limited or prevented by wording and contract alignment.</li>
            <li>Deductible and loss-history protection improves for upstream parties when transfer is implemented correctly.</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Source concept: ISO primary and noncontributory endorsement family.</p>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Waiver of Subrogation Recovery Block Diagram]
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Waiver of Subrogation</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Waiver of subrogation is used to restrict downstream insurer recovery actions against designated upstream parties after claim payment.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Without waiver, an insurer may pursue upstream recovery litigation.</li>
            <li>With waiver, post-payment lawsuits are limited in accordance with endorsement terms.</li>
            <li>Waiver supports full-cycle risk transfer and contract stability.</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Source concept: ISO waiver of transfer of rights endorsement family.</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Outcome Patterns</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>No P and N:</strong> upstream insurer may be drawn into contribution demand.</li>
            <li><strong>No waiver:</strong> downstream insurer may sue upstream party after payment.</li>
            <li><strong>Full package in place:</strong> downstream insurance responds, upstream insurance remains protected, litigation risk reduces.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Additional Insured gives you access. Primary and noncontributory keeps your insurance out.
            Waiver of subrogation keeps their insurer from suing you later.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A subcontractor insurer pays a loss, then sues the GC to recover claim costs. Which endorsement was most likely missing?"
          options={[
            { key: 'A', label: 'Primary and noncontributory' },
            { key: 'B', label: 'Waiver of subrogation' },
            { key: 'C', label: 'CG 20 10 only' },
          ]}
          correctKey="B"
          explanation="Waiver of subrogation is designed to restrict downstream insurer recovery actions against specified upstream parties after claim payment." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/4/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/4/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
