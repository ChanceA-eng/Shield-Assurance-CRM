export default function ReportsSharedPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Shared Reports</h1>
        <p className="mt-2 text-slate-600">Access reports shared with you by other team members.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">No reports shared with you yet.</p>
      </div>
    </div>
  );
}
