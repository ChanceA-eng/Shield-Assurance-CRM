import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleSevenCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 7 Complete">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 7</span>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900">Module Complete: Property Coverage and Inland Marine</h1>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Module 7 Completion Badge - Property and Inland Marine Mastery]
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">What You Have Mastered</h2>
          <p className="leading-relaxed text-slate-700">
            You completed the property protection foundation for contractor operations. This module focused on direct loss risk,
            movement-based property exposure, and practical protection strategies for tools, equipment, and materials.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Property coverage fundamentals and where standard assumptions break</li>
            <li>Inland marine strategy for tools, equipment, and transit conditions</li>
            <li>Jobsite material and pre-installation exposure patterns</li>
            <li>Rented and borrowed equipment repayment risk awareness</li>
            <li>Field scripts for clear contractor property conversations</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-8 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Why This Matters in the Field</h2>
          <p className="leading-relaxed text-slate-700">
            Property losses are operational losses. When equipment or materials disappear, project execution slows,
            crews idle, and replacement cost compounds under tight schedule pressure.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Reduce downtime and emergency replacement spending</li>
            <li>Improve readiness for theft, weather, and transit incidents</li>
            <li>Strengthen contractor confidence with practical property planning</li>
            <li>Align coverage with how assets actually move and get used</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Next Step: Module 8</h2>
          <p className="leading-relaxed text-slate-700">
            Module 8 moves into Builder's Risk / Course of Construction,
            including project property exposure, delay impact, and construction-phase coverage structure.
          </p>
          <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
            [Image Placeholder: Module 8 Preview - Builder's Risk and Course of Construction]
          </div>
        </section>

        <div className="flex flex-col gap-4 pt-10 md:flex-row">
          <a href="/learning/module/8" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">Next Module</a>
          <a href="/learning/course/7c5e9732-66cf-4061-bbbf-73cc9b26819e/overview" className="rounded-lg border border-slate-300 px-10 py-4 text-lg font-semibold text-slate-900 transition-all hover:bg-slate-50">Return to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
