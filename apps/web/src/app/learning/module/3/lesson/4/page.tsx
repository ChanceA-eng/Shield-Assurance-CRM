import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleThreeLessonFourPage(): JSX.Element {
  return (
    <SectionLayout title="Module 3 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 3</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Field Positioning and Contractor Scripts</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Contractors often believe CGL covers every mistake. This lesson gives practical, field-tested language for explaining why E and O
            is essential when financial harm occurs without qualifying physical damage.
          </p>
          <p className="leading-relaxed text-slate-700">
            Focus here is tactical communication: scripts, trade-specific positioning, and objection handling that works in real meetings.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Contractor Conversation - E and O Positioning]
        </div>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Three Common Myths to Correct</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Myth 1:</strong> My CGL covers everything. <strong>Reality:</strong> CGL covers accidents, not most performance mistakes.</li>
            <li><strong>Myth 2:</strong> E and O is only for architects. <strong>Reality:</strong> Contractors perform professional services daily.</li>
            <li><strong>Myth 3:</strong> Every error causes physical damage. <strong>Reality:</strong> Many losses are economic only.</li>
          </ul>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: E and O vs CGL Contractor Misconceptions]
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Your CGL policy handles accidents that cause bodily injury or property damage. Most contractor disputes are mistake-based losses,
            such as delays, rework, and cost overruns. E and O is the policy designed for those professional-performance exposures.
          </blockquote>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Trade-Specific Scripts</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>General Contractor:</strong> coordination and interpretation errors create financial loss even when no property is physically damaged.</li>
            <li><strong>Electrician:</strong> wiring installed wrong but fixed before collateral damage can still produce large rework costs.</li>
            <li><strong>Plumber:</strong> installation error caught early may avoid water damage but still trigger expensive correction costs.</li>
            <li><strong>Concrete Contractor:</strong> wrong mix timing or spec errors can force replacement with no separate property damage.</li>
            <li><strong>Roofer:</strong> installation defects discovered pre-loss can still create major economic loss and delay cost.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Objection Handling</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>Objection:</strong> I never needed E and O before. <strong>Response:</strong> Most buyers realize the need only after a claim denial.</li>
            <li><strong>Objection:</strong> My work does not fail. <strong>Response:</strong> Exposure also comes from interpretation, sequencing, and recommendations.</li>
            <li><strong>Objection:</strong> If there is a loss, CGL will handle it. <strong>Response:</strong> CGL usually requires physical injury patterns that many contractor disputes do not meet.</li>
            <li><strong>Objection:</strong> I do not provide professional services. <strong>Response:</strong> Plan interpretation and field modifications are professional services.</li>
          </ul>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor says, I do not need E and O because I do not do design. What is the strongest response?"
          options={[
            { key: 'A', label: 'E and O is only for architects, so they are correct.' },
            { key: 'B', label: 'Contractors provide professional services through interpretation, recommendations, and field modifications.' },
            { key: 'C', label: 'CGL covers all mistakes anyway.' },
          ]}
          correctKey="B"
          explanation="Even without formal stamped design, contractors regularly perform professional services that can create economic-loss and professional-negligence exposure."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/3/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/3/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Proceed to Module Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
