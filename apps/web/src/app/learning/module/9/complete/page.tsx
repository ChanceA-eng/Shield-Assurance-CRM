import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleNineCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 9 Complete">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-14 text-center">
        <header className="space-y-4">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 9 Complete</span>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
            You Completed BOP and CPP Strategy
          </h1>
          <p className="text-lg leading-relaxed text-slate-700">
            You have finished Module 9 and practiced structure-fit reasoning, underwriting signals,
            and client-facing positioning for BOP versus CPP placement.
          </p>
        </header>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Module Completion Badge - BOP and CPP]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-left">
          <h2 className="text-2xl font-bold text-slate-900">What You Demonstrated</h2>
          <ul className="mt-4 list-disc space-y-3 pl-5 text-base text-slate-700">
            <li>Explained when BOP supports contractor efficiency and where limits appear</li>
            <li>Mapped CPP modular design to complex operations and contract demands</li>
            <li>Applied eligibility and appetite reasoning with underwriting discipline</li>
            <li>Used fit-first scripts for clearer, higher-trust client conversations</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-8 text-left">
          <h2 className="text-2xl font-bold text-slate-900">Next Step</h2>
          <p className="mt-3 leading-relaxed text-slate-700">
            Continue to Module 10 to deepen strategic placement skills and expand contractor program architecture.
          </p>
        </section>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <a href="/learning/module/10" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Go to Module 10</a>
          <a href="/learning/course/contractor-insurance-fundamentals/overview" className="rounded-lg border border-slate-300 px-8 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
