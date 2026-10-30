import Link from 'next/link';

export default function ApplicantsPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Applicants & Quotes</h1>
        <p className="mt-2 text-slate-600">Manage applicant records, create new applications, and track quotes.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/personal/new"
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h2 className="text-lg font-semibold text-slate-900">Create Personal Applicant</h2>
          <p className="mt-1 text-sm text-slate-600">Start a new personal insurance application.</p>
        </Link>

        <Link
          href="/commercial/intake"
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h2 className="text-lg font-semibold text-slate-900">Create Commercial Applicant</h2>
          <p className="mt-1 text-sm text-slate-600">Start a new commercial insurance application.</p>
        </Link>

        <Link
          href="/clients"
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h2 className="text-lg font-semibold text-slate-900">Search Applicants</h2>
          <p className="mt-1 text-sm text-slate-600">Find and manage existing applicant records.</p>
        </Link>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Completed Quotes</h2>
          <p className="mt-1 text-sm text-slate-600">View quotes ready for client presentation.</p>
        </div>
      </div>
    </div>
  );
}
