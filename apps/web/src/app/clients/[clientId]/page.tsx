'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import SectionLayout from '../../../components/crm/SectionLayout';

interface Client {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  source?: string | null;
  email_consent?: boolean | null;
  sms_consent?: boolean | null;
  preferred_channel?: string | null;
  created_at: string;
}

interface PolicyItem {
  id: string;
  client_id?: string | null;
  insured_name?: string | null;
  carrier?: string | null;
  line_of_business?: string | null;
  premium?: number | null;
  policy_number?: string | null;
  effective_date?: string | null;
  renewal_date?: string | null;
  status?: string | null;
  created_at?: string | null;
}

interface LeadItem {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  line_of_business?: string | null;
  source?: string | null;
  status?: string | null;
  created_at?: string | null;
}

interface CommunicationItem {
  id: string;
  client_id?: string | null;
  channel: 'email' | 'sms' | 'in_app';
  direction?: 'outbound' | 'inbound' | null;
  subject?: string | null;
  body?: string | null;
  sent_at?: string | null;
  automation_type?: string | null;
}

interface ScheduledMessage {
  id: string;
  client_id: string;
  send_at: string;
  channel: 'email' | 'sms';
  subject?: string | null;
  body: string;
  automation_type: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
}

interface TimelineTask {
  id: string;
  subject?: string | null;
  due_date?: string | null;
  status?: string | null;
}

interface EventItem {
  id: string;
  subject?: string | null;
  title?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  all_day?: boolean | null;
  status?: string | null;
}

interface ClaimItem {
  id: string;
  type?: string | null;
  status?: string | null;
  description?: string | null;
  date_of_loss?: string | null;
}

interface EndorsementItem {
  id: string;
  type?: string | null;
  status?: string | null;
  description?: string | null;
  effective_date?: string | null;
}

interface CertificateItem {
  id: string;
  certificate_holder?: string | null;
  status?: string | null;
  description?: string | null;
  issue_date?: string | null;
}

interface ClientAsset {
  id: string;
  title: string;
  asset_type: string;
  value?: string | null;
  metadata?: Record<string, unknown> | null;
  updated_at?: string | null;
}

interface ClientTask {
  id: string;
  subject: string;
  description?: string | null;
  due_date?: string | null;
  status?: string | null;
  priority?: string | null;
}

interface ClientFile {
  id: string;
  file_name: string;
  file_url?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  status?: string | null;
  uploaded_at?: string | null;
}

interface ClientTag {
  id: string;
  tag: string;
  color?: string | null;
}

interface ClientActivity {
  id: string;
  activity_type: string;
  title: string;
  body?: string | null;
  occurred_at?: string | null;
}

interface DeliveryAuditItem {
  msg_id: string;
  to_email?: string | null;
  from_email?: string | null;
  subject?: string | null;
  status: string;
  last_event_time?: string | null;
}

interface WorkspacePayload {
  client: Client;
  policies: PolicyItem[];
  leads: LeadItem[];
  communications: CommunicationItem[];
  scheduledMessages: ScheduledMessage[];
  notifications: Array<Record<string, unknown>>;
  timelineTasks: TimelineTask[];
  events: EventItem[];
  claims: ClaimItem[];
  endorsements: EndorsementItem[];
  certificates: CertificateItem[];
  assets: ClientAsset[];
  clientTasks: ClientTask[];
  files: ClientFile[];
  tags: ClientTag[];
  activities: ClientActivity[];
}

interface ComposerAttachment {
  filename: string;
  content: string;
  type?: string;
}

type ChannelFilter = 'email' | 'sms';
type ProfileTab = 'overview' | 'policies' | 'assets' | 'notes' | 'tasks' | 'files' | 'tags' | 'activity' | 'insights';
type ConversationTab = 'thread' | 'delivery';

type TimelineItem =
  | (CommunicationItem & { kind: 'communication' })
  | (ScheduledMessage & { kind: 'scheduled' });

const emptyComposer: {
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  sendAt: string;
  automationType: string;
} = {
  channel: 'email',
  subject: '',
  body: '',
  sendAt: '',
  automationType: 'manual',
};

const messageTemplates = [
  {
    key: 'onboarding',
    label: 'Onboarding Welcome',
    subject: 'Welcome to Shield Assurance',
    body: 'Thank you for choosing Shield Assurance. We are pleased to confirm your policy is active. Let us know if you need anything else.',
  },
  {
    key: 'renewal',
    label: 'Retention / Renewal Review',
    subject: 'Your Renewal Review',
    body: 'Your policy renewal is approaching. Let us schedule a quick five-minute review to make sure you are receiving every available discount.',
  },
  {
    key: 'docs',
    label: 'Document Request (ID/Prior Policy)',
    subject: 'Quick Document Request',
    body: 'To finalize your file setup, please reply with a clear photo of your driver license or prior declaration page.',
  },
];

const emptyAssetForm = {
  title: '',
  asset_type: 'general',
  value: '',
};

const emptyTaskForm = {
  subject: '',
  description: '',
  due_date: '',
  priority: 'medium',
};

const emptyFileForm = {
  file_name: '',
  file_url: '',
  file_type: 'PDF',
};

const emptyAssetEditForm = {
  title: '',
  asset_type: 'general',
  value: '',
};

const emptyTaskEditForm = {
  subject: '',
  description: '',
  due_date: '',
  status: 'open',
  priority: 'medium',
};

const emptyFileEditForm = {
  file_name: '',
  file_url: '',
  file_type: 'PDF',
  status: 'uploaded',
};

