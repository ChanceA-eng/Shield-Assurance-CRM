import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleEightCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 8 Complete">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 8</span>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900">Module Complete: Builder's Risk / Course of Construction</h1>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Module 8 Completion Badge - Builder's Risk Mastery]
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">What You Have Mastered</h2>
          <p className="leading-relaxed text-slate-700">
            You completed the construction-phase project property framework and data-backed positioning model for Builder's Risk.
            This module covered physical loss drivers, coverage boundaries, delay impact, and endorsement planning.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Core Builder's Risk structure and contract responsibility allocation</li>
            <li>Covered property and covered-cause boundaries during construction</li>
            <li>Soft cost and delay-in-completion impact evaluation</li>
            <li>Endorsement strategy for project-specific catastrophe and testing exposures</li>
            <li>Field scripts using recognized market and loss-trend sources</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-8 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Why This Matters in the Field</h2>
          <p className="leading-relaxed text-slate-700">
            Project loss during construction is often a balance-sheet event, not only a claims event.
            Correct Builder's Risk design can preserve schedule, financing stability, and contractual relationships.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Reduce uninsured restart and reconstruction pressure</li>
            <li>Improve lender, owner, and GC confidence in risk planning</li>
            <li>Limit downstream dispute risk after major incidents</li>
            <li>Support more predictable project completion outcomes</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Next Step: Module 9</h2>
          <p className="leading-relaxed text-slate-700">
            Module 9 transitions to Business Owners Policy and Commercial Package Policy architecture,
            including line integration, form coordination, and portfolio-level contractor program design.
          </p>
          <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
            [Image Placeholder: Module 9 Preview - BOP and CPP Structure]
          </div>
        </section>

        <div className="flex flex-col gap-4 pt-10 md:flex-row">
          <a href="/learning/module/9" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">Next Module</a>
          <a href="/learning/course/7c5e9732-66cf-4061-bbbf-73cc9b26819e/overview" className="rounded-lg border border-slate-300 px-10 py-4 text-lg font-semibold text-slate-900 transition-all hover:bg-slate-50">Return to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
