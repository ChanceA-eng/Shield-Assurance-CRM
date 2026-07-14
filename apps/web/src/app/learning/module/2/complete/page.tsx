import SectionLayout from '../../../../../components/crm/SectionLayout';

export default function ModuleTwoCompletePage(): JSX.Element {
  return (
    <SectionLayout title="Module 2 Complete">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 2</span>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900">Module Complete: Commercial General Liability (CGL)</h1>
        </header>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Module 2 Completion Badge - CGL Mastery]
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">What You Have Mastered</h2>
          <p className="leading-relaxed text-slate-700">
            You now understand how CGL responds to contractor operations, where business-risk exclusions limit recovery,
            and how Additional Insured requirements shape contractual risk transfer.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Coverage A and Coverage B distinctions</li>
            <li>Completed operations trigger analysis</li>
            <li>Business-risk exclusions and resulting damage boundaries</li>
            <li>Additional Insured requirements including CG 20 10 and CG 20 37</li>
            <li>Primary and noncontributory and waiver of subrogation support</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-left">
          <h2 className="mb-3 text-2xl font-bold text-slate-900">Why This Matters in the Field</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Most contractor disputes come from misunderstanding exclusions and Additional Insured language. You can now explain what CGL
            covers, what it does not, and where endorsements are required to protect upstream parties.
          </p>
          <ul className="space-y-3 text-slate-700">
            <li>1. Which losses trigger Coverage A</li>
            <li>2. Which losses fall into completed operations</li>
            <li>3. Which losses are excluded by business-risk language</li>
            <li>4. Which contracts require stronger AI and endorsement structures</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Next Step: Module 3</h2>
          <p className="leading-relaxed text-slate-700">
            Next you will focus on Contractors Professional Liability (E and O), which fills CGL gaps for economic loss,
            professional services exposures, and design-related negligence.
          </p>
          <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
            [Image Placeholder: Module 3 Preview - Contractors Professional Liability]
          </div>
        </section>

        <div className="flex flex-col gap-4 pt-10 md:flex-row">
          <a href="/learning/module/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Module</a>
          <a href="/learning/course/7c5e9732-66cf-4061-bbbf-73cc9b26819e/overview" className="rounded-lg border border-slate-300 px-8 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Return to Course Overview</a>
        </div>
      </div>
    </SectionLayout>
  );
}
