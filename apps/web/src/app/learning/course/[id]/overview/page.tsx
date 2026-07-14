import SectionLayout from '../../../../../components/crm/SectionLayout';

export default async function CourseOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;

  return (
    <SectionLayout title="Course Overview">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-4xl font-extrabold text-slate-900">Contractor Liability and Insurance Program</h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            This course is designed to give you a complete, practical understanding of contractor liability, insurance coverage,
            and risk transfer. Use this overview to navigate to any module or continue where you left off.
          </p>
        </header>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-3 text-xl font-bold text-slate-900">Continue Learning</h2>
          <p className="mb-4 text-slate-700">Resume your progress from your last completed lesson.</p>
          <a
            href="/learning/module/1/lesson/1"
            className="inline-flex rounded-lg bg-slate-950 px-8 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800"
          >
            Continue
          </a>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Course Modules</h2>

          <div className="space-y-4">
            <a href="/learning/module/1" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 1 - Foundations of Contractor Liability</h3>
              <p className="mt-1 text-slate-700">Learn how contractor losses originate and how legal systems determine coverage.</p>
            </a>

            <a href="/learning/module/2" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 2 - Commercial General Liability (CGL)</h3>
              <p className="mt-1 text-slate-700">Understand Coverage A, Coverage B, completed operations, and business-risk exclusions.</p>
            </a>

            <a href="/learning/module/3" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 3 - Contractors Professional Liability (E and O)</h3>
              <p className="mt-1 text-slate-700">Learn how E and O fills the gaps left by CGL and protects against economic loss.</p>
            </a>

            <a href="/learning/module/4" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 4 - Risk Transfer and Additional Insureds</h3>
              <p className="mt-1 text-slate-700">Master contractual risk transfer, indemnification, and AI endorsements.</p>
            </a>

            <a href="/learning/module/5" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 5 - Workers Compensation for Construction</h3>
              <p className="mt-1 text-slate-700">Understand WC classifications, subcontractor exposure, and audit preparation.</p>
            </a>

            <a href="/learning/module/6" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 6 - Commercial Auto and Hired/Non-Owned Auto Liability</h3>
              <p className="mt-1 text-slate-700">Learn how owned, hired, and non-owned vehicle exposures create liability in contractor operations.</p>
            </a>

            <a href="/learning/module/7" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 7 - Property Coverage and Inland Marine</h3>
              <p className="mt-1 text-slate-700">Learn how tools, equipment, and materials are protected through inland marine and property strategy.</p>
            </a>

            <a href="/learning/module/8" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 8 - Builder's Risk / Course of Construction</h3>
              <p className="mt-1 text-slate-700">Learn how project property is protected during construction, including delay and endorsement strategy.</p>
            </a>

            <a href="/learning/module/9" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 9 - Business Owners Policy (BOP) and Commercial Package Policy (CPP)</h3>
              <p className="mt-1 text-slate-700">Learn how packaging strategy, eligibility, and underwriting appetite shape BOP versus CPP decisions.</p>
            </a>

            <a href="/learning/module/10" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 10 - Commercial Auto (Liability, Physical Damage, HNOA, Symbols, Endorsements)</h3>
              <p className="mt-1 text-slate-700">Learn how contractor auto exposures are controlled through trigger design, endorsements, and fit-first placement strategy.</p>
            </a>

            <a href="/learning/module/11" className="block rounded-xl border border-slate-200 p-6 transition hover:bg-slate-50">
              <h3 className="text-xl font-bold text-slate-900">Module 11 - Workers Compensation (Advanced Contractor Edition)</h3>
              <p className="mt-1 text-slate-700">Learn advanced WC strategy across benefits, employer liability, class codes, mods, and subcontractor controls.</p>
            </a>
          </div>
        </section>

        <div className="hidden" data-course-id={id} />
      </div>
    </SectionLayout>
  );
}
