import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleThreeLessonTwoPage(): JSX.Element {
  return (
    <SectionLayout title="Module 3 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 3</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: E and O Coverage Triggers</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Contractors Professional Liability responds when a contractor's professional mistake causes financial harm.
            Unlike CGL, E and O does not require bodily injury or property damage to trigger a claim response.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains exactly what activates E and O coverage and why those triggers differ from CGL occurrence-based logic.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: E and O Trigger Flow - Professional Error to Financial Harm to Claim]
        </div>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Triggers E and O Coverage</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            E and O is generally triggered when a professional service error causes measurable financial damage.
            The focus is on service quality, judgment, and professional performance.
          </p>

          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Professional error:</strong> incorrect advice, interpretation, or oversight.</li>
            <li><strong>Design mistake:</strong> flawed specifications, recommendations, or field modifications.</li>
            <li><strong>Faulty workmanship without resulting damage:</strong> work fails but damages only itself.</li>
            <li><strong>Economic loss:</strong> financial harm with no qualifying physical injury or property damage.</li>
          </ul>

          <p className="mt-2 text-xs text-slate-500">Source: IRMI professional liability guidance and contractors E and O form structures.</p>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: CGL Trigger vs E and O Trigger Comparison]
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">How E and O Triggers Differ from CGL Triggers</h2>

          <p className="mb-4 leading-relaxed text-slate-700">
            CGL focuses on occurrence-based physical injury patterns. E and O focuses on professional performance errors and their financial outcomes.
          </p>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-2 text-sm font-bold text-slate-700">Trigger Type</th>
                <th className="py-2 text-sm font-bold text-slate-700">CGL</th>
                <th className="py-2 text-sm font-bold text-slate-700">E and O</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700">
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Bodily Injury</td>
                <td>Typically required</td>
                <td>Not required</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Property Damage</td>
                <td>Typically required</td>
                <td>Not required</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-3 font-medium">Economic Loss</td>
                <td>Often excluded</td>
                <td>Core trigger lane</td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Professional Error</td>
                <td>Usually excluded</td>
                <td>Core trigger lane</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World E and O Trigger Examples</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>Blueprint misread:</strong> causes schedule delay and revenue loss with no physical damage.</li>
            <li><strong>Improper installation:</strong> system fails and only the installed component must be redone.</li>
            <li><strong>Wrong material guidance:</strong> recommendation causes rework and cost overrun.</li>
            <li><strong>Field design change:</strong> professional modification creates a defect condition.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            If your mistake causes financial damage without physical damage, CGL usually does not respond.
            E and O exists for that professional-error exposure.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor recommends the wrong concrete mix. The result is a 25,000 dollar cost overrun with no physical damage. Which coverage lane applies?"
          options={[
            { key: 'A', label: 'CGL Coverage A' },
            { key: 'B', label: 'Contractors E and O' },
            { key: 'C', label: 'No coverage by default' },
          ]}
          correctKey="B"
          explanation="Economic loss without qualifying physical damage is generally outside CGL intent. Financial harm from professional recommendation error aligns with E and O response logic."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/3/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/3/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
