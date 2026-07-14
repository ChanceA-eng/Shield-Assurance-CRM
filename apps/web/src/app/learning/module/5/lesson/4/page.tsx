import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleFiveLessonFourPage(): JSX.Element {
  return (
    <SectionLayout title="Module 5 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 5</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Field Positioning and Contractor Scripts</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            This lesson turns technical coverage rules into clear field language. The objective is practical:
            improve compliance conversations, handle objections, and prevent uninsured labor and lawsuit exposures.
          </p>
          <p className="leading-relaxed text-slate-700">
            Effective positioning requires concise scripts, scenario framing, and confidence on common contractor myths.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Contractor Conversation - Workers Compensation and Employer Liability]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Three Common Myths</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Myth 1:</strong> We only use 1099 workers, so workers compensation does not apply.</li>
            <li><strong>Myth 2:</strong> Workers compensation only pays medical bills.</li>
            <li><strong>Myth 3:</strong> CGL can handle employee injury lawsuits if needed.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            Each myth creates direct uninsured risk. Field messaging should replace these assumptions with operational facts.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Workers Compensation is statutory protection for your employees and your business.
            Employer Liability is your lawsuit protection where workers comp benefits stop.
            CGL does not replace this structure for employee injury claims.
          </blockquote>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Scenario-Specific Scripts</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li>
              <strong>1099-heavy crews:</strong> The state decides classification, not invoice labels. If they are treated as employees,
              your workers comp obligations apply.
            </li>
            <li>
              <strong>Uninsured subcontractors:</strong> If their coverage fails, injury cost can shift back to your operation.
              Verify coverage before work mobilization.
            </li>
            <li>
              <strong>Small crews:</strong> One serious injury can disrupt payroll, projects, and licensing status.
              Workers compensation is a continuity control, not just a compliance box.
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Objection Handling</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Objection:</strong> Workers comp costs too much. <strong>Response:</strong> Uninsured injury losses cost materially more and can include penalties.</li>
            <li><strong>Objection:</strong> We have never had a claim. <strong>Response:</strong> Frequency is uncertain; severity drives loss outcomes.</li>
            <li><strong>Objection:</strong> CGL is enough. <strong>Response:</strong> CGL employee injury exclusions leave major gaps.</li>
          </ul>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor says, 'I only use 1099s, so workers compensation is not required.' Which response is best?"
          options={[
            { key: 'A', label: 'Correct, tax labels always control workers compensation obligations' },
            { key: 'B', label: 'CGL can replace workers compensation if no employees are on payroll' },
            { key: 'C', label: 'State classification tests control, and obligations can still apply' },
          ]}
          correctKey="C"
          explanation="Workers compensation status depends on legal classification tests, not invoice labels alone. Misclassification can produce direct statutory exposure." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/5/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/5/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Proceed to Module Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
