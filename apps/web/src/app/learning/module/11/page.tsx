import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleElevenOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 11 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 11</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Workers Compensation for Contractors (Advanced Edition)
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Workers Compensation is one of the most regulated, audited, and financially impactful lines for
            contractors. It covers employee injuries, employer liability, class code structure, experience mods,
            subcontractor rules, and multi-state compliance.
          </p>
          <p className="leading-relaxed text-slate-600">
            This advanced module goes beyond introductory workers compensation content and focuses on field-level
            execution, underwriting logic, and audit-driven financial outcomes.
          </p>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Workers Compensation Coverage Diagram - Benefits to Liability to Mods to Class Codes]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Workers Compensation:</strong> Statutory system for employee injury benefits arising from work activity.</li>
            <li><strong>Employer Liability:</strong> Coverage for certain lawsuit pathways connected to employee injuries.</li>
            <li><strong>Class Codes:</strong> Risk categories assigned to duties that influence WC rate calculations.</li>
            <li><strong>Experience Mod:</strong> Performance factor adjusting premium based on actual versus expected claims.</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Why Workers Compensation Matters</h2>
          <p className="leading-relaxed text-slate-700">
            Construction remains one of the highest-hazard workforce groups in U.S. labor data. Contractor injury
            frequency, lost-time severity, and fatality exposure materially exceed baseline industry averages.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Medical expenses for work-related injuries</li>
            <li>Wage replacement for lost-time claims</li>
            <li>Permanent disability and death benefit obligations</li>
            <li>Employer liability lawsuit exposure handling</li>
            <li>Subcontractor injury responsibility transfer issues</li>
            <li>Audit penalties tied to misclassification and documentation gaps</li>
          </ul>
          <p className="leading-relaxed text-slate-700">
            The objective is practical confidence: explain coverage clearly, detect risk drivers early,
            and prevent avoidable audit shocks.
          </p>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Data and Industry Research</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>NCCI reporting shows continued pressure in construction claim frequency and severity cohorts</li>
            <li>Mod-impact studies show substantial premium variance tied to claim performance trends</li>
            <li>Audit enforcement commentary indicates increasing focus on classification and payroll accuracy</li>
            <li>Aon and Marsh construction benchmarks highlight subcontractor WC verification as a key control</li>
            <li>Labor and safety studies continue to reinforce elevated contractor injury exposure intensity</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains four advanced lessons focused on benefits and employer liability, class codes,
            experience mods, and subcontractor rule execution.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Workers compensation benefits and employer liability fundamentals.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Classification codes, payroll assignment, and audit outcomes.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Experience mods, pricing impact, and actionable improvement strategy.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Subcontractor rules, ghost policy risk, and coverage gap prevention.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            Workers compensation is not just payroll math. It is a compliance, claims, and risk-transfer system where
            weak documentation and weak subcontractor controls can materially alter premium and liability outcomes.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Explain benefits and employer liability in plain, field-ready language</li>
            <li>Validate class code assignment against real duties, not titles</li>
            <li>Connect mod movement directly to claim and return-to-work strategy</li>
            <li>Detect uninsured subcontractor exposure before audit season</li>
            <li>Position WC as operational risk control, not a commodity purchase</li>
          </ul>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/11/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
