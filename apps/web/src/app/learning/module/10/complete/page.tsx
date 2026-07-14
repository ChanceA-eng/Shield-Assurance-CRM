import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleTenCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 10 Complete">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14 text-center">
        <header className="space-y-4">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 10 Complete</span>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
            You Completed Commercial Auto Coverage for Contractors
          </h1>
          <p className="text-lg leading-relaxed text-slate-700">
            You finished Module 10 and practiced liability versus physical damage analysis, HNOA identification,
            symbol trigger validation, and endorsement strategy for contractor fleets.
          </p>
        </header>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Module Completion Badge - Commercial Auto Mastery]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-left">
          <h2 className="text-2xl font-bold text-slate-900">What You Demonstrated</h2>
          <ul className="mt-4 list-disc space-y-3 pl-5 text-base text-slate-700">
            <li>Explained auto liability versus physical damage in contractor language</li>
            <li>Identified HNOA risk pathways tied to non-owned and hired use</li>
            <li>Validated symbols and coverage triggers before placement assumptions</li>
            <li>Spotted endorsement gaps for trailers, rentals, and loaner scenarios</li>
            <li>Connected data trends to practical limit and structure coaching</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-8 text-left">
          <h2 className="text-2xl font-bold text-slate-900">Industry Context Recap</h2>
          <ul className="mt-4 list-disc space-y-3 pl-5 text-base text-slate-700">
            <li>AM Best and Marsh commentary continue to highlight severity and litigation pressure</li>
            <li>CCC data shows persistent repair and parts/labor inflation effects</li>
            <li>Verisk and Aon contractor insights underscore non-owned and trailer exposure realities</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-8 text-left">
          <h2 className="text-2xl font-bold text-slate-900">Next Step</h2>
          <p className="mt-3 leading-relaxed text-slate-700">
            Continue to Module 11 to deepen Workers Compensation strategy, including employee injury coverage,
            employer liability, experience mod impact, and subcontractor classification risk.
          </p>
        </section>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <a href="/learning/module/11" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Go to Module 11</a>
          <a href="/learning/course/contractor-insurance-fundamentals/overview" className="rounded-lg border border-slate-300 px-8 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
