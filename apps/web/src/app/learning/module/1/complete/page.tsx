import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleOneCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 1 Complete">
      <div className="mx-auto max-w-4xl space-y-8 px-6 py-12 text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Module Milestone</p>
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">Module 1 Complete</h1>
        <p className="mx-auto max-w-3xl leading-relaxed text-slate-700">
          You now have the legal foundation to diagnose where contractor losses originate and where coverage can fail.
          This is the cornerstone of advanced construction risk advisory work.
        </p>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-left">
          <h2 className="mb-3 text-xl font-bold text-slate-900">What You Can Do Now</h2>
          <ul className="space-y-3 text-slate-700">
            <li>1. Identify whether a contractor dispute belongs in tort, contract, or statutory lane.</li>
            <li>2. Separate physical, economic, and contractual loss types in under two minutes.</li>
            <li>3. Explain why Economic Loss Rule analysis changes coverage outcomes.</li>
            <li>4. Position CGL and Contractors E and O as complementary, not interchangeable.</li>
          </ul>
        </section>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href="/learning/module/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Module</a>
          <a href="/learning/module/1" className="rounded-lg border border-slate-300 px-8 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Module Overview</a>
          <a href="/learning/course/7c5e9732-66cf-4061-bbbf-73cc9b26819e/overview" className="rounded-lg border border-slate-300 px-8 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Return to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
