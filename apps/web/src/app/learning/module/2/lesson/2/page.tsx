import SectionLayout from '../../../../../../components/crm/SectionLayout';
import InteractiveKnowledgeCheck from '../../../../../../components/learning/InteractiveKnowledgeCheck';

export default function ModuleTwoLessonTwoPage(): JSX.Element {
  return (
    <SectionLayout title="Module 2 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 2</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: Coverage B - Personal and Advertising Injury</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Coverage B protects against non-physical injuries caused by specific offenses such as libel, slander, wrongful eviction,
            and copyright infringement in advertising. While Coverage A handles bodily injury and property damage, Coverage B handles
            reputational and communication-related harms.
          </p>
          <p className="leading-relaxed text-slate-700">
            Contractors trigger Coverage B less often, but when they do, losses can be severe. This lesson explains what Coverage B
            includes, what it excludes, and when contractor operations can create exposure.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Coverage B Covers</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Coverage B applies when the insured is legally obligated to pay damages because of a personal and advertising injury offense.
          </p>

          <ul className="space-y-4 text-base text-slate-700">
            <li>
              <strong>Libel or Slander:</strong> written or spoken statements that harm reputation.
              <span className="block text-xs text-slate-500">Source: ISO CG 00 01, Coverage B.</span>
            </li>
            <li><strong>Violation of Privacy:</strong> publishing private information without consent.</li>
            <li><strong>Wrongful Eviction or Entry:</strong> more common in premises contexts and less common for trade contractors.</li>
            <li><strong>Advertising Copyright Infringement:</strong> unauthorized use of protected logos, images, or content.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-slate-900">How Coverage B Applies to Contractors</h2>
          <p className="mb-4 leading-relaxed text-slate-700">Typical contractor triggers include:</p>

          <ul className="space-y-4 text-base text-slate-700">
            <li>Marketing campaigns that reuse protected images or branding without authorization.</li>
            <li>Public statements about competitors that could be treated as defamatory.</li>
            <li>Project promotions that include copyrighted materials without rights clearance.</li>
          </ul>

          <p className="mt-4 leading-relaxed text-slate-700">
            Coverage B does not apply to bodily injury, property damage, or faulty workmanship. Those exposures stay in Coverage A or E and O lanes.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Key Coverage B Exclusions</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Knowing Violation:</strong> intentional wrongdoing is excluded.</li>
            <li><strong>Material Published Before Policy Period:</strong> prior acts are typically excluded.</li>
            <li><strong>Contractual Liability:</strong> assumed liability by contract is limited.</li>
            <li><strong>Quality or Performance of Goods:</strong> performance claims are not the intent of Coverage B.</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Source: ISO CG 00 01, Coverage B exclusions.</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning: Marketing Liability Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Coverage B protects your company from non-physical communication injuries, such as copyright issues in advertising or
            statements that can be treated as defamation. It is not about job-site workmanship. It is about communication risk.
          </blockquote>
        </section>

        <InteractiveKnowledgeCheck
          question="A contractor uses a competitor's logo in a social media post without permission. Which coverage applies?"
          options={[
            { key: 'A', label: 'Coverage A - Bodily Injury and Property Damage' },
            { key: 'B', label: 'Coverage B - Personal and Advertising Injury' },
            { key: 'C', label: 'Contractors E and O' },
          ]}
          correctKey="B"
          explanation="Unauthorized use of a competitor's protected logo is an advertising copyright-type exposure. Under ISO CG 00 01, that is evaluated in Coverage B."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/2/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/2/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
