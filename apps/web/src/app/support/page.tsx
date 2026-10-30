export default function SupportPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Help & Support</h1>
        <p className="mt-2 text-slate-600">Access support resources, documentation, and training.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Solution Center</h2>
          <p className="mt-1 text-sm text-slate-600">Search for answers and solutions.</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Training Resources</h2>
          <p className="mt-1 text-sm text-slate-600">Access training materials and tutorials.</p>
        </div>
      </div>
    </div>
  );
}
