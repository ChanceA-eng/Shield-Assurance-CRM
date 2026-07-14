import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleSixOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 6 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 6</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Commercial Auto and Hired/Non-Owned Auto Liability
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Auto liability is one of the highest-severity exposures in contractor operations. Whether a vehicle is owned,
            rented, borrowed, or employee-owned, business use can create direct liability for bodily injury and property damage.
            This module explains how coverage should be structured to prevent uninsured auto loss outcomes.
          </p>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Commercial Auto Liability Flow - Owned to Hired to Non-Owned]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Commercial Auto Liability:</strong> Coverage for third-party injury/property damage from business vehicle use.</li>
            <li><strong>Hired Auto:</strong> Liability exposure from rented or leased vehicles used in operations.</li>
            <li><strong>Non-Owned Auto:</strong> Liability exposure from employee-owned or borrowed vehicles used for business.</li>
            <li><strong>Vicarious Liability:</strong> Employer responsibility for employee actions during business activity.</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Data and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Commercial auto severity and litigation trend commentary from market reports</li>
            <li>Carrier analysis of hired and non-owned exposure frequency in contractor segments</li>
            <li>Repair and claim inflation studies relevant to contractor fleet risk</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains four lessons focused on auto liability fundamentals, hired and non-owned exposures,
            vicarious liability, and practical field communication.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Commercial auto basics and core coverage mechanics.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Hired and non-owned auto liability for non-owned vehicle use.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Employee vehicle use, vicarious liability, and supervision risk.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Field scripts and objection handling for contractor conversations.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            Contractors frequently underinsure auto exposure because they focus on ownership instead of business use.
            This module reframes auto risk as an operations liability issue and builds the language needed for better decisions.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Explain commercial auto liability in practical terms</li>
            <li>Identify hired and non-owned gaps before losses occur</li>
            <li>Clarify employer responsibility for employee driving activity</li>
            <li>Use concise scripts to improve client compliance behavior</li>
          </ul>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/6/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
