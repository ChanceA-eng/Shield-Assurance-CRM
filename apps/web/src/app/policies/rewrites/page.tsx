export default function PoliciesRewritesPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Policy Rewrites</h1>
        <p className="mt-2 text-slate-600">Manage policy rewrite requests and tracking.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">No active rewrites. Create a rewrite request to get started.</p>
      </div>
    </div>
  );
}
