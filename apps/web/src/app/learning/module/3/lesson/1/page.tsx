import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleThreeLessonOnePage(): JSX.Element {
  return (
    <SectionLayout title="Module 3 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 3</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: Why Contractors Need E and O</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Contractors Professional Liability fills the most common gaps left by CGL, especially economic loss,
            design errors, professional negligence, and faulty workmanship without resulting damage.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson establishes why E and O is essential for modern contractor operations and where uninsured exposures develop.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: CGL Coverage Gap - Economic Loss and Faulty Workmanship]
        </div>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why CGL Alone Is Not Enough</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            CGL is designed for bodily injury and property damage accidents. It does not broadly cover pure economic harm or professional errors.
          </p>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Economic loss:</strong> delays, rework costs, and lost revenue with no physical injury.</li>
            <li><strong>Faulty work damage-to-self:</strong> work that fails but does not damage other property.</li>
            <li><strong>Design and specification errors:</strong> incorrect planning guidance and professional decisions.</li>
            <li><strong>Professional negligence:</strong> oversight and judgment failures in project execution.</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Source: IRMI construction risk analysis and ISO CG 00 01 framework.</p>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Economic Loss Examples - Delay, Rework, Cost Overruns]
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">Economic Loss Is the Core Exposure</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Economic loss is often the most frequent uninsured contractor exposure. It appears when a mistake causes financial harm,
            but no qualifying physical injury or property damage is present.
          </p>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Incorrect installation requiring removal and replacement.</li>
            <li>Plan misinterpretation causing schedule and occupancy delays.</li>
            <li>Cost overruns from professional sequencing or coordination errors.</li>
            <li>Material selection errors tied to professional recommendations.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Faulty Work Without Resulting Damage</h2>
          <p className="leading-relaxed text-slate-700">
            If work fails and only that work is damaged, CGL denial risk is high under business-risk exclusions. E and O is the intended lane
            for this type of performance-driven financial harm.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Design and Professional Services Exposure</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Many contractors perform incidental professional services without recognizing the liability that follows.
          </p>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Interpreting or modifying plans and specifications.</li>
            <li>Recommending methods, materials, or engineered alternatives.</li>
            <li>Project management decisions with direct cost and delay consequences.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Your CGL policy covers accidents, not most performance mistakes. When errors create financial loss without physical damage,
            E and O is the policy designed to respond.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor misinterprets a blueprint, causing a two-week delay and 45,000 dollars in lost revenue. No physical damage occurs. Which coverage lane is primary?"
          options={[
            { key: 'A', label: 'CGL Coverage A' },
            { key: 'B', label: 'Contractors E and O' },
            { key: 'C', label: 'No coverage applies by default' },
          ]}
          correctKey="B"
          explanation="Pure economic loss without bodily injury or qualifying property damage is generally outside CGL intent. Contractors E and O is the primary lane for professional-error financial harm."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/3/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
