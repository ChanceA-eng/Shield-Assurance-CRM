'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SectionLayout from '../../components/crm/SectionLayout';
import { workspacePages } from '../../lib/workspace-fetch';

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
	account_id: string;
	lead_id: string;
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
	carrier_confirmed: boolean;
	quote_id?: string | null;
	quote_version?: string | null;
	prior_policy_id?: string | null;
	insured_asset_ids?: string[];
}

interface InsuredAssetChoice { id: string; title: string; asset_type: string; value: string | null; metadata: Record<string, unknown> }

export default function PoliciesPage(): JSX.Element {
	return <Suspense fallback={<SectionLayout title="Policies"><p>Loading policy workspace...</p></SectionLayout>}><PoliciesContent /></Suspense>;
}

function PoliciesContent(): JSX.Element {
	const searchParams = useSearchParams();
	const requestedAccount = searchParams.get('account_id');
	const requestedLead = searchParams.get('lead_id');
	const requestedQuote = searchParams.get('quote_id');
	const requestedRenewal = searchParams.get('renew_from_id');
	const [quoteTerms, setQuoteTerms] = useState<{ limits: string; deductibles: string } | null>(null);
	const [renewalTerms, setRenewalTerms] = useState<{ policyNumber: string; expirationDate: string } | null>(null);
	const [insuredAssets, setInsuredAssets] = useState<InsuredAssetChoice[]>([]);
	const [selectedInsuredAssetIds, setSelectedInsuredAssetIds] = useState<string[]>([]);
	const [loadingInsuredAssets, setLoadingInsuredAssets] = useState(false);
	const [insuredAssetError, setInsuredAssetError] = useState('');
	const [insuredAssetRefresh, setInsuredAssetRefresh] = useState(0);
	const [prefilling, setPrefilling] = useState(false);
	const [accounts, setAccounts] = useState<Array<{ id: string; full_name: string; email?: string | null; phone?: string | null }>>([]);
	const [leads, setLeads] = useState<Array<{ id: string; full_name: string; email?: string | null }>>([]);
	const [accountSearch, setAccountSearch] = useState('');
	const [leadSearch, setLeadSearch] = useState('');
	const [requestId, setRequestId] = useState('');
	const [warning, setWarning] = useState<string | null>(null);
	const [policies, setPolicies] = useState<Policy[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showNewPolicy, setShowNewPolicy] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [isSavingEdit, setIsSavingEdit] = useState(false);
	const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
	const [newPolicy, setNewPolicy] = useState<NewPolicyForm>({
		account_id: '',
		lead_id: '',
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
		email_consent: false,
		sms_consent: false,
		status: 'issued',
		carrier_confirmed: false,
		prior_policy_id: null,
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

	useEffect(() => {
		if (!requestedAccount) return;
		const controller = new AbortController();
		setPrefilling(true);
		setError(null);
		const params = new URLSearchParams({ account_id: requestedAccount });
		if (requestedLead) params.set('lead_id', requestedLead);
		if (requestedQuote) params.set('quote_id', requestedQuote);
		if (requestedRenewal) params.set('renew_from_id', requestedRenewal);
		void fetch(`/api/policies/prefill?${params}`, { signal: controller.signal, cache: 'no-store' })
			.then(async (response) => {
				const payload = await response.json() as {
					message?: string; account_id: string; account_name: string; lead_id: string | null;
					insured_name: string; phone: string; email: string; address: string; line_of_business: string;
					quote_id?: string; quote_version?: string; carrier?: string; premium?: number | string;
					effective_date?: string | null; expiration_date?: string | null; limits?: string; deductibles?: string;
					prior_policy_id?: string; prior_policy_number?: string | null; prior_expiration_date?: string | null;
					source?: string; sub_type?: string | null;
				};
				if (!response.ok) throw new Error(payload.message || 'Policy prefill failed.');
				if (controller.signal.aborted) return;
				setNewPolicy((previous) => ({ ...previous, account_id: payload.account_id, lead_id: payload.lead_id ?? '',
					insured_name: payload.insured_name, phone: payload.phone, email: payload.email, address: payload.address,
					line_of_business: payload.quote_id || payload.prior_policy_id ? payload.line_of_business : ['Auto', 'Home', 'Life', 'Commercial'].includes(payload.line_of_business) ? payload.line_of_business : '',
					carrier: payload.carrier ?? '', premium: payload.premium === undefined ? '' : String(payload.premium),
					policy_number: '', effective_date: requestedRenewal ? '' : payload.effective_date ?? '',
					renewal_date: requestedRenewal ? '' : payload.expiration_date ?? '',
					quote_id: payload.quote_id ?? null, quote_version: payload.quote_version ?? null,
					prior_policy_id: payload.prior_policy_id ?? null,
					source: requestedRenewal ? 'Renewal' : 'Policy Issuance', email_consent: false, sms_consent: false, status: 'issued', carrier_confirmed: false }));
				setAccountSearch(payload.account_name);
				setQuoteTerms(payload.quote_id ? { limits: payload.limits ?? '', deductibles: payload.deductibles ?? '' } : null);
				setRenewalTerms(payload.prior_policy_id ? { policyNumber: payload.prior_policy_number ?? 'Previous term',
					expirationDate: payload.prior_expiration_date ?? '' } : null);
				setRequestId(crypto.randomUUID());
				setShowNewPolicy(true);
			}).catch((failure: unknown) => {
				if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Policy prefill failed.');
			}).finally(() => { if (!controller.signal.aborted) setPrefilling(false); });
		return () => controller.abort();
	}, [requestedAccount, requestedLead, requestedQuote, requestedRenewal]);

	useEffect(() => {
		if (!showNewPolicy) return;
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			void fetch(`/api/clients?q=${encodeURIComponent(accountSearch)}`, { signal: controller.signal })
				.then(async (res) => {
					if (!res.ok) throw new Error('Could not load accounts. Search and retry.');
					setAccounts(await res.json() as typeof accounts);
				}).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Account lookup failed.'); });
		}, 200);
		return () => { window.clearTimeout(timer); controller.abort(); };
	}, [showNewPolicy, accountSearch]);

	useEffect(() => {
		setLeads([]);
		if (!showNewPolicy || !newPolicy.account_id) return;
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			void fetch(`/api/policies/identity?account_id=${newPolicy.account_id}&q=${encodeURIComponent(leadSearch)}`, { signal: controller.signal })
				.then(async (res) => {
					if (!res.ok) throw new Error('Could not load eligible leads. Retry before completing a lead.');
					setLeads(await res.json() as typeof leads);
				}).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Lead lookup failed.'); });
		}, 200);
		return () => { window.clearTimeout(timer); controller.abort(); };
	}, [showNewPolicy, newPolicy.account_id, leadSearch]);

	useEffect(() => {
		if (!showNewPolicy || !newPolicy.account_id) { setInsuredAssets([]); setSelectedInsuredAssetIds([]); setInsuredAssetError(''); return; }
		const controller = new AbortController();
		setLoadingInsuredAssets(true);
		setInsuredAssetError('');
		void workspacePages<InsuredAssetChoice>(`/api/policies/insured-assets?account_id=${encodeURIComponent(newPolicy.account_id)}`, 100, 'page')
			.then((result) => { if (!controller.signal.aborted) setInsuredAssets(result); })
			.catch((failure: unknown) => { if (!controller.signal.aborted) setInsuredAssetError(failure instanceof Error ? failure.message : 'Account assets could not be loaded.'); })
			.finally(() => { if (!controller.signal.aborted) setLoadingInsuredAssets(false); });
		return () => controller.abort();
	}, [showNewPolicy, newPolicy.account_id, insuredAssetRefresh]);

	const handleCreatePolicy = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
		e.preventDefault();
		if (loadingInsuredAssets || insuredAssetError) {
			setError('Load the account asset list before recording this policy.');
			return;
		}
		if (!newPolicy.carrier_confirmed) {
			setError('Confirm carrier binding or issuance before saving this policy.');
			return;
		}
		setIsCreating(true);
		setError(null);

		try {
		const res = await fetch('/api/policies', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				...newPolicy,
				insured_asset_ids: selectedInsuredAssetIds,
				request_id: requestId,
				lead_id: newPolicy.lead_id || null,
				policyNumber: newPolicy.policy_number,
			}),
		});

		if (!res.ok) {
			const payload = (await res.json().catch(() => ({ message: 'Failed to create policy.' }))) as { message?: string };
			setError(payload.message ?? 'Failed to create policy.');
			setIsCreating(false);
			return;
		}

		const saved = await res.json() as { warnings?: string[] };
		setWarning(saved.warnings?.join(' ') || null);
		setShowNewPolicy(false);
		setQuoteTerms(null);
		setRenewalTerms(null);
		setSelectedInsuredAssetIds([]);
		setIsCreating(false);
		setNewPolicy({
			account_id: '',
			lead_id: '',
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
			email_consent: false,
			sms_consent: false,
			status: 'issued',
			carrier_confirmed: false,
			prior_policy_id: null,
		});
		await fetchPolicies();
		} catch {
			setError('Policy save could not be confirmed. Retry this form; the issuance ID prevents duplicate creation.');
		} finally {
			setIsCreating(false);
		}
	};

	const handleUpdatePolicy = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
		e.preventDefault();
		if (!editingPolicy) return;
		setIsSavingEdit(true);
		setError(null);

		try {
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

		const saved = await res.json() as { warnings?: string[] };
		setWarning(saved.warnings?.join(' ') || null);
		setIsSavingEdit(false);
		setEditingPolicy(null);
		await fetchPolicies();
		} catch {
			setError('Policy update could not be confirmed. Retry the update.');
		} finally {
			setIsSavingEdit(false);
		}
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
				<p className="text-sm text-[#5c6873]">Choose an existing account. Policy saves never change account contacts.</p>
				<button
					type="button"
					disabled={prefilling}
					onClick={() => { setRequestId(crypto.randomUUID()); setWarning(null); setNewPolicy((previous) => ({ ...previous, carrier_confirmed: false })); setShowNewPolicy(true); }}
					className="rounded border border-[#1b8eb7] bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7]"
				>
					+ New Policy
				</button>
			</div>

			{error ? <div role="alert" className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
			{prefilling ? <p role="status" className="mb-3 text-sm text-cui-muted">Loading the selected placement record...</p> : null}
			{warning ? <div role="status" className="mb-3 rounded border border-cui-warning bg-amber-50 px-3 py-2 text-sm">{warning}</div> : null}
			{loading ? <div className="text-sm text-[#73818f]">Loading policies...</div> : null}

			{!loading ? (
				<div className="rounded border border-[#c8ced3] bg-white shadow-sm">
					{policies.length === 0 ? (
						<div className="p-4 text-sm text-[#73818f]">No policies found.</div>
					) : (
						<table className="w-full text-left text-sm">
							<thead className="bg-[#f8f9fa] text-[#73818f]">
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
									<tr key={policy.id} className="border-t border-[#f0f3f5]">
										<td className="px-3 py-2 font-semibold text-[#20a8d8]">{policy.insured_name}</td>
										<td className="px-3 py-2">{policy.carrier}</td>
										<td className="px-3 py-2">{policy.line_of_business}</td>
										<td className="px-3 py-2">${policy.premium.toLocaleString()}</td>
										<td className="px-3 py-2">{policy.policy_number || '--'}</td>
										<td className="px-3 py-2">{policy.effective_date}</td>
										<td className="px-3 py-2">{policy.renewal_date}</td>
										<td className="px-3 py-2">{policy.status}</td>
										<td className="px-3 py-2 text-xs">
											<button type="button" className="mr-2 font-semibold text-[#167495] hover:underline" onClick={() => setEditingPolicy(policy)}>
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
					<div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded border border-[#c8ced3] bg-white p-4 shadow-xl">
						<h2 className="mb-3 text-lg font-bold text-[#23282c]">New Policy</h2>
						{newPolicy.quote_id ? <div className="mb-3 rounded border border-cui-primary/30 bg-cui-primary/5 p-3 text-xs">
							<p className="font-semibold">From selected quote — verify these details against carrier confirmation.</p>
							{quoteTerms?.limits ? <p className="mt-1 whitespace-pre-wrap">Quoted limits: {quoteTerms.limits}</p> : null}
							{quoteTerms?.deductibles ? <p className="mt-1 whitespace-pre-wrap">Quoted deductibles: {quoteTerms.deductibles}</p> : null}
							<p className="mt-1">Quote terms are retained as provenance, not a confirmed insured-asset schedule.</p>
						</div> : null}
						{newPolicy.prior_policy_id ? <div className="mb-3 rounded border border-cui-primary/30 bg-cui-primary/5 p-3 text-xs">
							<p className="font-semibold">Renewal from {renewalTerms?.policyNumber || 'previous policy term'}.</p>
							<p className="mt-1">Carrier, line and premium are copied for review only. Enter the new term dates and policy number from carrier confirmation; nothing here renews or binds coverage.</p>
							{renewalTerms?.expirationDate ? <p className="mt-1">Prior term expired {renewalTerms.expirationDate}.</p> : null}
						</div> : null}
						{error ? <p role="alert" className="mb-3 text-sm text-cui-danger">{error}</p> : null}
						<form onSubmit={handleCreatePolicy} className="space-y-2">
							<label className="block text-sm">Search accounts
								<input aria-label="Search accounts" className="w-full rounded border border-[#c8ced3] px-3 py-2" value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} />
							</label>
							<select required aria-label="Account" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.account_id} onChange={(e) => {
								const account = accounts.find((row) => row.id === e.target.value);
								setNewPolicy((prev) => ({ ...prev, account_id: e.target.value, lead_id: '', insured_name: account?.full_name ?? prev.insured_name, carrier_confirmed: false, quote_id: null, quote_version: null, prior_policy_id: null }));
								setRequestId(crypto.randomUUID()); setQuoteTerms(null); setRenewalTerms(null); setSelectedInsuredAssetIds([]);
							}}>
								<option value="">Select existing account</option>
								{newPolicy.account_id && !accounts.some((row) => row.id === newPolicy.account_id) ? <option value={newPolicy.account_id}>Selected account ({newPolicy.account_id})</option> : null}
								{accounts.map((account) => <option key={account.id} value={account.id}>{account.full_name} · {account.email || account.phone || account.id}</option>)}
							</select>
							<p className="text-xs text-[#73818f]">Create new accounts in Accounts first. Contact fields below belong only to this policy.</p>
							<input aria-label="Search leads to complete" placeholder="Search optional lead to complete" disabled={!newPolicy.account_id} className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} />
							<select aria-label="Lead to complete" disabled={!newPolicy.account_id} className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.lead_id} onChange={(e) => setNewPolicy((prev) => ({ ...prev, lead_id: e.target.value, carrier_confirmed: false }))}>
								<option value="">Do not complete a lead</option>
								{newPolicy.lead_id && !leads.some((row) => row.id === newPolicy.lead_id) ? <option value={newPolicy.lead_id}>Selected lead ({newPolicy.lead_id})</option> : null}
								{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.full_name} · {lead.email || lead.id}</option>)}
							</select>
							{newPolicy.lead_id ? <p className="text-xs text-[#73818f]">This selected lead will be linked to the account and marked Won in the same transaction.</p> : null}
							<fieldset className="rounded border border-cui-border p-3">
								<legend className="px-1 text-sm font-semibold text-cui-text">Insured assets for this policy term</legend>
								<p className="mb-2 text-xs text-cui-muted">Select only items confirmed on this carrier term. Account inventory remains separate and selecting an item does not change coverage.</p>
								{loadingInsuredAssets ? <p role="status" className="text-xs text-cui-muted">Loading account assets...</p> : null}
								{insuredAssetError ? <p role="alert" className="text-xs text-cui-danger">{insuredAssetError}
									<button type="button" className="ml-2 font-semibold underline" onClick={() => setInsuredAssetRefresh((value) => value + 1)}>Retry asset list</button>
								</p> : null}
								{!loadingInsuredAssets && insuredAssets.length === 0 ? <p className="text-xs text-cui-muted">No active account assets available. You can record the policy without a schedule.</p> : null}
								<div className="max-h-40 space-y-2 overflow-y-auto">
									{insuredAssets.map((asset) => <label key={asset.id} className="flex items-start gap-2 text-xs text-cui-text">
										<input type="checkbox" checked={selectedInsuredAssetIds.includes(asset.id)} onChange={(event) => setSelectedInsuredAssetIds((previous) =>
											event.target.checked ? [...previous, asset.id] : previous.filter((id) => id !== asset.id))} />
										<span><span className="font-semibold">{asset.title}</span> · {asset.asset_type}{asset.value ? ` · ${asset.value}` : ''}</span>
									</label>)}
								</div>
							</fieldset>
							<input required aria-label="Insured name" type="text" placeholder="Insured Name" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.insured_name} onChange={(e) => setNewPolicy((prev) => ({ ...prev, insured_name: e.target.value }))} />
							<input type="text" placeholder="Policy contact phone (optional)" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.phone} onChange={(e) => setNewPolicy((prev) => ({ ...prev, phone: e.target.value }))} />
							<input type="email" placeholder="Policy contact email (optional)" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.email} onChange={(e) => setNewPolicy((prev) => ({ ...prev, email: e.target.value }))} />
							<input type="text" placeholder="Policy address (optional)" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.address} onChange={(e) => setNewPolicy((prev) => ({ ...prev, address: e.target.value }))} />
							<input required type="text" placeholder="Source" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.source} onChange={(e) => setNewPolicy((prev) => ({ ...prev, source: e.target.value }))} />
							<input required type="text" placeholder="Carrier" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.carrier} onChange={(e) => setNewPolicy((prev) => ({ ...prev, carrier: e.target.value }))} />
							<select required aria-label="Line of business" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.line_of_business} onChange={(e) => setNewPolicy((prev) => ({ ...prev, line_of_business: e.target.value }))}>
								<option value="">Line of Business</option>
								{newPolicy.line_of_business && !['Auto', 'Home', 'Life', 'Commercial'].includes(newPolicy.line_of_business) ? <option value={newPolicy.line_of_business}>{newPolicy.line_of_business}</option> : null}
								<option value="Auto">Auto</option>
								<option value="Home">Home</option>
								<option value="Life">Life</option>
								<option value="Commercial">Commercial</option>
							</select>
							<input required type="number" placeholder="Premium" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.premium} onChange={(e) => setNewPolicy((prev) => ({ ...prev, premium: e.target.value }))} />
							<input name="policyNumber" required type="text" placeholder="Policy Number" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.policy_number} onChange={(e) => setNewPolicy((prev) => ({ ...prev, policy_number: e.target.value }))} />
							<input required aria-label="Effective date" type="date" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.effective_date} onChange={(e) => setNewPolicy((prev) => ({ ...prev, effective_date: e.target.value }))} />
							<input required aria-label="Expiration date" type="date" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={newPolicy.renewal_date} onChange={(e) => setNewPolicy((prev) => ({ ...prev, renewal_date: e.target.value }))} />
							<label className="flex items-start gap-2 text-sm text-cui-text">
								<input required type="checkbox" checked={newPolicy.carrier_confirmed} onChange={(e) => setNewPolicy((prev) => ({ ...prev, carrier_confirmed: e.target.checked }))} />
								Carrier binding or issuance confirmed. This records existing coverage; it does not bind coverage with the carrier.
							</label>

							<label className="flex items-center gap-2 text-sm text-[#5c6873]">
								<input type="checkbox" checked={newPolicy.email_consent} onChange={(e) => setNewPolicy((prev) => ({ ...prev, email_consent: e.target.checked }))} />
								Send this issuance confirmation by email (client consent verified).
							</label>

							<button type="submit" disabled={isCreating || loadingInsuredAssets || Boolean(insuredAssetError)} className="w-full rounded bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7] disabled:opacity-60">
								{isCreating ? 'Saving Policy...' : 'Save Policy'}
							</button>
							<button type="button" onClick={() => setShowNewPolicy(false)} className="w-full rounded bg-[#e4e5e6] px-3 py-2 text-sm font-semibold text-[#5c6873] hover:bg-[#c8ced3]">
								Cancel
							</button>
						</form>
					</div>
				</div>
			) : null}

			{editingPolicy ? (
				<div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
					<div className="w-full max-w-md rounded border border-[#c8ced3] bg-white p-4 shadow-xl">
						<h2 className="mb-3 text-lg font-bold text-[#23282c]">Edit Policy</h2>
						<form onSubmit={handleUpdatePolicy} className="space-y-2">
							<input required type="text" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={editingPolicy.insured_name} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, insured_name: e.target.value } : prev))} />
							<input required type="text" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={editingPolicy.carrier} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, carrier: e.target.value } : prev))} />
							<select required className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={editingPolicy.line_of_business} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, line_of_business: e.target.value } : prev))}>
								<option value="Auto">Auto</option>
								<option value="Home">Home</option>
								<option value="Life">Life</option>
								<option value="Commercial">Commercial</option>
							</select>
							<input required type="number" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={editingPolicy.premium} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, premium: Number(e.target.value) } : prev))} />
							<input name="policyNumber" required type="text" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={editingPolicy.policy_number || ''} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, policy_number: e.target.value } : prev))} />
							<input required type="date" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={editingPolicy.effective_date} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, effective_date: e.target.value } : prev))} />
							<input required type="date" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={editingPolicy.renewal_date} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, renewal_date: e.target.value } : prev))} />
							<input required type="text" className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm" value={editingPolicy.status} onChange={(e) => setEditingPolicy((prev) => (prev ? { ...prev, status: e.target.value } : prev))} />

							<button type="submit" disabled={isSavingEdit} className="w-full rounded bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7] disabled:opacity-60">
								{isSavingEdit ? 'Saving Changes...' : 'Save Changes'}
							</button>
							<button type="button" onClick={() => setEditingPolicy(null)} className="w-full rounded bg-[#e4e5e6] px-3 py-2 text-sm font-semibold text-[#5c6873] hover:bg-[#c8ced3]">
								Cancel
							</button>
						</form>
					</div>
				</div>
			) : null}
		</SectionLayout>
	);
}
