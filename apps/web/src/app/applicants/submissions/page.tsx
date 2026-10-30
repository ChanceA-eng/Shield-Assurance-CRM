export default function ApplicantsSubmissionsPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Submission Center</h1>
        <p className="mt-2 text-slate-600">Track and manage insurance submissions to carriers.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">No active submissions. Create an application and submit to carriers to see them here.</p>
      </div>
    </div>
  );
}
