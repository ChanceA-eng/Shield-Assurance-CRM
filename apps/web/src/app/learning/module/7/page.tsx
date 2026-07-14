import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleSevenOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 7 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 7</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Property Coverage and Inland Marine
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Property coverage protects the physical assets that keep contractor operations moving: tools, equipment,
            materials, and jobsite property. Unlike liability coverage, this module focuses on direct loss to what the
            business owns, transports, stores, or borrows.
          </p>
          <p className="leading-relaxed text-slate-600">
            Inland marine is often the deciding factor between a manageable claim and project shutdown after theft,
            weather, vandalism, or transit loss.
          </p>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Property and Inland Marine Coverage Diagram - Tools to Equipment to Materials to Transit]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Commercial Property Coverage:</strong> Protection for covered physical assets at insured locations.</li>
            <li><strong>Inland Marine:</strong> Coverage for mobile property, tools, equipment, and in-transit assets.</li>
            <li><strong>Valuation Basis:</strong> Method used to settle loss value, such as replacement cost or actual cash value.</li>
            <li><strong>Property Exclusion Boundary:</strong> Conditions where standard property forms do not respond.</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Data and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Construction theft and equipment loss trend reporting</li>
            <li>Carrier guidance on inland marine usage in contractor placements</li>
            <li>Property disruption studies tied to weather, vandalism, and transit losses</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Why Property Coverage Matters</h2>
          <p className="leading-relaxed text-slate-700">
            Contractors face recurring property disruption: tool theft from vehicles, weather-damaged materials,
            vandalized equipment, and losses in transit. These events can drain cash, delay schedules, and create
            downstream contract pressure.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Tools stolen from trucks, trailers, or temporary storage</li>
            <li>Equipment damaged by fire, vandalism, or accidental impact</li>
            <li>Materials destroyed before installation</li>
            <li>Supplies lost while moving between supplier and jobsite</li>
            <li>Rented or borrowed equipment damage obligations</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains four lessons focused on coverage structure, inland marine gaps, materials risk,
            and practical contractor positioning.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Property coverage basics, major exclusions, and valuation methods.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Inland marine and contractor equipment protection strategy.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Materials, supplies, and jobsite property before installation.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Field scripts and objection handling for property coverage conversations.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            Standard property forms are frequently misunderstood in contractor accounts because mobile and in-transit assets
            sit outside basic assumptions. Inland marine is the operational bridge for real field conditions.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Explain where standard property stops and inland marine begins</li>
            <li>Identify high-frequency property losses before they occur</li>
            <li>Protect tools, equipment, and materials throughout movement and storage</li>
            <li>Use field-ready language that drives practical coverage decisions</li>
          </ul>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/7/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
