import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleThreeLessonThreePage(): JSX.Element {
  return (
    <SectionLayout title="Module 3 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 3</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: E and O vs CGL - Understanding the Coverage Gap</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Contractors often assume CGL covers any loss tied to their work. It does not. CGL focuses on accidental bodily injury
            and property damage; E and O focuses on professional mistakes and economic loss.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson gives a deep side-by-side analysis so the coverage gap becomes operationally clear in real contractor scenarios.
          </p>
        </section>

        <div className="flex h-64 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: CGL vs E and O Coverage Gap Diagram]
        </div>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core Difference: Accident vs Professional Error</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            CGL uses occurrence logic. E and O uses professional-performance logic. That difference drives claim outcomes.
          </p>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-2 text-sm font-bold text-slate-700">Trigger Dimension</th>
                <th className="py-2 text-sm font-bold text-slate-700">CGL</th>
                <th className="py-2 text-sm font-bold text-slate-700">E and O</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700">
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Bodily Injury</td>
                <td>Central trigger</td>
                <td>Not required</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Property Damage</td>
                <td>Central trigger</td>
                <td>Not required</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Economic Loss</td>
                <td>Often excluded</td>
                <td>Core response lane</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Faulty Work to Itself</td>
                <td>Business-risk exclusion problem</td>
                <td>Often insurable lane</td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Professional Services</td>
                <td>Generally excluded</td>
                <td>Core response lane</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Sources: ISO CG 00 01 and contractors professional liability form families.</p>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Faulty Workmanship vs Resulting Damage Flow]
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Faulty Workmanship Is the Largest Gap</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Most contractor misunderstanding centers on faulty workmanship. CGL is not a warranty for work quality.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Damage to your work limits repair coverage for the insured's own faulty work.</li>
            <li>Damage to your product limits product-only failure recovery.</li>
            <li>Impaired property can limit loss-of-use claims without physical injury.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            E and O is designed to address many financial consequences of those professional-performance failures.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Coverage Gap Examples</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>Incorrect installation with no collateral damage:</strong> CGL denial risk high; E and O lane applies.</li>
            <li><strong>Blueprint misread creates delay loss:</strong> financial-only loss points to E and O.</li>
            <li><strong>Wrong material recommendation:</strong> professional judgment error with overrun cost points to E and O.</li>
            <li><strong>Field design modification defect:</strong> professional services exposure points to E and O.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Script: Two Buckets</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            CGL is your accident bucket. E and O is your mistake bucket. Contractors need both,
            because most disputes involve a mix of operations risk and professional-performance risk.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor installs a retaining wall incorrectly. The wall fails but only the wall itself is damaged. Which coverage lane is primary?"
          options={[
            { key: 'A', label: 'CGL Coverage A' },
            { key: 'B', label: 'Contractors E and O' },
            { key: 'C', label: 'No coverage in any form' },
          ]}
          correctKey="B"
          explanation="Faulty workmanship that damages only itself is commonly where CGL business-risk exclusions apply. E and O is the coverage architecture designed for many of those professional-performance losses."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/3/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/3/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
