import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleTwoOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 2 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 2</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">Commercial General Liability (CGL) for Contractors</h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Now that you understand how contractor losses originate, it is time to learn how the Commercial General Liability policy
            responds. This module breaks down Coverage A, Coverage B, completed operations, business-risk exclusions, and additional
            insured endorsements in practical language.
          </p>
        </header>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Coverage A:</strong> CGL section for bodily injury and property damage liability.</li>
            <li><strong>Coverage B:</strong> CGL section for personal and advertising injury allegations.</li>
            <li><strong>Completed Operations:</strong> Liability exposure after work is finished and put to use.</li>
            <li><strong>Business-Risk Exclusions:</strong> Policy language limiting coverage for the insured's own faulty work costs.</li>
            <li><strong>Additional Insured:</strong> Party added to the policy for defined liability arising from the named insured's work.</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Data and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>ISO and carrier training commentary on CGL form interpretation</li>
            <li>Construction defect and completed-operations claim trend summaries</li>
            <li>Risk transfer practice notes from contractor liability benchmarking studies</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains five lessons. Each lesson builds your ability to interpret the CGL policy and apply it correctly to
            contractor operations.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Coverage A - Bodily Injury and Property Damage.</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Coverage B - Personal and Advertising Injury.</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Completed Operations and construction defect implications.</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Business-risk exclusions and how they limit faulty work coverage.</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 md:col-span-2">
              <h3 className="text-xl font-bold text-slate-900">Lesson 5</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Additional Insured endorsements and contractual risk transfer alignment.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            CGL is the backbone of contractor liability coverage. Most placement errors happen when agents misread the relationship between
            Coverage A and business-risk exclusions. This module gives you the clarity needed to advise contractors accurately.
          </p>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/2/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
