import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleTenOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 10 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 10</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Commercial Auto Coverage for Contractors
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Commercial Auto is one of the most critical and most loss-heavy lines for contractors. It covers
            liability, physical damage, hired and non-owned auto, symbols, endorsements, and fleet exposures.
            This module explains how coverage works and how insurers evaluate auto risk using market trends.
          </p>
          <p className="leading-relaxed text-slate-600">
            You will learn how liability differs from physical damage, how symbols trigger coverage,
            how HNOA closes hidden gaps, and how endorsements protect trailers, rentals, and loaners.
          </p>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Commercial Auto Coverage Diagram - Liability to Physical Damage to HNOA to Symbols]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Auto Liability:</strong> Coverage for third-party bodily injury and property damage from business auto use.</li>
            <li><strong>Physical Damage:</strong> Coverage for damage to covered autos, including collision and comprehensive causes.</li>
            <li><strong>HNOA:</strong> Hired and non-owned auto liability exposure from rentals, borrowed units, and employee-owned vehicles.</li>
            <li><strong>Auto Symbols:</strong> Numeric coverage triggers that determine which vehicles are covered by line.</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Why Commercial Auto Matters</h2>
          <p className="leading-relaxed text-slate-700">
            Contractors rely on trucks, vans, trailers, service vehicles, and employee-owned vehicles used for business.
            Losses are frequent and severe. Verisk commercial auto commentary highlights persistent inflationary pressure,
            rising repair costs, and elevated litigation severity in contractor-heavy classes.
          </p>
          <p className="leading-relaxed text-slate-700">Commercial Auto protects contractors from:</p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Bodily injury and property damage liability</li>
            <li>Collision and comprehensive damage to owned vehicles</li>
            <li>Employee-owned vehicle exposures through HNOA</li>
            <li>Trailer and equipment transport exposures</li>
            <li>Uninsured and underinsured motorist exposures</li>
            <li>Rental and borrowed vehicle liability exposures</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Data and Industry Research</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>AM Best: commercial auto claim severity pressure remains elevated in recent cycles</li>
            <li>CCC Intelligent Solutions: repair cost inflation remains a key premium and claim driver</li>
            <li>Marsh U.S. Casualty reporting: nuclear verdict exposure continues to influence terms</li>
            <li>Verisk: contractor classes show above-average frequency in multiple commercial auto segments</li>
            <li>Aon: non-owned vehicle use remains a leading hidden source of liability exposure</li>
          </ul>
          <p className="leading-relaxed text-slate-700">
            These trends explain why Commercial Auto is one of the most expensive and tightly underwritten lines
            in contractor programs.
          </p>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains four lessons that build practical advising skill for contractor auto placement.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Auto liability and physical damage coverage fundamentals.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Hired and non-owned auto exposures for contractor operations.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Auto symbols and coverage triggers, including Symbols 1, 7, 8, and 9.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Endorsements, trailers, rentals, loaners, and contractor-specific gaps.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            Many contractors underestimate Commercial Auto exposure, especially when personal auto, rentals,
            and trailer coverage intersect. The coaching focus is fit, triggers, and endorsement clarity.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Explain liability versus physical damage in plain language</li>
            <li>Identify HNOA exposures before quoting</li>
            <li>Validate symbols line-by-line to prevent trigger failures</li>
            <li>Spot endorsement gaps for trailers, rentals, and loaners</li>
            <li>Position limits with real severity and litigation context</li>
          </ul>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/10/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
