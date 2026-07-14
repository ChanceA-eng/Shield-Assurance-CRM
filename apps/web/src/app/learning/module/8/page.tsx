import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleEightOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 8 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 8</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Builder's Risk / Course of Construction
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Builder's Risk protects the project under construction: structure, installed components, and staged materials.
            It is designed for fire, theft, weather, and accidental damage during active construction phases.
          </p>
          <p className="leading-relaxed text-slate-600">
            This module explains how Builder's Risk is structured, where coverage ends, what endorsements matter,
            and how to position it with data-backed credibility in contractor and owner conversations.
          </p>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Builder's Risk Coverage Diagram - Structure, Materials, Work in Progress, Temporary Works]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Builder's Risk:</strong> Project property coverage during active construction.</li>
            <li><strong>Work in Progress:</strong> Installed and partially completed project elements before final turnover.</li>
            <li><strong>Soft Costs:</strong> Indirect financial impacts from delay, such as financing or additional professional fees.</li>
            <li><strong>Delay in Completion:</strong> Time-related project impact after covered physical loss events.</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Why Builder's Risk Matters</h2>
          <p className="leading-relaxed text-slate-700">
            Construction assets are exposed before completion and before occupancy controls are in place. Fire,
            theft, weather, and water losses can destroy installed work and staged materials in days or hours.
            Without Builder's Risk, reconstruction burden can shift directly to project participants.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Fire damage to framing and partially completed structures</li>
            <li>Theft of installed metal, wiring, and mechanical components</li>
            <li>Weather damage to staged materials before installation</li>
            <li>Water intrusion damage during system commissioning</li>
            <li>Debris removal and restart cost after covered events</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Context and Cited Indicators</h2>
          <p className="leading-relaxed text-slate-700">
            Recent market commentaries from NFPA, Marsh, Aon, AGC, PCS/Verisk, and Dodge continue to highlight
            construction fire severity, water damage frequency, theft pressure, and delay cost amplification.
            Exact figures vary by study period and region, but underwriting focus remains concentrated on these drivers.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>NFPA construction fire reporting and large-loss tracking</li>
            <li>Marsh and Aon Builder's Risk market trend publications</li>
            <li>AGC contractor theft and operating environment reporting</li>
            <li>PCS/Verisk event and claim pattern summaries</li>
            <li>Dodge Construction delay and project disruption trend studies</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains four lessons focused on coverage basics, covered property and causes of loss,
            soft costs and delay strategy, and practical positioning scripts.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Builder's Risk fundamentals and responsibility structure.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Covered property, covered causes, and exclusion boundaries.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Soft costs, delay-in-completion, and key endorsements.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Field positioning, contractor scripts, and objection handling.</p>
            </div>
          </div>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/8/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
