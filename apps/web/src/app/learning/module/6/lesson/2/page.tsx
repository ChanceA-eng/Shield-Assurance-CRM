import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleSixLessonTwoPage(): JSX.Element {
  return (
    <SectionLayout title="Module 6 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 6</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: Hired and Non-Owned Auto Liability</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Many contractors focus on owned vehicles and miss a larger reality: liability can attach when the business uses vehicles it does not own.
            Hired and non-owned auto structures are built for this exact gap.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson distinguishes hired vs non-owned exposures and shows why businesses with zero titled vehicles still need auto liability planning.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Hired vs Non-Owned Auto Liability Comparison]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Coverage Distinction</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Hired Auto:</strong> rented, leased, or borrowed vehicles used in business operations.</li>
            <li><strong>Non-Owned Auto:</strong> employee-owned vehicles used for business duties.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            Together, these forms address business-use liability when ownership is outside the company.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why Zero-Owned-Fleet Contractors Still Need This</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Project managers drive personal vehicles between jobsites</li>
            <li>Teams rent vans or pickups for short-term logistics</li>
            <li>Crew leaders use personal trucks for tool and material transport</li>
            <li>Borrowed vehicles fill temporary operational shortages</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            Any of these activities can trigger employer-side liability lawsuits after accidents.
          </p>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Vicarious Liability - Employee Driving to Employer Responsibility]
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Scenario Examples</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li>
              <strong>Rented vehicle crash:</strong> rental policy limits are insufficient; hired-auto liability fills the employer gap.
            </li>
            <li>
              <strong>Employee personal vehicle accident:</strong> personal insurer denies for business use; non-owned auto becomes critical.
            </li>
            <li>
              <strong>Borrowed truck event:</strong> owner policy disputes business-use applicability; hired-auto structure supports response.
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            You are exposed even when you do not own the vehicle. If your business benefits from the trip,
            you can be pulled into the claim. Hired and non-owned auto protects that operational reality.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor rents a truck for two weeks and the driver causes a severe third-party injury loss. Which coverage concept is primary?"
          options={[
            { key: 'A', label: 'Hired Auto Liability' },
            { key: 'B', label: 'Non-Owned Auto Liability' },
            { key: 'C', label: 'CGL Products-Completed Operations' },
          ]}
          correctKey="A"
          explanation="Rented and leased vehicles used in business operations are the core hired-auto liability scenario." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/6/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/6/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
