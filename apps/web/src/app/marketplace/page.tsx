export default function MarketplacePage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Marketplace</h1>
        <p className="mt-2 text-slate-600">Discover and install integrations and add-ons for your agency.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Available Integrations</h2>
          <p className="mt-1 text-sm text-slate-600">Browse and install new integrations.</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">My Integrations</h2>
          <p className="mt-1 text-sm text-slate-600">View and manage your installed integrations.</p>
        </div>
      </div>
    </div>
  );
}
