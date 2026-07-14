import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleFourLessonOnePage(): JSX.Element {
  return (
    <SectionLayout title="Module 4 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 4</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: Understanding Contractual Risk Transfer</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Contractual risk transfer determines who pays when losses arise on a project. Contracts move liability upstream and downstream,
            while insurance endorsements determine whether the transfer can be funded in practice.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson covers indemnification structure, liability flow, and why Additional Insured architecture is required to enforce contract intent.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Risk Transfer Flow - Subcontractor to GC to Owner]
        </div>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Contractual Risk Transfer Means</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Contractual risk transfer is the formal allocation of liability by written agreement. In construction,
            upstream parties typically require downstream performers to absorb liabilities arising from downstream work.
          </p>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Liability should follow the work: the party creating the operational risk should carry the financial responsibility for that risk.
          </blockquote>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Upstream vs Downstream Liability]
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Upstream and Downstream Liability Structure</h2>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-2 text-sm font-bold text-slate-700">Party</th>
                <th className="py-2 text-sm font-bold text-slate-700">Role</th>
                <th className="py-2 text-sm font-bold text-slate-700">Transfer Direction</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700">
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Owner</td>
                <td>Project principal</td>
                <td>Upstream</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">General Contractor</td>
                <td>Project manager</td>
                <td>Upstream</td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Subcontractor</td>
                <td>Performs work</td>
                <td>Downstream</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4 leading-relaxed text-slate-700">
            Upstream parties seek protection from downstream mistakes through indemnity and insurance requirements.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Indemnification Clauses</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Indemnification language requires one party to defend, reimburse, and hold harmless another for losses tied to the first party's work.
          </p>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Subcontractor shall indemnify, defend, and hold harmless the Owner and General Contractor from claims arising out of Subcontractor work.
          </blockquote>
          <p className="mt-4 leading-relaxed text-slate-700">
            This legal transfer still requires proper endorsements to fund the obligation.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why Insurance Is Required to Support Transfer</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Contract language shifts liability on paper. Endorsements shift claims funding in reality.
          </p>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Additional Insured:</strong> grants upstream parties access to downstream coverage.</li>
            <li><strong>Primary and Noncontributory:</strong> keeps upstream insurance from contributing first.</li>
            <li><strong>Waiver of Subrogation:</strong> restricts downstream insurer recovery actions against upstream parties.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Liability follows the work. If your subcontractor causes the loss, their insurance should respond first.
            Contract language and endorsements must match to make that happen.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A subcontractor error causes a loss and the owner sues the GC. Which mechanism allows the GC to tender the claim to subcontractor insurance?"
          options={[
            { key: 'A', label: 'Indemnification language by itself only' },
            { key: 'B', label: 'Additional Insured endorsement support' },
            { key: 'C', label: 'Waiver of subrogation only' },
          ]}
          correctKey="B"
          explanation="Indemnification shifts legal responsibility, but Additional Insured endorsement structure gives upstream parties practical access to downstream liability insurance for tender and defense." 
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/4/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
