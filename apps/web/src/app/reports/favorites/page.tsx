export default function ReportsFavoritesPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Favorite Reports</h1>
        <p className="mt-2 text-slate-600">Access your favorite and frequently used reports.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">No favorite reports yet. Visit Reports to save your favorites.</p>
      </div>
    </div>
  );
}
