export default function SecurityPage(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Security & Administration</h1>
        <p className="mt-2 text-slate-600">Manage user permissions, authentication, and security settings.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">User Permissions</h2>
          <p className="mt-1 text-sm text-slate-600">Manage user roles and access levels.</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Multi-Factor Authentication</h2>
          <p className="mt-1 text-sm text-slate-600">Configure MFA settings and recovery codes.</p>
        </div>
      </div>
    </div>
  );
}
