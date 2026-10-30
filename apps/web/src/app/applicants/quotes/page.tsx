export default function ApplicantsQuotesPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Completed Quotes</h1>
        <p className="mt-2 text-slate-600">View and manage all completed quotes ready for client presentation.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">No quotes available yet. Create a new application to get started.</p>
      </div>
    </div>
  );
}
