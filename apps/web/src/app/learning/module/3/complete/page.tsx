import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleThreeCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 3 Complete">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 3</span>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900">Module Complete: Contractors Professional Liability (E and O)</h1>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Module 3 Completion Badge - E and O Mastery]
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">What You Have Mastered</h2>
          <p className="leading-relaxed text-slate-700">
            You now understand the most misunderstood contractor coverage gap: where CGL ends and E and O begins.
            You can identify professional-liability exposures and explain them in language contractors understand.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Why contractors need E and O for economic-loss and professional-error exposures</li>
            <li>E and O trigger patterns versus CGL occurrence patterns</li>
            <li>Coverage-gap analysis for faulty workmanship without resulting damage</li>
            <li>Professional services exposures across contractor trades</li>
            <li>Field-ready scripts and objection handling for client conversations</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-8 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Why This Matters in the Field</h2>
          <p className="leading-relaxed text-slate-700">
            Many contractor disputes involve economic loss and performance-based errors with no qualifying physical damage pattern.
            This is where CGL limitations appear and E and O architecture becomes essential.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Identify E and O exposures early in account review</li>
            <li>Explain CGL limits with confidence and precision</li>
            <li>Position E and O as essential risk financing, not optional add-on coverage</li>
            <li>Use practical scripts to improve contractor buy-in and retention</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Next Step: Module 4</h2>
          <p className="leading-relaxed text-slate-700">
            Module 4 focuses on risk transfer and Additional Insured implementation, translating policy knowledge into contractual execution.
          </p>
          <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
            [Image Placeholder: Module 4 Preview - Risk Transfer and Additional Insureds]
          </div>
        </section>

        <div className="flex flex-col gap-4 pt-10 md:flex-row">
          <a href="/learning/module/4" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">Next Module</a>
          <a href="/learning/course/7c5e9732-66cf-4061-bbbf-73cc9b26819e/overview" className="rounded-lg border border-slate-300 px-10 py-4 text-lg font-semibold text-slate-900 transition-all hover:bg-slate-50">Return to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
