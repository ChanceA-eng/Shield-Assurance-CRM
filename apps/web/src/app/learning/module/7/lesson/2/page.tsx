import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleSevenLessonTwoPage(): JSX.Element {
  return (
    <SectionLayout title="Module 7 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 7</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: Inland Marine and Contractor Equipment</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Inland marine is the primary property framework for moving contractor assets. It is designed for tools,
            mobile equipment, materials in transit, and jobsite storage conditions that standard property forms may not handle.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson focuses on practical form intent: where inland marine responds, where exclusions still apply,
            and how to structure limits around real equipment dependency.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Inland Marine Coverage Map - Tools Equipment Transit Jobsite]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Inland Marine Commonly Covers</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Tools and contractor equipment away from primary premises</li>
            <li>Mobile machinery and temporary project-use equipment</li>
            <li>Property in transit between suppliers, yards, and jobsites</li>
            <li>Rented or borrowed equipment where legal responsibility applies</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why Contractor Equipment Needs Dedicated Attention</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Equipment loss creates both replacement cost and downtime cost. High-value units can pause critical schedule paths,
            produce rental substitution expenses, and trigger contractual delay pressure.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Skid steers, lifts, compressors, and generators carry concentrated value.</li>
            <li>Theft and accidental damage rates increase when storage controls are weak.</li>
            <li>Rental and borrowing arrangements shift legal payment obligations quickly.</li>
          </ul>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Standard Property vs Inland Marine Coverage Comparison]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Scenarios</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>Skid steer theft:</strong> mobile equipment removed from jobsite after hours.</li>
            <li><strong>Transit tool damage:</strong> enclosed trailer incident between two active projects.</li>
            <li><strong>Rented lift loss:</strong> contractor responsible to rental company after damage event.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            If it moves with the project, it needs inland marine planning.
            Standard property is not enough for the way contractor equipment actually operates.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor damages a rented lift and receives a repayment demand. Which coverage concept is most relevant?"
          options={[
            { key: 'A', label: 'Inland marine with rented or borrowed equipment support' },
            { key: 'B', label: 'CGL personal and advertising injury' },
            { key: 'C', label: 'Workers compensation employer liability' },
          ]}
          correctKey="A"
          explanation="Rented and borrowed equipment responsibility is a core inland marine discussion point in contractor accounts." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/7/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/7/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
