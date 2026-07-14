import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleSixLessonOnePage(): JSX.Element {
  return (
    <SectionLayout title="Module 6 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 6</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: Commercial Auto Basics</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Commercial auto is a core liability line for contractor businesses. Vehicle incidents can generate severe bodily injury,
            property damage, and litigation outcomes that exceed many other loss categories in both frequency and cost.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson covers coverage structure, common misunderstandings, and why business driving requires more than personal auto protection.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Commercial Auto Coverage Map - Liability and Damage Components]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Commercial Auto Covers</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Auto liability:</strong> bodily injury and property damage caused by covered autos.</li>
            <li><strong>Physical damage options:</strong> collision and comprehensive for vehicle damage.</li>
            <li><strong>Medical payment options:</strong> passenger-related medical expense structures.</li>
            <li><strong>Uninsured and underinsured options:</strong> added protection for adverse driver scenarios.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            Coverage form selection and symbol structure control which autos are actually insured.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why Personal Auto Is Not a Business Strategy</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Personal auto policies are built for personal use. Business driving patterns create materially different exposure,
            and denials can occur when a loss is tied to work activity.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Daily jobsite travel and supply runs</li>
            <li>Transport of tools, materials, and job equipment</li>
            <li>Driving duties assigned during work operations</li>
            <li>Inter-jobsite travel under employer direction</li>
          </ul>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Personal Auto Exclusion vs Business Use]
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Contractor Scenario Examples</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li>
              <strong>Company truck rear-end claim:</strong> commercial auto liability responds to third-party injuries and damage.
            </li>
            <li>
              <strong>Employee uses personal truck for material pickup:</strong> denial risk rises under personal auto business-use restrictions.
            </li>
            <li>
              <strong>Temporary rental van during project surge:</strong> hired-auto planning is required to avoid coverage gaps.
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            If your business activity touches a vehicle, your liability exposure is active. Commercial auto is not optional protection,
            it is operational risk control for contractor mobility.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="An employee causes an accident while driving a personal vehicle to pick up job materials. Which coverage is most associated with protecting the employer?"
          options={[
            { key: 'A', label: 'CGL Coverage A' },
            { key: 'B', label: 'Non-Owned Auto Liability' },
            { key: 'C', label: 'Workers Compensation only' },
          ]}
          correctKey="B"
          explanation="When personal vehicles are used for business purposes, non-owned auto liability is the key employer-side protection concept." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/6" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/6/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
