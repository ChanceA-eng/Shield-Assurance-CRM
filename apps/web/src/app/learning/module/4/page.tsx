import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleFourOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 4 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 4</span>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">Risk Transfer and Additional Insureds</h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Risk transfer is the backbone of construction insurance execution. Contracts shift liability and endorsements determine
            whether that liability transfer is financially enforceable. This module teaches how liability moves and how to protect
            contractors from contractual exposure.
          </p>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Risk Transfer Flow - Subcontractor to GC to Owner]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Risk Transfer:</strong> Contractual movement of liability responsibility between project parties.</li>
            <li><strong>Primary and Noncontributory:</strong> Requirement that one policy respond first without contribution from another.</li>
            <li><strong>Waiver of Subrogation:</strong> Agreement limiting insurer recovery rights against specified parties.</li>
            <li><strong>Additional Insured Endorsement:</strong> Policy language extending qualifying liability protection to another party.</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Data and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Construction contract dispute analyses tied to transfer clause failures</li>
            <li>Carrier and brokerage advisories on AI and P/N endorsement implementation</li>
            <li>Project claim studies linking documentation quality to defense outcomes</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module contains four lessons. You will learn how to read construction contracts, verify endorsement compliance,
            and explain risk transfer requirements with field-level clarity.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Understanding contractual risk transfer fundamentals.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Additional Insured endorsements and how they operate in practice.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Primary and noncontributory plus waiver of subrogation mechanics.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 4</h3>
              <p className="mt-2 leading-relaxed text-slate-700">Field positioning and contract review execution.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            Risk transfer is where insurance and contract law meet. Most contractor losses tied to upstream disputes trace back
            to missing or misapplied endorsement requirements. Mastery here prevents avoidable coverage failures.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Identify transfer clauses and endorsement requirements quickly</li>
            <li>Validate AI, P and N, and waiver structures against contract language</li>
            <li>Communicate deficiencies before project start</li>
            <li>Protect downstream and upstream parties from avoidable disputes</li>
          </ul>
        </section>

        <div className="flex justify-center pt-6">
          <a href="/learning/module/4/lesson/1" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
