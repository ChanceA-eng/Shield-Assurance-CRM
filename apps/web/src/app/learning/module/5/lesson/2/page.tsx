import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleFiveLessonTwoPage(): JSX.Element {
  return (
    <SectionLayout title="Module 5 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 5</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: Employer Liability and Workers Compensation Interactions</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Workers Compensation pays statutory benefits, but it does not absorb every lawsuit connected to employee injury.
            Employer Liability, typically Part B, is the lawsuit bridge where workers comp benefits stop.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson clarifies how Part A and Part B operate together and why CGL exclusions make this pairing non-negotiable.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Workers Compensation vs Employer Liability Coverage Flow]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Employer Liability Covers</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Employer Liability responds to certain lawsuits arising from employee injury where statutory benefits are not the full remedy.
          </p>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Third-party over actions:</strong> upstream party seeks contribution from the employer.</li>
            <li><strong>Loss of consortium claims:</strong> family-based derivative lawsuits.</li>
            <li><strong>Dual capacity allegations:</strong> employer sued in a second legal role.</li>
            <li><strong>Consequential injury allegations:</strong> related bodily injury claims tied to the core event.</li>
          </ul>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: CGL Employee Injury Exclusion Diagram]
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why CGL Does Not Fill This Gap</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            CGL forms generally exclude bodily injury to employees arising out of and in the course of employment.
            As a result, relying on CGL for employee injury litigation is a structural error.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Workers Compensation handles statutory benefits.</li>
            <li>Employer Liability handles specified lawsuit exposures.</li>
            <li>CGL usually does not respond to direct employee injury claims.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">How Part A and Part B Work Together</h2>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-2 text-sm font-bold text-slate-700">Coverage</th>
                <th className="py-2 text-sm font-bold text-slate-700">Primary Function</th>
                <th className="py-2 text-sm font-bold text-slate-700">Typical Trigger</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700">
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Workers Compensation (Part A)</td>
                <td>Statutory employee benefits</td>
                <td>Job-related injury or illness</td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Employer Liability (Part B)</td>
                <td>Specified employer lawsuit defense and indemnity</td>
                <td>Employee or third-party lawsuit beyond Part A</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Workers Compensation pays benefits. Employer Liability addresses lawsuits tied to employee injury.
            Without both parts, contractors can be exposed where CGL exclusions leave no backup.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="An injured employee's spouse files a loss-of-consortium lawsuit against the contractor. Which coverage is most relevant?"
          options={[
            { key: 'A', label: 'Workers Compensation only' },
            { key: 'B', label: 'Employer Liability' },
            { key: 'C', label: 'CGL Coverage A' },
          ]}
          correctKey="B"
          explanation="Loss-of-consortium allegations are a classic Employer Liability discussion point because they are lawsuit-driven and not a standard direct workers comp benefit payment." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/5/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/5/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
