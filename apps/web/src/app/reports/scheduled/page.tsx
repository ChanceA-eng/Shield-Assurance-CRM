export default function ReportsScheduledPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Scheduled Reports</h1>
        <p className="mt-2 text-slate-600">View reports scheduled for automatic delivery.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">No scheduled reports. Create a schedule to get started.</p>
      </div>
    </div>
  );
}
