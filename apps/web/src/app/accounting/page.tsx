export default function AccountingPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Accounting</h1>
        <p className="mt-2 text-slate-600">Manage billing, receivables, and financial reporting.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Billing</h2>
          <p className="mt-1 text-sm text-slate-600">View billing information and invoices.</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Receivables</h2>
          <p className="mt-1 text-sm text-slate-600">Track customer receivables and collections.</p>
        </div>
      </div>
    </div>
  );
}
