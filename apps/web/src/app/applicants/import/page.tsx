export default function ApplicantsImportPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Import Applicants</h1>
        <p className="mt-2 text-slate-600">Import applicants from CSV, Excel, or other file formats.</p>
      </div>

      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center shadow-sm">
        <p className="text-slate-600">Upload your applicant file to import records in bulk.</p>
      </div>
    </div>
  );
}
