import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleNineOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 9 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 9</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Business Owners Policy (BOP) and Commercial Package Policy (CPP)
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            BOP and CPP are the core packaging models for contractor commercial insurance. BOP simplifies
            coverage for many smaller contractors, while CPP provides modular flexibility for larger, more complex,
            or higher-hazard operations.
          </p>
          <p className="leading-relaxed text-slate-600">
            This module explains how packaging decisions affect eligibility, pricing, endorsement strategy,
            and coverage adequacy as contractor operations grow.
          </p>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: BOP vs CPP Coverage Structure - Bundled and Modular]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Business Owners Policy (BOP):</strong> Bundled coverage form often aligned to smaller, lower-complexity operations.</li>
            <li><strong>Commercial Package Policy (CPP):</strong> Modular structure allowing customized line and endorsement architecture.</li>
            <li><strong>Eligibility:</strong> Carrier-specific qualification standards based on hazard, size, and claims profile.</li>
            <li><strong>Carrier Appetite:</strong> The classes and conditions a carrier is willing to underwrite at a point in time.</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Why BOP and CPP Matter</h2>
          <p className="leading-relaxed text-slate-700">
            Contractors rarely carry one coverage line. Liability, property, inland marine, business income,
            and specialty lines interact. The packaging model determines how these parts are assembled,
            administered, and expanded over time.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Coverage breadth and endorsement flexibility</li>
            <li>Eligibility and carrier appetite alignment</li>
            <li>Administrative efficiency and renewal simplicity</li>
            <li>Scalability as operations and hazards expand</li>
            <li>Program stability under changing loss trends</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Signals and Cited Sources</h2>
          <p className="leading-relaxed text-slate-700">
            Recent commentary from AM Best, Marsh, Aon, Deloitte, and Verisk highlights continued pressure in contractor
            property and liability loss experience while showing sustained demand for bundled small-business solutions
            and modular middle-market placement structures.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>AM Best commercial lines and small-business packaging trends</li>
            <li>Marsh middle-market placement and rate observations</li>
            <li>Aon contractor segment and appetite commentary</li>
            <li>Deloitte insurance operations and administrative efficiency analysis</li>
            <li>Verisk loss trend indicators for contractor-related lines</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains four lessons focused on BOP fundamentals, CPP structure, eligibility and underwriting,
            and field positioning scripts.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">BOP basics and common contractor fit profiles.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">CPP modular structure and advanced flexibility.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Eligibility, underwriting signals, and carrier appetite.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Field positioning and contractor scripts for BOP vs CPP.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            The key coaching point is not price first, but fit first. A low-friction BOP can be ideal for stable,
            lower-hazard accounts, while CPP becomes necessary when operation complexity or risk profile exceeds BOP guardrails.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Use operation profile to choose structure, not assumptions</li>
            <li>Map exclusions and endorsements before quoting competitiveness</li>
            <li>Confirm growth trajectory to avoid near-term re-platform friction</li>
            <li>Position packaging as risk architecture, not paperwork preference</li>
          </ul>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/9/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
