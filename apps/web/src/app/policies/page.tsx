'use client';

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

interface Policy {
	id: string;
	client_id: string;
	insured_name: string;
	carrier: string;
	line_of_business: string;
	premium: number;
	policy_number?: string | null;
	effective_date: string;
	renewal_date: string;
	status: string;
}

interface NewPolicyForm {
	insured_name: string;
	phone: string;
	email: string;
	address: string;
	source: string;
	carrier: string;
	line_of_business: string;
	premium: string;
	policy_number: string;
	effective_date: string;
	renewal_date: string;
	email_consent: boolean;
	sms_consent: boolean;
	status: 'issued';
}

export default function PoliciesPage(): JSX.Element {
	const [policies, setPolicies] = useState<Policy[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showNewPolicy, setShowNewPolicy] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [isSavingEdit, setIsSavingEdit] = useState(false);
	const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
	const [newPolicy, setNewPolicy] = useState<NewPolicyForm>({
		insured_name: '',
		phone: '',
		email: '',
		address: '',
		source: 'Policy Issuance',
		carrier: '',
		line_of_business: '',
		premium: '',
		policy_number: '',
		effective_date: '',
		renewal_date: '',
		email_consent: true,
		sms_consent: false,
		status: 'issued',
	});

	const fetchPolicies = async (): Promise<void> => {
		setLoading(true);
		setError(null);

		const res = await fetch('/api/policies', { cache: 'no-store' });
		if (!res.ok) {
			setError('Failed to load policies.');
			setLoading(false);
			return;
		}

		const data = (await res.json()) as Policy[];
		setPolicies(data);
		setLoading(false);
	};

	useEffect(() => {
		void fetchPolicies();
	}, []);

	const handleCreatePolicy = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
		e.preventDefault();
		setIsCreating(true);
		setError(null);

		const res = await fetch('/api/policies', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				...newPolicy,
				policyNumber: newPolicy.policy_number,
			}),
		});

		if (!res.ok) {
			const payload = (await res.json().catch(() => ({ message: 'Failed to create policy.' }))) as { message?: string };
			setError(payload.message ?? 'Failed to create policy.');
			setIsCreating(false);
			return;
		}

		setShowNewPolicy(false);
		setIsCreating(false);
		setNewPolicy({
			insured_name: '',
			phone: '',
			email: '',
			address: '',
			source: 'Policy Issuance',
			carrier: '',
			line_of_business: '',
			premium: '',
			policy_number: '',
			effective_date: '',
			renewal_date: '',
			email_consent: true,
			sms_consent: false,
			status: 'issued',
		});
		await fetchPolicies();
	};

	const handleUpdatePolicy = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
		e.preventDefault();
		if (!editingPolicy) return;
		setIsSavingEdit(true);
		setError(null);

		const res = await fetch('/api/policies', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: editingPolicy.id,
				insured_name: editingPolicy.insured_name,
				carrier: editingPolicy.carrier,
				line_of_business: editingPolicy.line_of_business,
				premium: editingPolicy.premium,
				policy_number: editingPolicy.policy_number || null,
				policyNumber: editingPolicy.policy_number || null,
				effective_date: editingPolicy.effective_date,
				renewal_date: editingPolicy.renewal_date,
				status: editingPolicy.status,
			}),
		});

		if (!res.ok) {
			const payload = (await res.json().catch(() => ({ message: 'Failed to update policy.' }))) as { message?: string };
			setError(payload.message ?? 'Failed to update policy.');
			setIsSavingEdit(false);
			return;
		}

		setIsSavingEdit(false);
		setEditingPolicy(null);
		await fetchPolicies();
	};

	const handleRemovePolicy = async (id: string): Promise<void> => {
		const confirmed = window.confirm('Remove this policy? This action cannot be undone.');
		if (!confirmed) return;

		const res = await fetch('/api/policies', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id }),
		});

		if (!res.ok) {
			const payload = (await res.json().catch(() => ({ message: 'Failed to remove policy.' }))) as { message?: string };
			setError(payload.message ?? 'Failed to remove policy.');
			return;
		}

		await fetchPolicies();
	};

	return (
		<SectionLayout title="Policies">
			<div className="mb-4 flex items-center justify-between">
				<p className="text-sm text-[#3e3e3c]">Policies auto-create and link clients when issued.</p>
				<button
					type="button"
					onClick={() => setShowNewPolicy(true)}
					className="rounded border border-[#0163b3] bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]"
				>
					+ New Policy
				</button>
			</div>

			{error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
			{loading ? <div className="text-sm text-[#6a6a6a]">Loading policies...</div> : null}

			{!loading ? (
				<div className="rounded border border-[#dddbda] bg-white shadow-sm">
					{policies.length === 0 ? (
						<div className="p-4 text-sm text-[#6a6a6a]">No policies found.</div>
					) : (
						<table className="w-full text-left text-sm">
							<thead className="bg-[#f8f8f7] text-[#6a6a6a]">
								<tr>
									<th className="px-3 py-2">Insured</th>
									<th className="px-3 py-2">Carrier</th>
									<th className="px-3 py-2">LOB</th>
									<th className="px-3 py-2">Premium</th>
									<th className="px-3 py-2">Policy Number</th>
									<th className="px-3 py-2">Effective</th>
									<th className="px-3 py-2">Renewal</th>
									<th className="px-3 py-2">Status</th>
									<th className="px-3 py-2">Actions</th>
								</tr>
							</thead>
							<tbody>
								{policies.map((policy) => (
									<tr key={policy.id} className="border-t border-[#f3f2f1]">
										<td className="px-3 py-2 font-semibold text-[#0176d3]">{policy.insured_name}</td>
										<td className="px-3 py-2">{policy.carrier}</td>
										<td className="px-3 py-2">{policy.line_of_business}</td>
										<td className="px-3 py-2">${policy.premium.toLocaleString()}</td>
										<td className="px-3 py-2">{policy.policy_number || '--'}</td>
										<td className="px-3 py-2">{policy.effective_date}</td>
										<td className="px-3 py-2">{policy.renewal_date}</td>
										<td className="px-3 py-2">{policy.status}</td>
										<td className="px-3 py-2 text-xs">
											<button type="button" className="mr-2 font-semibold text-[#0f62af] hover:underline" onClick={() => setEditingPolicy(policy)}>
												Edit
											</button>
											<button type="button" className="font-semibold text-[#c23934] hover:underline" onClick={() => void handleRemovePolicy(policy.id)}>
												Remove
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			) : null}

			{showNewPolicy ? (
				<div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
					<div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
						<h2 className="mb-3 text-lg font-bold text-[#080707]">New Policy</h2>
						<form onSubmit={handleCreatePolicy} className="space-y-2">
							<input required type="text" placeholder="Insured Name" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.insured_name} onChange={(e) => setNewPolicy((prev) => ({ ...prev, insured_name: e.target.value }))} />
							<input required type="text" placeholder="Phone" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.phone} onChange={(e) => setNewPolicy((prev) => ({ ...prev, phone: e.target.value }))} />
							<input required type="email" placeholder="Email" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.email} onChange={(e) => setNewPolicy((prev) => ({ ...prev, email: e.target.value }))} />
							<input required type="text" placeholder="Address" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.address} onChange={(e) => setNewPolicy((prev) => ({ ...prev, address: e.target.value }))} />
							<input required type="text" placeholder="Source" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.source} onChange={(e) => setNewPolicy((prev) => ({ ...prev, source: e.target.value }))} />
							<input required type="text" placeholder="Carrier" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.carrier} onChange={(e) => setNewPolicy((prev) => ({ ...prev, carrier: e.target.value }))} />
							<select required className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.line_of_business} onChange={(e) => setNewPolicy((prev) => ({ ...prev, line_of_business: e.target.value }))}>
								<option value="">Line of Business</option>
								<option value="Auto">Auto</option>
								<option value="Home">Home</option>
								<option value="Life">Life</option>
								<option value="Commercial">Commercial</option>
							</select>
							<input required type="number" placeholder="Premium" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.premium} onChange={(e) => setNewPolicy((prev) => ({ ...prev, premium: e.target.value }))} />
							<input name="policyNumber" required type="text" placeholder="Policy Number" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.policy_number} onChange={(e) => setNewPolicy((prev) => ({ ...prev, policy_number: e.target.value }))} />
							<input required type="date" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.effective_date} onChange={(e) => setNewPolicy((prev) => ({ ...prev, effective_date: e.target.value }))} />
							<input required type="date" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={newPolicy.renewal_date} onChange={(e) => setNewPolicy((prev) => ({ ...prev, renewal_date: e.target.value }))} />

							<label className="flex items-center gap-2 text-sm text-[#3e3e3c]">
								<input required type="checkbox" checked={newPolicy.email_consent} onChange={(e) => setNewPolicy((prev) => ({ ...prev, email_consent: e.target.checked }))} />
								Client consents to email updates.
							</label>

							<label className="flex items-center gap-2 text-sm text-[#3e3e3c]">
								<input type="checkbox" checked={newPolicy.sms_consent} onChange={(e) => setNewPolicy((prev) => ({ ...prev, sms_consent: e.target.checked }))} />
								Client consents to SMS updates.
							</label>

							<button type="submit" disabled={isCreating} className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60">
								{isCreating ? 'Saving Policy...' : 'Save Policy'}
							</button>
							<button type="button" onClick={() => setShowNewPolicy(false)} className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]">
								Cancel
							</button>
						</form>
					</div>
				</div>
			) : null}

			{editingPolicy ? (
				<div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
					<div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
						<h2 className="mb-3 text-lg font-bold text-[#080707]">Edit Policy</h2>
						<form onSubmit={handleUpdatePolicy} className="space-y-2">
							<input required type="text" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={editingPolicy.insured_name} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, insured_name: e.target.value } : prev))} />
							<input required type="text" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={editingPolicy.carrier} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, carrier: e.target.value } : prev))} />
							<select required className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={editingPolicy.line_of_business} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, line_of_business: e.target.value } : prev))}>
								<option value="Auto">Auto</option>
								<option value="Home">Home</option>
								<option value="Life">Life</option>
								<option value="Commercial">Commercial</option>
							</select>
							<input required type="number" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={editingPolicy.premium} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, premium: Number(e.target.value) } : prev))} />
							<input name="policyNumber" required type="text" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={editingPolicy.policy_number || ''} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, policy_number: e.target.value } : prev))} />
							<input required type="date" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={editingPolicy.effective_date} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, effective_date: e.target.value } : prev))} />
							<input required type="date" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={editingPolicy.renewal_date} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, renewal_date: e.target.value } : prev))} />
							<input required type="text" className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={editingPolicy.status} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, status: e.target.value } : prev))} />

							<button type="submit" disabled={isSavingEdit} className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60">
								{isSavingEdit ? 'Saving Changes...' : 'Save Changes'}
							</button>
							<button type="button" onClick={() => setEditingPolicy(null)} className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]">
								Cancel
							</button>
						</form>
					</div>
				</div>
			) : null}
		</SectionLayout>
	);
}
