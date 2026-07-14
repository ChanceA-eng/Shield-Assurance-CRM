import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleSixCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 6 Complete">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 6</span>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900">Module Complete: Commercial Auto and Hired/Non-Owned Auto Liability</h1>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Module 6 Completion Badge - Auto Liability Mastery]
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">What You Have Mastered</h2>
          <p className="leading-relaxed text-slate-700">
            You completed the commercial auto and non-owned exposure framework for contractor operations.
            This module focused on how liability follows business driving activity and how coverage architecture should respond.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Commercial auto liability fundamentals and practical scope</li>
            <li>Hired auto protection for rented, leased, and borrowed vehicle use</li>
            <li>Non-owned auto protection for employee vehicle business activity</li>
            <li>Vicarious liability concepts and employer claim pathways</li>
            <li>Field scripts for explaining exposure to contractors clearly</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-8 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Why This Matters in the Field</h2>
          <p className="leading-relaxed text-slate-700">
            Auto incidents are high-severity losses that can rapidly escalate into multi-party litigation.
            The most common mistakes are ownership-based assumptions and missing hired/non-owned structure.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Prevent uninsured business-use driving exposure</li>
            <li>Reduce claim volatility from employee personal vehicle activity</li>
            <li>Improve contractor readiness for fleet and non-fleet scenarios</li>
            <li>Strengthen advisory credibility with practical risk language</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Next Step: Module 7</h2>
          <p className="leading-relaxed text-slate-700">
            Module 7 transitions to property coverage and inland marine, including tools, equipment, material transit,
            and site-level theft and damage protection strategies.
          </p>
          <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
            [Image Placeholder: Module 7 Preview - Property Coverage and Inland Marine]
          </div>
        </section>

        <div className="flex flex-col gap-4 pt-10 md:flex-row">
          <a href="/learning/module/7" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">Next Module</a>
          <a href="/learning/course/7c5e9732-66cf-4061-bbbf-73cc9b26819e/overview" className="rounded-lg border border-slate-300 px-10 py-4 text-lg font-semibold text-slate-900 transition-all hover:bg-slate-50">Return to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
