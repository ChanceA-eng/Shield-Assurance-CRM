import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleFiveCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 5 Complete">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 5</span>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900">Module Complete: Workers Compensation and Employer Liability</h1>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Module 5 Completion Badge - Workers Compensation and Employer Liability Mastery]
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">What You Have Mastered</h2>
          <p className="leading-relaxed text-slate-700">
            You have completed the statutory injury liability foundation for contractor operations.
            This module focused on how employee injury obligations are triggered, funded, and litigated in real conditions.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Workers compensation statutory structure and benefit framework</li>
            <li>Employer Liability exposure where workers comp benefits are not the full remedy</li>
            <li>CGL employee injury exclusions and resulting gap awareness</li>
            <li>1099 misclassification and uninsured subcontractor risk patterns</li>
            <li>Field scripts for practical contractor communication and compliance execution</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-8 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Why This Matters in the Field</h2>
          <p className="leading-relaxed text-slate-700">
            In contractor accounts, major workers compensation disruptions often come from labor structure failure,
            not only from claim frequency. Compliance discipline before mobilization is the strongest risk control.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Reduce stop-work and enforcement risk tied to labor classification</li>
            <li>Protect projects from uninsured injury cost transfer</li>
            <li>Improve contractor readiness for upstream contract requirements</li>
            <li>Lower downstream dispute risk by clarifying obligations early</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Next Step: Module 6</h2>
          <p className="leading-relaxed text-slate-700">
            Module 6 advances into commercial auto and hired/non-owned auto liability,
            including employee vehicle exposure patterns in contractor operations.
          </p>
          <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
            [Image Placeholder: Module 6 Preview - Commercial Auto and Hired/Non-Owned Auto Liability]
          </div>
        </section>

        <div className="flex flex-col gap-4 pt-10 md:flex-row">
          <a href="/learning/module/6" className="rounded-lg bg-slate-950 px-10 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800">Next Module</a>
          <a href="/learning/course/7c5e9732-66cf-4061-bbbf-73cc9b26819e/overview" className="rounded-lg border border-slate-300 px-10 py-4 text-lg font-semibold text-slate-900 transition-all hover:bg-slate-50">Return to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
