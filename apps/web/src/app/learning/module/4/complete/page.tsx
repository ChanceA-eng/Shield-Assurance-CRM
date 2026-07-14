import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleFourCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 4 Complete">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 4</span>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900">Module Complete: Risk Transfer and Additional Insureds</h1>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Module 4 Completion Badge - Risk Transfer Mastery]
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">What You Have Mastered</h2>
          <p className="leading-relaxed text-slate-700">
            You now understand how contractual liability moves and how endorsements operationalize transfer.
            You can identify when risk transfer is incomplete and correct the gap before claims arise.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>How indemnification and insurance provisions work together</li>
            <li>How AI forms support ongoing and completed operations transfer</li>
            <li>How P and N controls contribution order</li>
            <li>How waiver of subrogation reduces recovery litigation risk</li>
            <li>How to review contractor agreements for endorsement compliance</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-8 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Why This Matters in the Field</h2>
          <p className="leading-relaxed text-slate-700">
            Upstream disputes often result from missing endorsement structure rather than missing policy limits.
            Correct transfer architecture prevents avoidable contribution disputes and downstream recovery lawsuits.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Identify missing contract requirements before project mobilization</li>
            <li>Prevent avoidable tender failures</li>
            <li>Reduce upstream deductible impact from downstream-caused losses</li>
            <li>Improve contractor compliance and client confidence</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Next Step: Module 5</h2>
          <p className="leading-relaxed text-slate-700">
            Module 5 focuses on workers compensation and employer liability architecture in contractor operations.
          </p>
          <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
            [Image Placeholder: Module 5 Preview - Workers Compensation and Employer Liability]
          </div>
        </section>

        <div className="flex flex-col gap-4 pt-10 md:flex-row">
          <a href="/learning/module/5" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">Next Module</a>
          <a href="/learning/course/7c5e9732-66cf-4061-bbbf-73cc9b26819e/overview" className="rounded-lg border border-slate-300 px-10 py-4 text-lg font-semibold text-slate-900 transition-all hover:bg-slate-50">Return to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
