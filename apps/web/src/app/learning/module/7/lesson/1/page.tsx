import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleSevenLessonOnePage(): JSX.Element {
  return (
    <SectionLayout title="Module 7 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 7</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: Property Coverage Basics</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Property coverage addresses direct physical loss to contractor assets: tools, equipment, materials,
            and jobsite property. This is distinct from liability coverage, which responds to third-party claims.
          </p>
          <p className="leading-relaxed text-slate-700">
            The challenge in contractor accounts is simple: many assets are mobile, in transit, or off-premises,
            and those conditions are where standard coverage assumptions break down.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Property Coverage Flow - Tools to Equipment to Materials]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Property Coverage Is Meant to Protect</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Tools:</strong> hand, power, and specialty trade tools.</li>
            <li><strong>Equipment:</strong> lifts, generators, compressors, and small machinery.</li>
            <li><strong>Materials:</strong> supplies delivered before installation.</li>
            <li><strong>Jobsite property:</strong> property staged for active project use.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why Standard Property Is Often Insufficient</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Standard forms are strongest for fixed-location assets and commonly narrow when property becomes mobile,
            temporarily stored, or transported between locations.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Tools stored in vehicles can face coverage limits or exclusions.</li>
            <li>Transit losses may not align with basic property form intent.</li>
            <li>Materials at jobsites before installation are frequently misunderstood.</li>
            <li>Borrowed or rented equipment often needs inland marine support.</li>
          </ul>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Property Exclusion Pressure Points]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Common Contractor Loss Patterns</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>Theft from trucks and trailers:</strong> overnight loss of high-value tools.</li>
            <li><strong>Weather loss before install:</strong> materials damaged during staging windows.</li>
            <li><strong>Transit damage:</strong> supplies damaged in movement between projects.</li>
            <li><strong>Rented equipment damage:</strong> repayment obligations to rental providers.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Replacement Cost vs Actual Cash Value</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Replacement cost:</strong> replacement with new equivalent property.</li>
            <li><strong>Actual cash value:</strong> replacement value less depreciation.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            For contractor tools and equipment, valuation choice can materially change claim outcomes and recovery speed.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Your tools and equipment are revenue engines. If they are stolen or damaged, work stops.
            Inland marine protects the mobile property your core operations depend on.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor loses tools stolen from a truck overnight and the basic property carrier disputes coverage. What coverage concept is usually central to fixing this gap?"
          options={[
            { key: 'A', label: 'Inland marine support for mobile and off-premises property' },
            { key: 'B', label: 'Workers compensation' },
            { key: 'C', label: 'CGL completed operations' },
          ]}
          correctKey="A"
          explanation="Inland marine is typically the key form for mobile tools and equipment where standard fixed-location assumptions do not fit." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/7" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/7/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
