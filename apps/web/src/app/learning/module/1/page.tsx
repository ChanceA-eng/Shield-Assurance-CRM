import SectionLayout from '../../../../components/crm/SectionLayout';

export default function ModuleOneOverviewPage(): JSX.Element {
  return (
    <SectionLayout title="Module 1 Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-10">
        <header>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 1</span>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">Foundations of Contractor Liability</h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            Before you can structure a contractor insurance program, you must understand the legal system that creates the loss.
            Contractor liability does not originate in a policy. It originates in law. This module gives you the foundation needed
            to diagnose losses correctly, prevent denials, and protect clients from uninsured exposures.
          </p>
        </header>

        <div className="flex h-64 items-center justify-center rounded-lg bg-slate-200 p-6 text-center text-sm italic text-slate-600">
          [Image Placeholder: The Three Legal Systems Contractors Operate In | Prompt: A clean, modern diagram with three pillars labeled
          TORT, CONTRACT, STATUTORY and arrows pointing to examples.]
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Key Terms and Definitions</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Tort Liability:</strong> Civil liability for harm to others, usually from negligence in operations.</li>
            <li><strong>Contract Liability:</strong> Obligations created by signed agreements, including indemnity and insurance requirements.</li>
            <li><strong>Statutory Liability:</strong> Responsibility created by law or regulation, independent of contract terms.</li>
            <li><strong>Economic Loss Rule:</strong> Doctrine that can block recovery for pure financial loss absent covered physical damage or injury triggers.</li>
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Market Data and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>U.S. construction litigation trend commentary from legal risk publications</li>
            <li>Coverage dispute pattern analyses in contractor liability case summaries</li>
            <li>Industry carrier briefs on claim-origin mapping across tort, contract, and statute</li>
          </ul>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">What You Will Learn</h2>
          <p className="leading-relaxed text-slate-700">
            This module is divided into three focused lessons. Each lesson builds your ability to identify the legal origin of a loss
            and match it to the right insurance asset.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 1</h3>
              <p className="mt-2 leading-relaxed text-slate-700">
                The Legal Landscape Contractors Operate In: Tort, Contract, and Statutory liability in practical insurance language.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 2</h3>
              <p className="mt-2 leading-relaxed text-slate-700">
                Physical vs Economic vs Contractual Loss: why GL responds to some losses and denies others.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-bold text-slate-900">Lesson 3</h3>
              <p className="mt-2 leading-relaxed text-slate-700">
                The Economic Loss Rule: the doctrine that determines whether a contractor is covered or exposed.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-2xl font-bold text-slate-900">Instructor Guidance</h2>
          <p className="leading-relaxed text-slate-700">
            Take your time with this module. These principles are the backbone of contractor risk work. Once you understand how losses
            originate, the rest of the course becomes more intuitive and more useful in live client conversations.
          </p>
        </section>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
          <a
            href="/learning/module/1/lesson/1"
            className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800"
          >
            Begin Lesson 1
          </a>
        </div>
      </div>
    </SectionLayout>
  );
}
