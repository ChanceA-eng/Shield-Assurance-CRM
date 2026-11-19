import { isRecord } from '../../lib/workspace-validation';

export default function IntakeDetailsSummary({ value }: { value: unknown }): JSX.Element | null {
  if (!isRecord(value) || !Array.isArray(value.sections)) return null;
  const sections = value.sections.filter(isRecord);
  if (!sections.length) return null;
  return <section aria-label="Saved applicant information" className="space-y-3">
    {sections.map((section, index) => <div key={index} className="rounded border border-cui-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{typeof section.title === 'string' ? section.title.replace(' (not issued coverage)', '') : 'Applicant information'}</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {Array.isArray(section.fields) ? section.fields.filter(isRecord).map((field, position) =>
          typeof field.label === 'string' && typeof field.value === 'string' ? <div key={position}>
            <dt className="text-xs text-cui-muted">{field.label}</dt><dd className="break-words">{field.value}</dd>
          </div> : null) : null}
      </dl>
    </div>)}
  </section>;
}
