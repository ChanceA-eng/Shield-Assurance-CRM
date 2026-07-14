import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleSixLessonThreePage(): JSX.Element {
  return (
    <SectionLayout title="Module 6 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 6</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: Employee Vehicle Use and Vicarious Liability</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Contractors are often surprised that they can be sued for accidents in vehicles they do not own.
            Vicarious liability and supervision theories regularly create employer-side exposure in employee driving scenarios.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains where liability attaches, why denials occur under personal auto, and what controls reduce claim severity.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Employee Driving Exposure Chain - Driver to Employer]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Common Business-Use Triggers</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Material pickups and tool transport</li>
            <li>Inter-jobsite travel under supervisor direction</li>
            <li>Inspection and client meeting travel</li>
            <li>Same-day delivery runs during project execution</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            If the trip benefits business operations, employer liability arguments generally strengthen.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Legal Theories Often Asserted</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li><strong>Vicarious liability:</strong> employer responsibility for employee acts in scope of work.</li>
            <li><strong>Negligent supervision:</strong> allegation that driving risk oversight was inadequate.</li>
            <li><strong>Negligent entrustment:</strong> allegation tied to allowing unsafe driving activity.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            These claims can materially increase defense cost even before indemnity outcomes are determined.
          </p>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Personal Auto Business-Use Denial Path]
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Operational Controls That Help</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Driver qualification and MVR review standards</li>
            <li>Documented trip-purpose and dispatch procedures</li>
            <li>Cell-phone and fatigue safety protocols</li>
            <li>Clear reimbursement and vehicle-use policy language</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            If they drive for your business, your business can be named in the lawsuit.
            Vehicle ownership does not erase employer liability when work activity caused the trip.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="An employee causes an accident while driving between jobsites in a personal vehicle. Which legal concept most directly supports a claim against the employer?"
          options={[
            { key: 'A', label: 'Vicarious liability' },
            { key: 'B', label: 'Builders risk valuation' },
            { key: 'C', label: 'Workers compensation exclusivity only' },
          ]}
          correctKey="A"
          explanation="When driving is in the scope of employment or benefits the business, vicarious liability is a core pathway for employer-side claims." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/6/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/6/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
