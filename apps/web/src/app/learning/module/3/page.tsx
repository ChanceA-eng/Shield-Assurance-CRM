import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleThreeOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 3 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 3</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">Contractors Professional Liability (E and O)</h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Contractors Professional Liability fills the coverage gaps left by CGL. While CGL focuses on bodily injury and property damage,
            E and O addresses economic loss, professional negligence, design errors, and faulty workmanship without resulting damage.
          </p>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: CGL vs E and O Coverage Comparison]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Professional Liability (E and O):</strong> Coverage for financial loss caused by professional services errors or omissions.</li>
            <li><strong>Economic Loss:</strong> Financial harm not directly tied to covered bodily injury or property damage.</li>
            <li><strong>Coverage Trigger:</strong> The event or condition that activates policy response.</li>
            <li><strong>Gap Analysis:</strong> Comparison of exposures versus policy response to identify uninsured risk.</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Data and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Professional liability claim pattern studies in contractor operations</li>
            <li>Carrier commentary on CGL to E and O boundary conditions</li>
            <li>Economic-loss dispute examples in construction litigation reporting</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains four lessons. Each lesson builds your ability to identify E and O exposures,
            explain where CGL stops, and position E and O correctly with contractors.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Why Contractors Need E and O.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">E and O coverage triggers and practical claim patterns.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">E and O versus CGL gap analysis in contractor operations.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Field positioning scripts for contractor-facing conversations.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            Many contractors assume CGL handles all losses. It does not. This module gives you the clarity to explain why E and O is essential
            for economic-loss and professional-service exposures that CGL typically does not address.
          </p>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/3/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