function safeDate(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function safeDateOnly(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function timeOnly(value?: string | null): string {
  if (!value) return 'All day';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function normalize(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

async function readFileAsBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Unable to read attachment file.'));
    reader.readAsDataURL(file);
  });
}

function formatCurrency(value?: number | null): string {
  if (typeof value !== 'number') return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function deriveLifecycleStage(input: { policies: PolicyItem[]; leads: LeadItem[] }): string {
  const renewalSoon = input.policies.some((policy) => {
    if (!policy.renewal_date) return false;
    const diff = new Date(policy.renewal_date).getTime() - Date.now();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 90;
  });
  if (renewalSoon) return 'Renewal';

  const bound = input.policies.some((policy) => ['issued', 'active', 'bound'].includes(normalize(policy.status)));
  if (bound) return 'Bound';

  if (input.leads.some((lead) => normalize(lead.status) === 'quoted')) return 'Quoted';
  if (input.leads.some((lead) => normalize(lead.status) === 'working')) return 'Prospect';
  return input.leads.length > 0 ? 'Lead' : 'Prospect';
}

function summarizeConversation(items: CommunicationItem[]): string {
  if (items.length === 0) {
    return 'No conversation history yet for this client.';
  }

  const recent = [...items]
    .sort((a, b) => new Date(b.sent_at ?? 0).getTime() - new Date(a.sent_at ?? 0).getTime())
    .slice(0, 6);

  const inbound = recent.filter((item) => item.direction === 'inbound').length;
  const outbound = recent.length - inbound;
  const channels = Array.from(new Set(recent.map((item) => item.channel))).join(', ');
  const latest = recent[0];

  return `Recent cadence: ${recent.length} touchpoints across ${channels || 'email'} (${inbound} inbound / ${outbound} outbound). Last interaction: ${safeDate(latest.sent_at)}.`;
}

function deriveRiskSignals(input: {
  policies: PolicyItem[];
  claims: ClaimItem[];
  tasks: ClientTask[];
  communications: CommunicationItem[];
}): string[] {
  const flags: string[] = [];

  const openClaims = input.claims.filter((claim) => normalize(claim.status) === 'open');
  if (openClaims.length > 0) {
    flags.push(`${openClaims.length} open claim${openClaims.length > 1 ? 's' : ''} need active servicing.`);
  }

  const overdueTasks = input.tasks.filter((task) => {
    if (normalize(task.status) === 'completed' || !task.due_date) return false;
    return new Date(task.due_date).getTime() < Date.now();
  });
  if (overdueTasks.length > 0) {
    flags.push(`${overdueTasks.length} overdue client task${overdueTasks.length > 1 ? 's' : ''}.`);
  }

  const renewals = input.policies.filter((policy) => {
    if (!policy.renewal_date) return false;
    const diff = new Date(policy.renewal_date).getTime() - Date.now();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 45;
  });
  if (renewals.length > 0) {
    flags.push(`${renewals.length} policy renewal${renewals.length > 1 ? 's' : ''} due in <= 45 days.`);
  }

  const inbound = input.communications.filter((item) => item.direction === 'inbound').length;
  const outbound = input.communications.filter((item) => item.direction !== 'inbound').length;
  if (inbound > outbound + 2) {
    flags.push('Inbound volume exceeds outbound follow-up; possible service backlog risk.');
  }

  if (flags.length === 0) {
    flags.push('No immediate underwriting or servicing flags detected from current CRM activity.');
  }

  return flags;
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default function ClientWorkspacePage(): JSX.Element {
  const params = useParams<{ clientId: string }>();
  const clientId = params.clientId;

  const [client, setClient] = useState<Client | null>(null);
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [communications, setCommunications] = useState<CommunicationItem[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [timelineTasks, setTimelineTasks] = useState<TimelineTask[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [notifications, setNotifications] = useState<Array<Record<string, unknown>>>([]);
  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [endorsements, setEndorsements] = useState<EndorsementItem[]>([]);
  const [certificates, setCertificates] = useState<CertificateItem[]>([]);

  const [assets, setAssets] = useState<ClientAsset[]>([]);
  const [clientTasks, setClientTasks] = useState<ClientTask[]>([]);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [tags, setTags] = useState<ClientTag[]>([]);
  const [activities, setActivities] = useState<ClientActivity[]>([]);

  const [deliveryAudit, setDeliveryAudit] = useState<DeliveryAuditItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timelineLimit, setTimelineLimit] = useState(120);
  const [activityLimit, setActivityLimit] = useState(80);

  const [profileTab, setProfileTab] = useState<ProfileTab>('overview');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('email');
  const [isConversationOpen, setIsConversationOpen] = useState(false);
  const [conversationTab, setConversationTab] = useState<ConversationTab>('thread');

  const [composer, setComposer] = useState(emptyComposer);
  const [savingMessage, setSavingMessage] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);

  const [assetForm, setAssetForm] = useState(emptyAssetForm);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [assetEditForm, setAssetEditForm] = useState(emptyAssetEditForm);
  const [noteBody, setNoteBody] = useState('');
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [editingClientTaskId, setEditingClientTaskId] = useState<string | null>(null);
  const [clientTaskEditForm, setClientTaskEditForm] = useState(emptyTaskEditForm);
  const [fileForm, setFileForm] = useState(emptyFileForm);
  const [selectedUploadName, setSelectedUploadName] = useState('');
  const [selectedUploadSize, setSelectedUploadSize] = useState<number | null>(null);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [fileEditForm, setFileEditForm] = useState(emptyFileEditForm);
  const [newTag, setNewTag] = useState('');

  const [aiSummary, setAiSummary] = useState('');
  const [aiRiskSignals, setAiRiskSignals] = useState<string[]>([]);
  const [runningAiAction, setRunningAiAction] = useState<'summary' | 'flags' | null>(null);
  const [draftingAiMessage, setDraftingAiMessage] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState('');
  const [selectedExistingFileIds, setSelectedExistingFileIds] = useState<string[]>([]);
  const [composerUploadFile, setComposerUploadFile] = useState<File | null>(null);

  const loadData = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const payload = await safeJson<WorkspacePayload>(
      `/api/clients/${clientId}/workspace?timelineLimit=${timelineLimit}&activityLimit=${activityLimit}`,
    );
    if (!payload) {
      setError('Failed to load client workspace.');
      setLoading(false);
      return;
    }

    setClient(payload.client);
    setPolicies(payload.policies ?? []);
    setLeads(payload.leads ?? []);
    setCommunications(payload.communications ?? []);
    setScheduledMessages(payload.scheduledMessages ?? []);
    setTimelineTasks(payload.timelineTasks ?? []);
    setEvents(payload.events ?? []);
    setNotifications(payload.notifications ?? []);
    setClaims(payload.claims ?? []);
    setEndorsements(payload.endorsements ?? []);
    setCertificates(payload.certificates ?? []);

    setAssets(payload.assets ?? []);
    setClientTasks(payload.clientTasks ?? []);
    setFiles(payload.files ?? []);
    setTags(payload.tags ?? []);
    setActivities(payload.activities ?? []);

    if (payload.client?.email) {
      const deliveryData = await safeJson<DeliveryAuditItem[]>(
        `/api/communication-log/delivery?to_email=${encodeURIComponent(payload.client.email)}&limit=25`,
      );
      setDeliveryAudit(deliveryData ?? []);
    } else {
      setDeliveryAudit([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (clientId) {
      void loadData();
    }
  }, [clientId, timelineLimit, activityLimit]);

  const lifecycleStage = useMemo(() => deriveLifecycleStage({ policies, leads }), [policies, leads]);

  const visibleClientTasks = useMemo<ClientTask[]>(() => {
    if (clientTasks.length > 0) return clientTasks;
    return timelineTasks.map((task) => ({
      id: task.id,
      subject: task.subject ?? 'Service task',
      due_date: task.due_date ?? null,
      status: task.status ?? 'open',
      priority: 'medium',
      description: null,
    }));
  }, [clientTasks, timelineTasks]);

  const usingLegacyTaskStore = clientTasks.length === 0 && timelineTasks.length > 0;

  const openClientTasks = useMemo(
    () => visibleClientTasks.filter((task) => normalize(task.status) !== 'completed'),
    [visibleClientTasks],
  );

  const notes = useMemo(
    () => assets.filter((item) => normalize(item.asset_type) === 'note'),
    [assets],
  );

  const commercialSubmissionAssets = useMemo(
    () => assets.filter((item) => normalize(item.asset_type) === 'commercial_intake' || normalize(item.asset_type) === 'commercial_quote'),
    [assets],
  );

  const personalSubmissionAssets = useMemo(
    () => assets.filter((item) => normalize(item.asset_type) === 'personal_submission'),
    [assets],
  );

  const preferredChannel = normalize(client?.preferred_channel);
  const emailCommunicationOn = Boolean(client?.email_consent) || preferredChannel === 'email' || preferredChannel === 'both';
  const smsCommunicationOn = Boolean(client?.sms_consent) || preferredChannel === 'sms' || preferredChannel === 'both';

  const timeline = useMemo<TimelineItem[]>(() => {
    const rows: TimelineItem[] = [
      ...communications
        .filter((item) => item.channel === 'email' || item.channel === 'sms')
        .map((item) => ({ ...item, kind: 'communication' as const })),
      ...scheduledMessages.map((item) => ({ ...item, kind: 'scheduled' as const })),
    ];

    const resolveTimestamp = (item: TimelineItem): string | null | undefined =>
      item.kind === 'communication' ? item.sent_at : item.send_at;

    return rows.sort((left, right) => {
      const leftDate = new Date(resolveTimestamp(left) ?? 0).getTime();
      const rightDate = new Date(resolveTimestamp(right) ?? 0).getTime();
      return rightDate - leftDate;
    });
    }, [communications, scheduledMessages]);

  const logActivity = async (activityType: string, title: string, body?: string): Promise<void> => {
    await fetch(`/api/clients/${clientId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activity_type: activityType,
        title,
        body: body || null,
      }),
    });
  };

  const sendManualMessage = async (): Promise<void> => {
    if (!client) return;
    if (composer.channel === 'email' && !emailCommunicationOn) {
      setError('This client has not consented to email messages.');
      return;
    }
    if (composer.channel === 'sms' && !smsCommunicationOn) {
      setError('This client has not consented to SMS messages.');
      return;
    }

    const selectedExistingFiles = files.filter((item) => selectedExistingFileIds.includes(item.id));

    if (composerUploadFile && composer.channel === 'sms') {
      setError('Local file uploads can only be attached to email. For SMS, use profile files with links.');
      return;
    }

    setSavingMessage(true);
    setError(null);

    const futureSend = composer.sendAt ? new Date(composer.sendAt).getTime() > Date.now() : false;
    if (futureSend && composerUploadFile) {
      setSavingMessage(false);
      setError('Local file uploads are only supported for Send Now. Schedule with profile file links instead.');
      return;
    }

    const linkedProfileFiles = selectedExistingFiles
      .filter((item) => item.file_url)
      .map((item) => ({ id: item.id, file_name: item.file_name, file_url: item.file_url as string }));

    const profileLinksBlock = linkedProfileFiles.length > 0
      ? `\n\nAttached client file links:\n${linkedProfileFiles.map((item) => `- ${item.file_name}: ${item.file_url}`).join('\n')}`
      : '';

    const messageBody = `${composer.body}${profileLinksBlock}`;

    let uploadAttachments: ComposerAttachment[] = [];
    if (!futureSend && composer.channel === 'email' && composerUploadFile) {
      const base64 = await readFileAsBase64(composerUploadFile);
      uploadAttachments = [
        {
          filename: composerUploadFile.name,
          content: base64,
          type: composerUploadFile.type || 'application/octet-stream',
        },
      ];
    }

    const endpoint = futureSend ? '/api/scheduled-messages' : '/api/communication-log';
    const payload = futureSend
      ? {
          client_id: client.id,
          send_at: new Date(composer.sendAt).toISOString(),
          channel: composer.channel,
          subject: composer.subject || null,
          body: messageBody,
          automation_type: composer.automationType || 'manual',
          status: 'pending',
        }
      : {
          client_id: client.id,
          channel: composer.channel,
          direction: 'outbound' as const,
          subject: composer.subject || null,
          body: messageBody,
          automation_type: composer.automationType || 'manual',
          attachments: uploadAttachments,
          profile_files: linkedProfileFiles,
        };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const payloadData = (await response.json().catch(() => ({ message: 'Message could not be saved.' }))) as {
        message?: string;
      };
      setError(payloadData.message ?? 'Message could not be saved.');
      setSavingMessage(false);
      return;
    }

    setComposer(emptyComposer);
    setActiveTemplate('');
    setComposerUploadFile(null);
    setSelectedExistingFileIds([]);
    setSavingMessage(false);
    await logActivity(
      futureSend ? 'message_scheduled' : 'message_sent',
      futureSend ? 'Scheduled outbound message' : 'Sent outbound message',
      composer.subject || composer.body,
    );
    await loadData();
  };

  const saveScheduledMessage = async (): Promise<void> => {
    if (!editingMessage) return;

    const response = await fetch('/api/scheduled-messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingMessage.id,
        send_at: editingMessage.send_at,
        channel: editingMessage.channel,
        subject: editingMessage.subject ?? null,
        body: editingMessage.body,
        automation_type: editingMessage.automation_type,
        status: editingMessage.status,
      }),
    });

    if (!response.ok) {
      const payloadData = (await response.json().catch(() => ({ message: 'Could not update the scheduled message.' }))) as {
        message?: string;
      };
      setError(payloadData.message ?? 'Could not update the scheduled message.');
      return;
    }

    await logActivity('message_update', 'Updated scheduled follow-up', editingMessage.subject ?? editingMessage.body);
    setEditingMessage(null);
    await loadData();
  };

  const cancelScheduledMessage = async (scheduledMessageId: string): Promise<void> => {
    const response = await fetch('/api/scheduled-messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: scheduledMessageId }),
    });

    if (!response.ok) {
      setError('Could not cancel the scheduled message.');
      return;
    }

    await logActivity('message_cancel', 'Cancelled scheduled follow-up');
    await loadData();
  };

  const createAsset = async (): Promise<void> => {
    if (!assetForm.title.trim()) return;

    const response = await fetch(`/api/clients/${clientId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assetForm),
    });

    if (!response.ok) {
      setError('Unable to create asset.');
      return;
    }

    await logActivity('asset_create', `Added asset: ${assetForm.title}`, assetForm.value || undefined);
    setAssetForm(emptyAssetForm);
    await loadData();
  };

  const deleteAsset = async (id: string): Promise<void> => {
    const response = await fetch(`/api/clients/${clientId}/assets`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) {
      setError('Unable to delete asset.');
      return;
    }

    await logActivity('asset_delete', 'Deleted client asset');
    await loadData();
  };

  const startAssetEdit = (asset: ClientAsset): void => {
    setEditingAssetId(asset.id);
    setAssetEditForm({
      title: asset.title,
      asset_type: asset.asset_type,
      value: asset.value ?? '',
    });
  };

  const saveAssetEdit = async (): Promise<void> => {
    if (!editingAssetId || !assetEditForm.title.trim()) return;

    const response = await fetch(`/api/clients/${clientId}/assets`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingAssetId,
        title: assetEditForm.title,
        asset_type: assetEditForm.asset_type,
        value: assetEditForm.value,
      }),
    });

    if (!response.ok) {
      setError('Unable to update asset.');
      return;
    }

    await logActivity('asset_update', `Updated asset: ${assetEditForm.title}`);
    setEditingAssetId(null);
    setAssetEditForm(emptyAssetEditForm);
    await loadData();
  };

  const createNote = async (): Promise<void> => {
    if (!noteBody.trim()) return;

    const response = await fetch(`/api/clients/${clientId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Internal Note',
        asset_type: 'note',
        value: noteBody,
      }),
    });

    if (!response.ok) {
      setError('Unable to save note.');
      return;
    }

    await logActivity('note_create', 'Added internal note', noteBody);
    setNoteBody('');
    await loadData();
  };

  const createClientTask = async (): Promise<void> => {
    if (!taskForm.subject.trim()) return;

    const response = await fetch(`/api/clients/${clientId}/client-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskForm),
    });

    if (!response.ok) {
      setError('Unable to create client task.');
      return;
    }

    await logActivity('task_create', `Created client task: ${taskForm.subject}`);
    setTaskForm(emptyTaskForm);
    await loadData();
  };

  const updateClientTaskStatus = async (task: ClientTask, status: 'open' | 'completed'): Promise<void> => {
    const response = await fetch(`/api/clients/${clientId}/client-tasks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: task.id,
        status,
      }),
    });

    if (!response.ok) {
      setError('Unable to update client task status.');
      return;
    }

    await logActivity('task_update', `Task marked ${status}: ${task.subject}`);
    await loadData();
  };

  const deleteClientTask = async (id: string): Promise<void> => {
    const response = await fetch(`/api/clients/${clientId}/client-tasks`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) {
      setError('Unable to delete client task.');
      return;
    }

    await logActivity('task_delete', 'Deleted client task');
    await loadData();
  };

  const startClientTaskEdit = (task: ClientTask): void => {
    setEditingClientTaskId(task.id);
    setClientTaskEditForm({
      subject: task.subject,
      description: task.description ?? '',
      due_date: task.due_date ? task.due_date.slice(0, 10) : '',
      status: task.status ?? 'open',
      priority: task.priority ?? 'medium',
    });
  };

  const saveClientTaskEdit = async (): Promise<void> => {
    if (!editingClientTaskId || !clientTaskEditForm.subject.trim()) return;

    const response = await fetch(`/api/clients/${clientId}/client-tasks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingClientTaskId,
        subject: clientTaskEditForm.subject,
        description: clientTaskEditForm.description,
        due_date: clientTaskEditForm.due_date || null,
        status: clientTaskEditForm.status,
        priority: clientTaskEditForm.priority,
      }),
    });

    if (!response.ok) {
      setError('Unable to update client task.');
      return;
    }

    await logActivity('task_update', `Updated client task: ${clientTaskEditForm.subject}`);
    setEditingClientTaskId(null);
    setClientTaskEditForm(emptyTaskEditForm);
    await loadData();
  };

  const createFileRecord = async (): Promise<void> => {
    if (!fileForm.file_name.trim()) return;

    const response = await fetch(`/api/clients/${clientId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...fileForm,
        file_size: selectedUploadSize,
        metadata: selectedUploadName ? { local_upload_name: selectedUploadName } : undefined,
      }),
    });

    if (!response.ok) {
      setError('Unable to create file record.');
      return;
    }

    await logActivity('file_create', `Added file record: ${fileForm.file_name}`);
    setFileForm(emptyFileForm);
    setSelectedUploadName('');
    setSelectedUploadSize(null);
    await loadData();
  };

  const deleteFileRecord = async (id: string): Promise<void> => {
    const response = await fetch(`/api/clients/${clientId}/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) {
      setError('Unable to delete file record.');
      return;
    }

    await logActivity('file_delete', 'Deleted file record');
    await loadData();
  };

  const startFileEdit = (file: ClientFile): void => {
    setEditingFileId(file.id);
    setFileEditForm({
      file_name: file.file_name,
      file_url: file.file_url ?? '',
      file_type: file.file_type ?? '',
      status: file.status ?? 'uploaded',
    });
  };

  const saveFileEdit = async (): Promise<void> => {
    if (!editingFileId || !fileEditForm.file_name.trim()) return;

    const response = await fetch(`/api/clients/${clientId}/files`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingFileId,
        file_name: fileEditForm.file_name,
        file_url: fileEditForm.file_url,
        file_type: fileEditForm.file_type,
        status: fileEditForm.status,
      }),
    });

    if (!response.ok) {
      setError('Unable to update file record.');
      return;
    }

    await logActivity('file_update', `Updated file: ${fileEditForm.file_name}`);
    setEditingFileId(null);
    setFileEditForm(emptyFileEditForm);
    await loadData();
  };

  const createTag = async (): Promise<void> => {
    const tag = newTag.trim();
    if (!tag) return;

    const response = await fetch(`/api/clients/${clientId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag }),
    });

    if (!response.ok) {
      setError('Unable to add tag.');
      return;
    }

    await logActivity('tag_create', `Added tag: ${tag}`);
    setNewTag('');
    await loadData();
  };

  const deleteTag = async (id: string): Promise<void> => {
    const response = await fetch(`/api/clients/${clientId}/tags`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) {
      setError('Unable to remove tag.');
      return;
    }

    await logActivity('tag_delete', 'Removed tag');
    await loadData();
  };

  const runConversationSummary = async (): Promise<void> => {
    setError(null);
    setRunningAiAction('summary');

    const response = await fetch(`/api/ai/summarize?clientId=${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payloadData = (await response.json().catch(() => ({ message: 'Unable to summarize conversation.' }))) as {
        message?: string;
      };
      setError(payloadData.message ?? 'Unable to summarize conversation.');
      setRunningAiAction(null);
      return;
    }

    const payloadData = (await response.json()) as { summary?: string };
    setAiSummary(payloadData.summary ?? summarizeConversation(communications));
    setRunningAiAction(null);
    await loadData();
  };

  const runRiskExtraction = async (): Promise<void> => {
    setError(null);
    setRunningAiAction('flags');

    const response = await fetch(`/api/ai/extract-flags?clientId=${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payloadData = (await response.json().catch(() => ({ message: 'Unable to extract underwriting flags.' }))) as {
        message?: string;
      };
      setError(payloadData.message ?? 'Unable to extract underwriting flags.');
      setRunningAiAction(null);
      return;
    }

    const payloadData = (await response.json()) as { flags?: string[] };
    setAiRiskSignals(payloadData.flags ?? deriveRiskSignals({ policies, claims, tasks: clientTasks, communications }));
    setRunningAiAction(null);
    await loadData();
  };

  const generateFollowUpTasks = async (): Promise<void> => {
    setProfileTab('tasks');
  };

  const draftMessageWithAi = async (): Promise<void> => {
    if (!composer.body.trim()) return;

    setDraftingAiMessage(true);
    setError(null);

    const response = await fetch(`/api/ai/draft-message?clientId=${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: composer.body,
        subject: composer.subject,
        channel: composer.channel,
      }),
    });

    if (!response.ok) {
      const payloadData = (await response.json().catch(() => ({ message: 'Unable to draft message.' }))) as {
        message?: string;
      };
      setDraftingAiMessage(false);
      setError(payloadData.message ?? 'Unable to draft message.');
      return;
    }

    const payloadData = (await response.json()) as { text?: string; subject?: string };
    setComposer((prev) => ({
      ...prev,
      subject: payloadData.subject ?? prev.subject,
      body: payloadData.text ?? prev.body,
    }));
    setDraftingAiMessage(false);
  };

  return (
    <SectionLayout title="Client">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/clients" className="text-sm font-semibold text-[#0176d3] hover:underline">
            Back to Clients
          </Link>
          <h2 className="mt-1 text-2xl font-bold text-[#080707]">{client?.full_name ?? 'Loading client workspace...'}</h2>
          <p className="text-sm text-[#3e3e3c]">
            {client?.email || '--'} · {client?.phone || '--'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-[#3e3e3c]">
          <span className="rounded-full bg-[#e3f2ff] px-3 py-1 font-semibold text-[#0a4f8f]">Email {emailCommunicationOn ? 'On' : 'Off'}</span>
          <span className="rounded-full bg-[#ecf8f1] px-3 py-1 font-semibold text-[#1f7a47]">SMS {smsCommunicationOn ? 'On' : 'Off'}</span>
          <span className="rounded-full bg-[#fff3de] px-3 py-1 font-semibold text-[#8a4d00]">Preferred: {client?.preferred_channel || 'email'}</span>
          <span className="rounded-full bg-[#edf4ff] px-3 py-1 font-semibold text-[#2f5c9f]">Lifecycle: {lifecycleStage}</span>
          <button
            type="button"
            className="rounded-full bg-[#0f62af] px-3 py-1 font-semibold text-white hover:bg-[#0a4f8f]"
            onClick={() => setIsConversationOpen((prev) => !prev)}
          >
            {isConversationOpen ? 'Close Conversation' : 'View Conversation'}
          </button>
        </div>
      </div>

      {error ? <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div> : null}
      {loading ? <div className="text-sm text-[#6a6a6a]">Loading client workspace...</div> : null}

      {!loading ? (
        <div className={`relative grid grid-cols-1 gap-4 transition-all duration-300 ${isConversationOpen ? 'xl:pr-[26rem]' : ''}`}>
          <section className="rounded border border-[#dddbda] bg-white shadow-sm">
            <div className="border-b border-[#f3f2f1] px-4 py-4">
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded border border-[#e8eef7] bg-[#f8fbff] p-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#60748a]">Policies</p>
                  <p className="text-xl font-semibold text-[#14324f]">{policies.length}</p>
                </div>
                <div className="rounded border border-[#e8eef7] bg-[#f8fbff] p-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#60748a]">Client Tasks</p>
                  <p className="text-xl font-semibold text-[#14324f]">{openClientTasks.length}</p>
                </div>
                <div className="rounded border border-[#e8eef7] bg-[#f8fbff] p-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#60748a]">Files</p>
                  <p className="text-xl font-semibold text-[#14324f]">{files.length}</p>
                </div>
                <div className="rounded border border-[#e8eef7] bg-[#f8fbff] p-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#60748a]">Tags</p>
                  <p className="text-xl font-semibold text-[#14324f]">{tags.length}</p>
                </div>
              </div>

              <section className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-amber-900">Underwriting Risk Analysis</h4>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      void runRiskExtraction();
                    }}
                    disabled={runningAiAction === 'flags'}
                    className="rounded bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                  >
                    {runningAiAction === 'flags' ? 'Extracting...' : 'Extract Underwriting Flags'}
                  </button>
                </div>
              </section>
            </div>

            <div className="border-b border-[#f3f2f1] px-3 py-2">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
                {([
                  ['overview', 'Overview'],
                  ['policies', 'Policies'],
                  ['assets', 'Assets'],
                  ['notes', 'Notes'],
                  ['tasks', 'Tasks'],
                  ['files', 'Files'],
                  ['tags', 'Tags'],
                  ['activity', 'Activity'],
                  ['insights', 'Rashi Insights'],
                ] as Array<[ProfileTab, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    data-tab={value}
                    type="button"
                    className={`w-full rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      profileTab === value ? 'bg-[#0176d3] text-white' : 'bg-[#f4f8ff] text-[#0f4a85] hover:bg-[#e7f1ff]'
                    }`}
                    onClick={() => setProfileTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-4">
              {profileTab === 'overview' ? (
                <div className="space-y-4">
                  <section className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-4">
                    <h4 className="text-sm font-semibold text-[#14324f]">Client Info</h4>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-[#425468] md:grid-cols-2">
                      <p>Name: {client?.full_name || '--'}</p>
                      <p>Email: {client?.email || '--'}</p>
                      <p>Phone: {client?.phone || '--'}</p>
                      <p>Address: {client?.address || '--'}</p>
                      <p>Business type: {leads[0]?.line_of_business || '--'}</p>
                      <p>State: --</p>
                    </div>
                  </section>

                  <section className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-4">
                    <h4 className="text-sm font-semibold text-[#14324f]">Submission Snapshot</h4>

                    {commercialSubmissionAssets.length === 0 && personalSubmissionAssets.length === 0 ? (
                      <p className="mt-2 text-sm text-[#6a6a6a]">No linked submission data yet.</p>
                    ) : null}

                    {commercialSubmissionAssets.map((asset) => {
                      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
                      return (
                        <article key={asset.id} className="mt-3 rounded border border-[#d8e3f0] bg-white p-3">
                          <p className="text-sm font-semibold text-[#14324f]">Commercial Submission</p>
                          <p className="text-xs text-[#60748a]">{asset.title}</p>
                          <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-[#425468] md:grid-cols-2">
                            <p>Industry: {String(metadata.industry_group ?? '--')}</p>
                            <p>NAICS: {String(metadata.naics_code ?? '--')}</p>
                            <p>FEIN: {String(metadata.fein ?? '--')}</p>
                            <p>Quote Status: {String(metadata.quote_status ?? '--')}</p>
                          </div>
                        </article>
                      );
                    })}

                    {personalSubmissionAssets.map((asset) => {
                      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
                      return (
                        <article key={asset.id} className="mt-3 rounded border border-[#d8e3f0] bg-white p-3">
                          <p className="text-sm font-semibold text-[#14324f]">Personal Submission</p>
                          <p className="text-xs text-[#60748a]">{asset.title}</p>
                          <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-[#425468] md:grid-cols-2">
                            <p>Current Carrier: {String(metadata.current_carrier ?? '--')}</p>
                            <p>Policy Expiration: {String(metadata.current_policy_expiration ?? '--')}</p>
                            <p>DOB: {String(metadata.dob ?? '--')}</p>
                            <p>Submission Id: {String(metadata.personal_account_id ?? '--')}</p>
                          </div>
                        </article>
                      );
                    })}
                  </section>
                </div>
              ) : null}

              {profileTab === 'policies' ? (
                <div className="space-y-3">
                  <p className="text-xs text-[#60748a]">Policy details stay in sync with the Policies page.</p>
                  {policies.length === 0 ? <p className="text-sm text-[#6a6a6a]">No linked policies.</p> : null}
                  {policies.map((policy) => (
                    <article key={policy.id} className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                      <p className="text-sm font-semibold text-[#14324f]">{policy.carrier || '--'} · {policy.line_of_business || 'Policy'}</p>
                      <p className="text-xs text-[#60748a]">
                        Premium {formatCurrency(policy.premium)} · Status {policy.status || '--'} · Policy # {policy.policy_number || '--'}
                      </p>
                      <p className="mt-1 text-xs text-[#425468]">Effective {safeDateOnly(policy.effective_date)} · Renewal {safeDateOnly(policy.renewal_date)}</p>
                    </article>
                  ))}
                </div>
              ) : null}

              {profileTab === 'assets' ? (
                <div className="space-y-4">
                  <section className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Add Client Asset</h4>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                      <input
                        className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="Asset title"
                        value={assetForm.title}
                        onChange={(e) => setAssetForm((prev) => ({ ...prev, title: e.target.value }))}
                      />
                      <input
                        className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="Asset type"
                        value={assetForm.asset_type}
                        onChange={(e) => setAssetForm((prev) => ({ ...prev, asset_type: e.target.value }))}
                      />
                      <input
                        className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="Asset details"
                        value={assetForm.value}
                        onChange={(e) => setAssetForm((prev) => ({ ...prev, value: e.target.value }))}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void createAsset()}
                      className="mt-2 rounded bg-[#0176d3] px-3 py-2 text-xs font-semibold text-white"
                    >
                      Save Asset
                    </button>
                  </section>

                  <section className="space-y-2">
                    {assets.filter((item) => normalize(item.asset_type) !== 'note').length === 0 ? (
                      <p className="text-sm text-[#6a6a6a]">No assets yet.</p>
                    ) : null}
                    {assets
                      .filter((item) => normalize(item.asset_type) !== 'note')
                      .map((asset) => (
                        <article key={asset.id} className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                          {editingAssetId === asset.id ? (
                            <div className="space-y-2">
                              <input
                                className="w-full rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                                value={assetEditForm.title}
                                onChange={(e) => setAssetEditForm((prev) => ({ ...prev, title: e.target.value }))}
                              />
                              <input
                                className="w-full rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                                value={assetEditForm.asset_type}
                                onChange={(e) => setAssetEditForm((prev) => ({ ...prev, asset_type: e.target.value }))}
                              />
                              <input
                                className="w-full rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                                value={assetEditForm.value}
                                onChange={(e) => setAssetEditForm((prev) => ({ ...prev, value: e.target.value }))}
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  className="rounded bg-[#0176d3] px-3 py-1.5 text-xs font-semibold text-white"
                                  onClick={() => void saveAssetEdit()}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="rounded bg-[#e5e5e5] px-3 py-1.5 text-xs font-semibold text-[#3e3e3c]"
                                  onClick={() => setEditingAssetId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm font-semibold text-[#14324f]">{asset.title}</p>
                              <p className="text-xs text-[#60748a]">{asset.asset_type} · {safeDate(asset.updated_at)}</p>
                              <p className="mt-1 text-sm text-[#425468]">{asset.value || '--'}</p>
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  className="rounded bg-[#e7f2ff] px-3 py-1.5 text-xs font-semibold text-[#0a4f8f]"
                                  onClick={() => startAssetEdit(asset)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="rounded bg-[#ffe8e8] px-3 py-1.5 text-xs font-semibold text-[#9f2f2f]"
                                  onClick={() => void deleteAsset(asset.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </>
                          )}
                        </article>
                      ))}
                  </section>
                </div>
              ) : null}

              {profileTab === 'notes' ? (
                <div className="space-y-4">
                  <section className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Internal Notes</h4>
                    <textarea
                      className="mt-2 min-h-24 w-full rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                      placeholder="Add internal note"
                      value={noteBody}
                      onChange={(e) => setNoteBody(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => void createNote()}
                      className="mt-2 rounded bg-[#0176d3] px-3 py-2 text-xs font-semibold text-white"
                    >
                      Save Note
                    </button>
                  </section>

                  {notes.length === 0 ? <p className="text-sm text-[#6a6a6a]">No notes yet.</p> : null}
                  {notes.map((note) => (
                    <article key={note.id} className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                      <p className="text-xs text-[#60748a]">{safeDate(note.updated_at)}</p>
                      <p className="mt-1 whitespace-pre-line text-sm text-[#425468]">{note.value || '--'}</p>
                      <button
                        type="button"
                        className="mt-2 rounded bg-[#ffe8e8] px-3 py-1.5 text-xs font-semibold text-[#9f2f2f]"
                        onClick={() => void deleteAsset(note.id)}
                      >
                        Delete
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}

              {profileTab === 'tasks' ? (
                <div className="space-y-4">
                  <section className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Create Client Task</h4>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <input
                        className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="Task subject"
                        value={taskForm.subject}
                        onChange={(e) => setTaskForm((prev) => ({ ...prev, subject: e.target.value }))}
                      />
                      <input
                        className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                        type="date"
                        value={taskForm.due_date}
                        onChange={(e) => setTaskForm((prev) => ({ ...prev, due_date: e.target.value }))}
                      />
                      <input
                        className="rounded border border-[#d8e3f0] px-3 py-2 text-sm md:col-span-2"
                        placeholder="Description"
                        value={taskForm.description}
                        onChange={(e) => setTaskForm((prev) => ({ ...prev, description: e.target.value }))}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void createClientTask()}
                      className="mt-2 rounded bg-[#0176d3] px-3 py-2 text-xs font-semibold text-white"
                    >
                      Save Task
                    </button>
                  </section>

                  {visibleClientTasks.length === 0 ? <p className="text-sm text-[#6a6a6a]">No client tasks yet.</p> : null}
                  {usingLegacyTaskStore ? (
                    <p className="text-xs text-[#60748a]">Showing tasks from the standard task store for this client.</p>
                  ) : null}
                  {visibleClientTasks.map((task) => (
                    <article key={task.id} className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                      {editingClientTaskId === task.id ? (
                        <div className="space-y-2">
                          <input
                            className="w-full rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                            value={clientTaskEditForm.subject}
                            onChange={(e) => setClientTaskEditForm((prev) => ({ ...prev, subject: e.target.value }))}
                          />
                          <input
                            className="w-full rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                            value={clientTaskEditForm.description}
                            onChange={(e) => setClientTaskEditForm((prev) => ({ ...prev, description: e.target.value }))}
                          />
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                              type="date"
                              value={clientTaskEditForm.due_date}
                              onChange={(e) => setClientTaskEditForm((prev) => ({ ...prev, due_date: e.target.value }))}
                            />
                            <select
                              className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                              value={clientTaskEditForm.status}
                              onChange={(e) => setClientTaskEditForm((prev) => ({ ...prev, status: e.target.value }))}
                            >
                              <option value="open">Open</option>
                              <option value="completed">Completed</option>
                            </select>
                            <select
                              className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                              value={clientTaskEditForm.priority}
                              onChange={(e) => setClientTaskEditForm((prev) => ({ ...prev, priority: e.target.value }))}
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded bg-[#0176d3] px-3 py-1.5 text-xs font-semibold text-white"
                              onClick={() => void saveClientTaskEdit()}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="rounded bg-[#e5e5e5] px-3 py-1.5 text-xs font-semibold text-[#3e3e3c]"
                              onClick={() => setEditingClientTaskId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-[#14324f]">{task.subject}</p>
                          <p className="text-xs text-[#60748a]">Due {safeDateOnly(task.due_date)} · {task.status || 'open'} · {task.priority || 'medium'}</p>
                          {task.description ? <p className="mt-1 text-sm text-[#425468]">{task.description}</p> : null}
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              className="rounded bg-[#e7f2ff] px-3 py-1.5 text-xs font-semibold text-[#0a4f8f]"
                              disabled={usingLegacyTaskStore}
                              onClick={() => void updateClientTaskStatus(task, normalize(task.status) === 'completed' ? 'open' : 'completed')}
                            >
                              {normalize(task.status) === 'completed' ? 'Reopen' : 'Complete'}
                            </button>
                            <button
                              type="button"
                              className="rounded bg-[#e7f2ff] px-3 py-1.5 text-xs font-semibold text-[#0a4f8f]"
                              disabled={usingLegacyTaskStore}
                              onClick={() => startClientTaskEdit(task)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="rounded bg-[#ffe8e8] px-3 py-1.5 text-xs font-semibold text-[#9f2f2f]"
                              disabled={usingLegacyTaskStore}
                              onClick={() => void deleteClientTask(task.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              ) : null}

              {profileTab === 'files' ? (
                <div className="space-y-4">
                  <section className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Add File Record</h4>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                      <input
                        className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="File name"
                        value={fileForm.file_name}
                        onChange={(e) => setFileForm((prev) => ({ ...prev, file_name: e.target.value }))}
                      />
                      <input
                        className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="File URL"
                        value={fileForm.file_url}
                        onChange={(e) => setFileForm((prev) => ({ ...prev, file_url: e.target.value }))}
                      />
                      <select
                        className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                        value={fileForm.file_type}
                        onChange={(e) => setFileForm((prev) => ({ ...prev, file_type: e.target.value }))}
                      >
                        <option value="PDF">PDF Document (Policy, Accord)</option>
                        <option value="IMAGE">Image / Photo (License, Registration)</option>
                        <option value="WORD">Word Document</option>
                        <option value="OTHER">Other Reference File</option>
                      </select>
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        className="cursor-pointer rounded border border-dashed border-[#bfd2e8] bg-[#f8fbff] px-3 py-2 text-sm md:col-span-3"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) {
                            setSelectedUploadName('');
                            setSelectedUploadSize(null);
                            return;
                          }

                          const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
                          const inferredType = file.type.includes('pdf') || extension === 'pdf'
                            ? 'PDF'
                            : file.type.startsWith('image/')
                              ? 'IMAGE'
                              : file.type.includes('word') || extension === 'doc' || extension === 'docx'
                                ? 'WORD'
                                : 'OTHER';

                          setSelectedUploadName(file.name);
                          setSelectedUploadSize(file.size);
                          setFileForm((prev) => ({
                            ...prev,
                            file_name: file.name,
                            file_type: inferredType,
                            file_url: prev.file_url || `local-upload://${file.name}`,
                          }));
                        }}
                      />
                    </div>
                    {selectedUploadName ? (
                      <p className="mt-2 text-xs text-[#60748a]">
                        Selected: {selectedUploadName}
                        {typeof selectedUploadSize === 'number' ? ` (${Math.ceil(selectedUploadSize / 1024)} KB)` : ''}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void createFileRecord()}
                      className="mt-2 rounded bg-[#0176d3] px-3 py-2 text-xs font-semibold text-white"
                    >
                      Save File
                    </button>
                  </section>

                  {files.length === 0 ? <p className="text-sm text-[#6a6a6a]">No file records yet.</p> : null}
                  {files.map((item) => (
                    <article key={item.id} className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                      {editingFileId === item.id ? (
                        <div className="space-y-2">
                          <input
                            className="w-full rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                            value={fileEditForm.file_name}
                            onChange={(e) => setFileEditForm((prev) => ({ ...prev, file_name: e.target.value }))}
                          />
                          <input
                            className="w-full rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                            value={fileEditForm.file_url}
                            onChange={(e) => setFileEditForm((prev) => ({ ...prev, file_url: e.target.value }))}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                              value={fileEditForm.file_type}
                              onChange={(e) => setFileEditForm((prev) => ({ ...prev, file_type: e.target.value }))}
                            />
                            <input
                              className="rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                              value={fileEditForm.status}
                              onChange={(e) => setFileEditForm((prev) => ({ ...prev, status: e.target.value }))}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded bg-[#0176d3] px-3 py-1.5 text-xs font-semibold text-white"
                              onClick={() => void saveFileEdit()}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="rounded bg-[#e5e5e5] px-3 py-1.5 text-xs font-semibold text-[#3e3e3c]"
                              onClick={() => setEditingFileId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-[#14324f]">{item.file_name}</p>
                          <p className="text-xs text-[#60748a]">{item.file_type || '--'} · {item.status || 'uploaded'} · {safeDate(item.uploaded_at)}</p>
                          {item.file_url ? (
                            <a href={item.file_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-[#0176d3] hover:underline">
                              Open file
                            </a>
                          ) : null}
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              className="rounded bg-[#e7f2ff] px-3 py-1.5 text-xs font-semibold text-[#0a4f8f]"
                              onClick={() => startFileEdit(item)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="rounded bg-[#ffe8e8] px-3 py-1.5 text-xs font-semibold text-[#9f2f2f]"
                              onClick={() => void deleteFileRecord(item.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              ) : null}

              {profileTab === 'tags' ? (
                <div className="space-y-3">
                  <section className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Add Tag</h4>
                    <div className="mt-2 flex gap-2">
                      <input
                        className="w-full rounded border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="Tag"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => void createTag()}
                        className="rounded bg-[#0176d3] px-3 py-2 text-xs font-semibold text-white"
                      >
                        Add
                      </button>
                    </div>
                  </section>

                  <div className="flex flex-wrap gap-2">
                    {tags.length === 0 ? <p className="text-sm text-[#6a6a6a]">No tags yet.</p> : null}
                    {tags.map((tag) => (
                      <span key={tag.id} className="inline-flex items-center gap-2 rounded-full bg-[#eef4fd] px-3 py-1 text-xs font-semibold text-[#1f4b7d]">
                        {tag.tag}
                        <button
                          type="button"
                          className="text-[#9f2f2f]"
                          onClick={() => void deleteTag(tag.id)}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {profileTab === 'activity' ? (
                <div className="space-y-2">
                  {activities.length === 0 ? <p className="text-sm text-[#6a6a6a]">No client activity entries yet.</p> : null}
                  {activities.map((item) => (
                    <article key={item.id} className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#60748a]">{item.activity_type}</p>
                      <p className="text-sm font-semibold text-[#14324f]">{item.title}</p>
                      {item.body ? <p className="mt-1 whitespace-pre-line text-sm text-[#425468]">{item.body}</p> : null}
                      <p className="mt-1 text-xs text-[#60748a]">{safeDate(item.occurred_at)}</p>
                    </article>
                  ))}
                  {activities.length >= activityLimit ? (
                    <button
                      type="button"
                      className="mt-2 rounded bg-[#e7f2ff] px-3 py-1.5 text-xs font-semibold text-[#0a4f8f]"
                      onClick={() => setActivityLimit((prev) => prev + 80)}
                    >
                      Load more activity
                    </button>
                  ) : null}
                </div>
              ) : null}

              {profileTab === 'insights' ? (
                <div className="space-y-4">
                  <section className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Underwriting Risk Flags</h4>
                    <button
                      type="button"
                      className="mt-2 rounded bg-[#fff3de] px-3 py-2 text-xs font-semibold text-[#8a4d00]"
                      onClick={() => void runRiskExtraction()}
                    >
                      Extract risk profile
                    </button>
                    <div className="mt-2 space-y-1">
                      {aiRiskSignals.length === 0 ? <p className="text-sm text-[#6a6a6a]">Run extraction to view current flags.</p> : null}
                      {aiRiskSignals.map((flag) => (
                        <p key={flag} className="text-sm text-[#425468]">• {flag}</p>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-lg border border-[#edf2f8] bg-[#fbfdff] p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Service Items Snapshot</h4>
                    <p className="mt-1 text-sm text-[#425468]">
                      Claims {claims.length} · Endorsements {endorsements.length} · Certificates {certificates.length}
                    </p>
                  </section>
                </div>
              ) : null}
            </div>
          </section>

          <aside
            className={`fixed right-0 top-0 z-40 h-full w-full max-w-[26rem] transform border-l border-[#dddbda] bg-white shadow-2xl transition-transform duration-300 ${
              isConversationOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="flex h-full flex-col">
              <div className="border-b border-[#f3f2f1] px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-[#080707]">Client Conversation</h3>
                  <button
                    type="button"
                    className="rounded bg-[#e8eef7] px-2 py-1 text-xs font-semibold text-[#35506d]"
                    onClick={() => setIsConversationOpen(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      conversationTab === 'thread' ? 'bg-[#0176d3] text-white' : 'bg-[#eff5ff] text-[#0a4f8f]'
                    }`}
                    onClick={() => setConversationTab('thread')}
                  >
                    Conversation
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      conversationTab === 'delivery' ? 'bg-[#0176d3] text-white' : 'bg-[#eff5ff] text-[#0a4f8f]'
                    }`}
                    onClick={() => setConversationTab('delivery')}
                  >
                    Delivery
                  </button>
                </div>

                {conversationTab === 'thread' ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          channelFilter === 'email' ? 'bg-[#0f62af] text-white' : 'bg-[#e7f2ff] text-[#0a4f8f]'
                        }`}
                        onClick={() => setChannelFilter('email')}
                      >
                        Email
                      </button>
                      <button
                        type="button"
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          channelFilter === 'sms' ? 'bg-[#0f62af] text-white' : 'bg-[#e7f2ff] text-[#0a4f8f]'
                        }`}
                        onClick={() => setChannelFilter('sms')}
                      >
                        SMS
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-2">
                      <button
                        type="button"
                        className="rounded bg-[#0f62af] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0a4f8f] disabled:opacity-60"
                        disabled={runningAiAction === 'summary'}
                        onClick={(e) => {
                          e.preventDefault();
                          void runConversationSummary();
                        }}
                      >
                        {runningAiAction === 'summary' ? 'Summarizing...' : 'Summarize Chat'}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                        onClick={(e) => {
                          e.preventDefault();
                          void generateFollowUpTasks();
                        }}
                      >
                        + Add Task
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {conversationTab === 'thread' ? (
                  <div className="space-y-3">
                    {aiSummary ? (
                      <section className="rounded-lg border border-[#dbe8f7] bg-[#f5f9ff] p-3">
                        <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4e6a85]">Conversation Summary</h4>
                        <p className="mt-1 text-sm text-[#35506d]">{aiSummary}</p>
                      </section>
                    ) : null}

                    {timeline
                      .filter((item) => item.channel === channelFilter)
                      .map((item) => {
                        const timestamp = item.kind === 'communication' ? item.sent_at : item.send_at;

                        const label = item.kind === 'communication' ? (item.channel === 'sms' ? 'SMS' : 'Email') : 'Scheduled';

                        const headline =
                          item.kind === 'communication'
                            ? item.subject || item.automation_type || 'Message'
                            : item.subject || item.automation_type || 'Scheduled follow-up';

                        return (
                          <article key={`${item.kind}-${item.id}`} className="rounded-xl border border-[#e8eef7] bg-[#fbfdff] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#60748a]">
                                  {label} {item.kind === 'communication' && item.direction === 'inbound' ? 'Inbound' : ''}
                                </p>
                                <h4 className="truncate text-sm font-semibold text-[#14324f]">{headline}</h4>
                                <p className="mt-1 whitespace-pre-line text-sm text-[#425468]">{item.body}</p>
                              </div>
                              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-[#0a4f8f] shadow-sm">{safeDate(timestamp)}</span>
                            </div>
                            {item.kind === 'scheduled' ? (
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  className="rounded bg-[#e7f2ff] px-3 py-1.5 text-xs font-semibold text-[#0a4f8f]"
                                  onClick={() => setEditingMessage(item)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="rounded bg-[#ffe8e8] px-3 py-1.5 text-xs font-semibold text-[#9f2f2f]"
                                  onClick={() => void cancelScheduledMessage(item.id)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}

                    {timeline.length >= timelineLimit ? (
                      <button
                        type="button"
                        className="rounded bg-[#e7f2ff] px-3 py-1.5 text-xs font-semibold text-[#0a4f8f]"
                        onClick={() => setTimelineLimit((prev) => prev + 80)}
                      >
                        Load more history
                      </button>
                    ) : null}

                    <section className="rounded border border-[#dddbda] bg-white p-4 shadow-sm">
                      <h3 className="text-base font-semibold text-[#080707]">Send Message</h3>
                      <p className="mb-3 text-xs text-[#6a6a6a]">Send now or schedule a follow-up message.</p>
                      <div className="space-y-2">
                        <select
                          className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                          value={composer.channel}
                          onChange={(e) => setComposer((prev) => ({ ...prev, channel: e.target.value as 'email' | 'sms' }))}
                        >
                          <option value="email">Email</option>
                          <option value="sms">SMS</option>
                        </select>
                        <select
                          className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                          value={activeTemplate}
                          onChange={(e) => {
                            const key = e.target.value;
                            setActiveTemplate(key);
                            const template = messageTemplates.find((item) => item.key === key);
                            if (!template) return;
                            setComposer((prev) => ({
                              ...prev,
                              subject: template.subject,
                              body: template.body,
                            }));
                          }}
                        >
                          <option value="">Use a template</option>
                          {messageTemplates.map((template) => (
                            <option key={template.key} value={template.key}>
                              {template.label}
                            </option>
                          ))}
                        </select>
                        <input
                          className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                          placeholder="Subject"
                          value={composer.subject}
                          onChange={(e) => setComposer((prev) => ({ ...prev, subject: e.target.value }))}
                        />
                        <div className="relative">
                          <textarea
                            id="messageTextarea"
                            className="min-h-24 w-full rounded border border-[#dddbda] px-3 py-2 pr-28 text-sm"
                            placeholder="Write your message or enter a quick prompt for AI"
                            value={composer.body}
                            onChange={(e) => setComposer((prev) => ({ ...prev, body: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="absolute bottom-2 right-2 rounded bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-200 disabled:opacity-60"
                            disabled={draftingAiMessage || !composer.body.trim()}
                            onClick={() => void draftMessageWithAi()}
                          >
                            {draftingAiMessage ? 'Drafting...' : 'Draft with AI'}
                          </button>
                        </div>
                        <input
                          className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                          type="datetime-local"
                          value={composer.sendAt}
                          onChange={(e) => setComposer((prev) => ({ ...prev, sendAt: e.target.value }))}
                        />
                        <input
                          className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                          placeholder="Message category"
                          value={composer.automationType}
                          onChange={(e) => setComposer((prev) => ({ ...prev, automationType: e.target.value }))}
                        />
                        <div className="rounded border border-[#e5e7eb] bg-[#f8fafc] p-2">
                          <label className="mb-1 block text-xs font-semibold text-[#475569]">Attach Documents</label>
                          <input
                            type="file"
                            accept="application/pdf,image/*"
                            className="w-full cursor-pointer text-xs text-[#475569]"
                            onChange={(e) => setComposerUploadFile(e.target.files?.[0] ?? null)}
                          />
                          {composerUploadFile ? (
                            <p className="mt-1 text-[11px] text-[#64748b]">
                              Upload: {composerUploadFile.name} ({Math.ceil(composerUploadFile.size / 1024)} KB)
                            </p>
                          ) : null}
                          <div className="mt-2 rounded bg-[#f1f5f9] p-2 text-[11px] text-[#475569]">
                            <p className="mb-1 font-semibold">Attach from client profile files</p>
                            {files.length === 0 ? <p>No saved files available.</p> : null}
                            {files.slice(0, 6).map((item) => (
                              <label key={item.id} className="mb-1 flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="rounded"
                                  checked={selectedExistingFileIds.includes(item.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedExistingFileIds((prev) => [...prev, item.id]);
                                      return;
                                    }
                                    setSelectedExistingFileIds((prev) => prev.filter((id) => id !== item.id));
                                  }}
                                />
                                <span className="truncate">{item.file_name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={savingMessage}
                          onClick={() => void sendManualMessage()}
                          className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60"
                        >
                          {savingMessage ? 'Saving...' : composer.sendAt ? 'Schedule Message' : 'Send Now'}
                        </button>
                      </div>
                    </section>
                  </div>
                ) : (
                  <section className="rounded border border-[#dddbda] bg-white p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-base font-semibold text-[#080707]">Delivery Activity</h3>
                      <span className="text-xs text-[#6a6a6a]">{deliveryAudit.length} recent</span>
                    </div>
                    <div className="space-y-2">
                      {deliveryAudit.length === 0 ? <p className="text-sm text-[#6a6a6a]">No recent delivery activity.</p> : null}
                      {deliveryAudit.slice(0, 12).map((item) => (
                        <article key={item.msg_id} className="rounded-lg border border-[#f3f2f1] bg-[#fbfbfb] p-3 text-sm">
                          <p className="font-semibold text-[#14324f]">{item.subject || 'Email message'}</p>
                          <p className="text-xs text-[#6a6a6a]">{item.to_email || '--'} · {safeDate(item.last_event_time)} · {item.status}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {editingMessage ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-bold text-[#080707]">Edit Scheduled Message</h3>
            <div className="space-y-2">
              <input
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.subject ?? ''}
                onChange={(e) => setEditingMessage((prev) => (prev ? { ...prev, subject: e.target.value } : prev))}
              />
              <textarea
                className="min-h-28 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.body}
                onChange={(e) => setEditingMessage((prev) => (prev ? { ...prev, body: e.target.value } : prev))}
              />
              <input
                type="datetime-local"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.send_at.slice(0, 16)}
                onChange={(e) =>
                  setEditingMessage((prev) => (prev ? { ...prev, send_at: new Date(e.target.value).toISOString() } : prev))
                }
              />
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.channel}
                onChange={(e) =>
                  setEditingMessage((prev) => (prev ? { ...prev, channel: e.target.value as 'email' | 'sms' } : prev))
                }
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.status}
                onChange={(e) =>
                  setEditingMessage((prev) =>
                    prev ? { ...prev, status: e.target.value as ScheduledMessage['status'] } : prev,
                  )
                }
              >
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void saveScheduledMessage()}
                className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingMessage(null)}
                className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SectionLayout>
  );
}
