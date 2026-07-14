import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleFiveLessonOnePage(): JSX.Element {
  return (
    <SectionLayout title="Module 5 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 5</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: Workers Compensation Basics</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Workers Compensation is the only standard coverage line in this program that is statutory by design.
            It protects employees with defined benefits and protects employers from severe legal and financial exposure.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains what the policy pays, when claims trigger, and why contractor operations of every size
            require compliant workers comp execution.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Workers Compensation Benefits Flow - Injury to Benefits]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Workers Compensation Covers</h2>
          <p className="mb-4 leading-relaxed text-slate-700">Core statutory benefits typically include:</p>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Medical benefits:</strong> reasonable and necessary treatment tied to the job injury.</li>
            <li><strong>Wage replacement:</strong> partial income continuation while the employee cannot work.</li>
            <li><strong>Permanent disability benefits:</strong> scheduled or rated compensation for lasting impairment.</li>
            <li><strong>Death benefits:</strong> dependent support and related statutory payments.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            These benefits are statute-driven and cannot be replaced by private agreement language.
          </p>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Claim Trigger - Employee Injury During Work]
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">How Claims Are Triggered</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Claims generally arise from injury or illness occurring in the course and scope of employment.
            Fault is not the threshold issue in standard workers comp response.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Falls, strains, and tool incidents on active jobsites</li>
            <li>Heat-related and environmental exposure injuries</li>
            <li>Vehicle accidents during work duties</li>
            <li>Occupational disease or cumulative trauma scenarios</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why Contractors Must Carry It</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Regulatory enforcement:</strong> states can issue stop-work orders and penalties.</li>
            <li><strong>Uninsured injury liability:</strong> employers may pay benefits and legal costs directly.</li>
            <li><strong>Contractual compliance:</strong> upstream agreements often require active workers comp proof.</li>
            <li><strong>Business continuity:</strong> one uninsured injury can destabilize payroll and operations.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Workers Compensation protects your employees and protects your company from severe uninsured injury exposure.
            It is required by law in contractor operations and it must be in place before work starts.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A laborer strains his back lifting materials on a jobsite. Which policy responds first?"
          options={[
            { key: 'A', label: 'CGL Coverage A' },
            { key: 'B', label: 'Workers Compensation' },
            { key: 'C', label: 'Commercial Auto' },
          ]}
          correctKey="B"
          explanation="Employee injury arising out of employment is a workers compensation trigger. CGL generally excludes employee injury claims." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/5" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/5/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
