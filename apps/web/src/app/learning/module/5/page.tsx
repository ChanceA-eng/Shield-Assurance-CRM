import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleFiveOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 5 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 5</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Workers Compensation and Employer Liability
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Workers Compensation is commonly misunderstood in contractor operations. It is statutory, not optional,
            and it must be paired with Employer Liability to handle lawsuit-driven exposures that workers comp benefits
            do not resolve on their own.
          </p>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Workers Compensation Flow - Injury to Benefits to Employer Liability]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Workers Compensation:</strong> Statutory coverage for employee injury benefits arising from work activities.</li>
            <li><strong>Employer Liability:</strong> Coverage for lawsuit pathways tied to employee injury scenarios.</li>
            <li><strong>Labor Misclassification:</strong> Incorrect worker status assignment that can create compliance and premium consequences.</li>
            <li><strong>Uninsured Subcontractor Exposure:</strong> Risk transfer failure when subcontractors do not carry valid WC coverage.</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Data and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>NCCI trend commentary on claim frequency and severity in contractor classes</li>
            <li>Regulatory and audit publications on misclassification and penalty exposure</li>
            <li>Construction labor risk studies on subcontractor injury and transfer outcomes</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains four lessons focused on statutory injury response, lawsuit gaps, labor misclassification,
            and how to explain these exposures to contractors in the field.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Workers Compensation fundamentals, benefits, and claim triggers.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Employer Liability and why CGL exclusions create coverage gaps.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">1099 labor, uninsured subcontractors, and statutory penalty exposure.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Field positioning scripts and contractor objection handling.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            Contractors who skip or underbuild workers comp are exposed to stop-work orders, fines, retroactive premium assessments,
            and direct legal liability for employee injuries. This module is designed to build practical clarity that prevents those failures.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Explain statutory workers comp obligations with confidence</li>
            <li>Identify Employer Liability scenarios not handled by workers comp benefits alone</li>
            <li>Spot labor misclassification and uninsured subcontractor risk early</li>
            <li>Use field-ready language that drives compliance before work begins</li>
          </ul>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/5/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
