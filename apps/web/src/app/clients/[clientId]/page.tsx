'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import SectionLayout from '../../../components/crm/SectionLayout';
import { useNotifications } from '../../../context/NotificationContext';
import RecordAssetsPanel from '../../../components/crm/RecordAssetsPanel';
import RecordWorkPanel from '../../../components/crm/RecordWorkPanel';
import { accountLifecycle } from '../../../lib/account-lifecycle';
import { workspaceFetch, workspacePages } from '../../../lib/workspace-fetch';
import type { WorkspaceNote, WorkspaceTask } from '@crm/shared';
import { Card, CardHeader, CardBody } from '../../../components/ui/Card';
import { formatArizonaDateTime } from '../../../lib/arizona-time';

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
  policy_effective_at?: string | null;
  last_viewed_at?: string | null;
  last_activity_at?: string | null;
  created_at: string;
  assigned_producer?: string | null;
  account_type?: string | null;
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
  expiration_date?: string | null;
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
  last_viewed_at?: string | null;
  last_activity_at?: string | null;
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


const emptyFileForm = {
  file_name: '',
  file_url: '',
  file_type: 'PDF',
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

export default function ClientWorkspacePage(): JSX.Element {
  const params = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const { refresh: refreshNotificationCounts, unreadMessages } = useNotifications();
  const clientId = params.clientId;

  const [client, setClient] = useState<Client | null>(null);
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [communications, setCommunications] = useState<CommunicationItem[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
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
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);

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

  const [compose, setCompose] = useState<{ kind: 'note' | 'reminder'; token: number }>();
  const [assetComposeToken, setAssetComposeToken] = useState(0);
  const [openWorkCount, setOpenWorkCount] = useState<number | null>(null);
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
  const loadedClientId = useRef<string | null>(null);
  const loadVersion = useRef(0);

  const loadData = async (): Promise<void> => {
    const version = ++loadVersion.current;
    setError(null);
    try {
      const [payload, savedNotes, savedTasks] = await Promise.all([
        workspaceFetch<WorkspacePayload>(`/api/clients/${clientId}/workspace?timelineLimit=${timelineLimit}&activityLimit=${activityLimit}`),
        workspacePages<WorkspaceNote>(`/api/interactions?record_type=client&record_id=${clientId}`, 100, 'page'),
        workspacePages<WorkspaceTask>(`/api/tasks?record_type=client&record_id=${clientId}&status=all&sort=due_asc&limit=200`, 200, 'offset'),
      ]);
      if (version !== loadVersion.current) return;
      loadedClientId.current = clientId;
      setClient(payload.client);
      setPolicies(payload.policies ?? []);
      setLeads(payload.leads ?? []);
      setCommunications(payload.communications ?? []);
      setScheduledMessages(payload.scheduledMessages ?? []);
      setEvents(payload.events ?? []);
      setNotifications(payload.notifications ?? []);
      setClaims(payload.claims ?? []);
      setEndorsements(payload.endorsements ?? []);
      setCertificates(payload.certificates ?? []);
      setAssets(payload.assets ?? []);
      setClientTasks(savedTasks);
      setOpenWorkCount(savedTasks.filter((task) => task.status === 'open').length);
      setFiles(payload.files ?? []);
      setTags(payload.tags ?? []);
      setActivities(payload.activities ?? []);
      setNotes(savedNotes);
      if (payload.client?.email) {
        const deliveryData = await workspaceFetch<DeliveryAuditItem[]>(
          `/api/communication-log/delivery?to_email=${encodeURIComponent(payload.client.email)}&limit=25`,
        );
        if (version === loadVersion.current) setDeliveryAudit(deliveryData);
      } else {
        setDeliveryAudit([]);
      }
    } catch (failure) {
      if (version === loadVersion.current) setError(failure instanceof Error ? failure.message : 'Failed to load client workspace.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      if (loadedClientId.current !== clientId) {
        setLoading(true);
        setClient(null);
      }
      void loadData();
    }
  }, [clientId, timelineLimit, activityLimit]);

  useEffect(() => {
    const requested = searchParams.get('tab');
    if (requested === 'overview' || requested === 'policies' || requested === 'assets' || requested === 'notes' || requested === 'tasks'
      || requested === 'files' || requested === 'activity' || requested === 'tags' || requested === 'insights') setProfileTab(requested);
    if (requested === 'communication') setIsConversationOpen(true);
  }, [searchParams]);

  const unreadFromAccount = unreadMessages.byClient[clientId] ?? 0;
  const markingReadRef = useRef(false);
  useEffect(() => {
    if (!isConversationOpen || unreadFromAccount === 0 || !clientId || markingReadRef.current) return;
    markingReadRef.current = true;
    void fetch('/api/communication-log/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    })
      .then(() => refreshNotificationCounts())
      .finally(() => {
        markingReadRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConversationOpen, unreadFromAccount, clientId]);

  const lifecycleStage = useMemo(() => accountLifecycle(policies), [policies]);

  const openClientTasks = useMemo(
    () => clientTasks.filter((task) => normalize(task.status) === 'open'),
    [clientTasks],
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

  const openAccountWork = openWorkCount ?? 0;

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
    <SectionLayout title="Account">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/clients" className="text-sm font-semibold text-[#20a8d8] hover:underline">
            Back to Clients
          </Link>
          <h2 className="mt-1 text-2xl font-bold text-[#23282c]">{client?.full_name ?? 'Loading account workspace...'}</h2>
          <p className="text-sm text-[#5c6873]">
            {client?.email || '--'} · {client?.phone || '--'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-[#5c6873]">
          <span className="rounded-full bg-[#edf4ff] px-3 py-1 font-semibold text-[#2f5c9f]">Lifecycle: {lifecycleStage}</span>
          <button type="button" disabled={loading || !client} onClick={() => { setProfileTab('notes'); setCompose((value) => ({ kind: 'note', token: (value?.token ?? 0) + 1 })); }}
            className="rounded border border-cui-primary bg-white px-3 py-1 font-semibold text-cui-primary">Add note</button>
          <button type="button" disabled={loading || !client} onClick={() => { setProfileTab('tasks'); setCompose((value) => ({ kind: 'reminder', token: (value?.token ?? 0) + 1 })); }}
            className="rounded border border-cui-primary bg-white px-3 py-1 font-semibold text-cui-primary">Add reminder</button>
          <button type="button" disabled={loading || !client} onClick={() => { setProfileTab('assets'); setAssetComposeToken((value) => value + 1); }}
            className="rounded border border-cui-primary bg-white px-3 py-1 font-semibold text-cui-primary">Add asset</button>
          <button
            type="button"
            className="relative rounded-full bg-[#167495] px-3 py-1 font-semibold text-white hover:bg-[#0a4f8f]"
            onClick={() => setIsConversationOpen((prev) => !prev)}
          >
            {isConversationOpen ? 'Close Communication' : 'Communication'}
            {unreadFromAccount > 0 ? (
              <span
                aria-label={`${unreadFromAccount} unread messages`}
                className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-cui-danger px-1.5 text-[11px] font-bold text-white"
              >
                {unreadFromAccount > 99 ? '99+' : unreadFromAccount}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {openAccountWork > 0 ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#f4c7c3] bg-[#fff5f4] px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white">
              {openAccountWork}
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#9f2f2f]">Open account work</p>
              <p className="mt-1 text-sm text-[#5a2f2f]">Review due times and complete individual tasks in Tasks. Opening this account does not complete them.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setProfileTab('tasks')}
            className="rounded border border-[#cf6a63] bg-white px-3 py-1.5 text-xs font-semibold text-[#7f2d2d] hover:bg-[#fff0ef]"
          >
            Review tasks
          </button>
        </div>
      ) : null}

      {error ? <div role="alert" className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{error} <button type="button" onClick={() => void loadData()} className="font-semibold underline">Refresh</button></div> : null}
      {loading ? <div className="text-sm text-[#73818f]">Loading client workspace...</div> : null}

      {!loading && client ? (
        <div className={`relative grid grid-cols-1 gap-4 transition-all duration-300 ${isConversationOpen ? 'xl:pr-[26rem]' : ''}`}>
          <section className="rounded border border-[#c8ced3] bg-white shadow-sm">
            <div className="border-b border-[#f0f3f5] px-3 py-2">
              <div className="flex flex-wrap items-center gap-1" aria-label="Account sections">
                {([
                  ['overview', 'Overview'],
                  ['policies', 'Policies'],
                  ['assets', 'Assets & People'],
                  ['notes', 'Notes'],
                  ['tasks', 'Tasks'],
                  ['files', 'Documents'],
                ] as Array<[ProfileTab, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    data-tab={value}
                    type="button"
                    aria-pressed={profileTab === value}
                    className={`rounded border-b-2 px-3 py-2 text-sm font-semibold transition ${
                      profileTab === value ? 'border-cui-primary text-cui-primary' : 'border-transparent text-cui-muted hover:bg-cui-light'
                    }`}
                    onClick={() => setProfileTab(value)}
                  >
                    {label}
                  </button>
                ))}
                <details className="relative ml-auto">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-cui-muted">More</summary>
                  <div className="absolute right-0 z-20 w-44 rounded border border-cui-border bg-white p-2 shadow-lg">
                    {([['activity', 'Activity history'], ['tags', 'Manage tags'], ['insights', 'Risk review']] as const).map(([value, label]) =>
                      <button key={value} type="button" className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-cui-light"
                        onClick={(event) => { setProfileTab(value); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{label}</button>)}
                  </div>
                </details>
              </div>
            </div>

            <div className="p-4">
              {profileTab === 'overview' ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader actions={<button className="text-xs font-semibold text-cui-primary" onClick={() => setProfileTab('tasks')}>All tasks</button>}>Next actions</CardHeader>
                    <CardBody>
                      <p className="mb-2 text-xs text-cui-muted">{openWorkCount ?? '--'} open tasks · Times in Arizona</p>
                      {!openClientTasks.length ? <p className="text-sm text-cui-muted">No open tasks.</p> : null}
                      {openClientTasks.slice(0, 4).map((task) => <button key={task.id} onClick={() => setProfileTab('tasks')} className="block w-full border-b border-cui-border/50 py-2 text-left">
                        <span className="text-sm font-semibold text-cui-primary">{task.subject}</span>
                        <span className={`block text-xs ${task.due_date && Date.parse(task.due_date) < Date.now() ? 'text-cui-danger' : 'text-cui-muted'}`}>
                          {task.due_date ? `${formatArizonaDateTime(task.due_date)} AZ` : 'No due date'}
                        </span>
                      </button>)}
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader actions={<button className="text-xs font-semibold text-cui-primary" onClick={() => setProfileTab('policies')}>All policies</button>}>Coverage & renewals</CardHeader>
                    <CardBody>
                      {!policies.length ? <p className="text-sm text-cui-muted">No placed coverage recorded. This is a prospect account.</p> : null}
                      {policies.slice(0, 4).map((policy) => <button key={policy.id} onClick={() => setProfileTab('policies')} className="block w-full border-b border-cui-border/50 py-2 text-left">
                        <span className="text-sm font-semibold text-cui-text">{policy.carrier || 'Carrier not recorded'} · {policy.line_of_business || 'Policy'}</span>
                        <span className="block text-xs text-cui-muted">{policy.policy_number || 'Number not recorded'} · {policy.status || 'Status not recorded'}</span>
                        <span className="block text-xs text-cui-muted">Expiration {safeDateOnly(policy.expiration_date ?? policy.renewal_date)}</span>
                      </button>)}
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader>Account details</CardHeader>
                    <CardBody>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-[#425468] md:grid-cols-2">
                      <p>Name: {client?.full_name || '--'}</p>
                      <p>Email: {client?.email || '--'}</p>
                      <p>Phone: {client?.phone || '--'}</p>
                      <p>Address: {client?.address || '--'}</p>
                      <p>Account type: {client.account_type || 'Not recorded'}</p>
                      <p>Assigned agent: {client.assigned_producer || 'Unassigned'}</p>
                      <p>Preferred contact: {client.preferred_channel || 'Not recorded'}</p>
                      <p>Consent recorded: Email {client.email_consent ? 'Yes' : 'No'} · SMS {client.sms_consent ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">{tags.map((tag) => <span key={tag.id} className="rounded bg-cui-light px-2 py-1 text-xs text-cui-muted">{tag.tag}</span>)}</div>
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader actions={<button className="text-xs font-semibold text-cui-primary" onClick={() => setProfileTab('notes')}>All notes</button>}>Pinned notes</CardHeader>
                    <CardBody>
                      {!notes.some((note) => note.pinned) ? <p className="text-sm text-cui-muted">Pin important call or service notes to keep them here.</p> : null}
                      {notes.filter((note) => note.pinned).slice(0, 3).map((note) => <article key={note.id} className="mb-3">
                        <p className="whitespace-pre-wrap break-words text-sm text-cui-text">{note.content}</p>
                        <p className="mt-1 text-xs text-cui-muted">{note.author_name || 'Author not recorded'} · {formatArizonaDateTime(note.updated_at)} AZ</p>
                      </article>)}
                    </CardBody>
                  </Card>
                  <Card className="lg:col-span-2">
                    <CardHeader actions={<button className="text-xs font-semibold text-cui-primary" onClick={() => setProfileTab('activity')}>Full history</button>}>Recent history</CardHeader>
                    <CardBody>
                      {!activities.length ? <p className="text-sm text-cui-muted">No recorded activity yet.</p> : null}
                      {activities.slice(0, 5).map((item) => <p key={item.id} className="border-b border-cui-border/50 py-2 text-sm text-cui-text">{item.title} <span className="text-xs text-cui-muted">{formatArizonaDateTime(item.occurred_at)} AZ</span></p>)}
                    </CardBody>
                  </Card>

                  <details className="rounded border border-cui-border p-4 lg:col-span-2">
                    <summary className="cursor-pointer text-sm font-semibold text-cui-text">Linked leads & submission history</summary>
                    <div className="mt-3 flex flex-wrap gap-2">{leads.map((lead) => <Link key={lead.id} href={`/leads?lead=${lead.id}`} className="text-sm font-semibold text-cui-primary hover:underline">{lead.full_name || 'Open linked lead'}</Link>)}</div>

                    {commercialSubmissionAssets.length === 0 && personalSubmissionAssets.length === 0 ? (
                      <p className="mt-2 text-sm text-[#73818f]">No linked submission data yet.</p>
                    ) : null}

                    {commercialSubmissionAssets.map((asset) => {
                      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
                      return (
                        <article key={asset.id} className="mt-3 rounded border border-[#d8e3f0] bg-white p-3">
                          <p className="text-sm font-semibold text-[#14324f]">Commercial Submission</p>
                          <p className="text-xs text-[#73818f]">{asset.title}</p>
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
                          <p className="text-xs text-[#73818f]">{asset.title}</p>
                          <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-[#425468] md:grid-cols-2">
                            <p>Current Carrier: {String(metadata.current_carrier ?? '--')}</p>
                            <p>Policy Expiration: {String(metadata.current_policy_expiration ?? '--')}</p>
                            <p>DOB: {String(metadata.dob ?? '--')}</p>
                            <p>Submission Id: {String(metadata.personal_account_id ?? '--')}</p>
                          </div>
                        </article>
                      );
                    })}
                  </details>
                </div>
              ) : null}

              {profileTab === 'policies' ? (
                <div className="space-y-3">
                  <p className="text-xs text-[#73818f]">Policy details stay in sync with the Policies page.</p>
                  {policies.length === 0 ? <p className="text-sm text-[#73818f]">No linked policies.</p> : null}
                  {policies.map((policy) => (
                    <article key={policy.id} className="rounded-lg border border-[#f0f3f5] bg-[#ffffff] p-3">
                      <p className="text-sm font-semibold text-[#14324f]">{policy.carrier || '--'} · {policy.line_of_business || 'Policy'}</p>
                      <p className="text-xs text-[#73818f]">
                        Premium {formatCurrency(policy.premium)} · Status {policy.status || '--'} · Policy # {policy.policy_number || '--'}
                      </p>
                      <p className="mt-1 text-xs text-[#425468]">Effective {safeDateOnly(policy.effective_date)} · Renewal {safeDateOnly(policy.renewal_date)}</p>
                    </article>
                  ))}
                </div>
              ) : null}

              <div hidden={profileTab !== 'assets'}>
                <RecordAssetsPanel key={clientId} target={{ type: 'client', id: clientId }} composeToken={assetComposeToken} onChanged={() => void loadData()} />
              </div>
              <div hidden={profileTab !== 'notes' && profileTab !== 'tasks'}>
                <RecordWorkPanel key={clientId} target={{ type: 'client', id: clientId }} name={client?.full_name ?? 'Account'} section={profileTab === 'notes' ? 'notes' : 'tasks'}
                  compose={compose} onChanged={() => void loadData()} onTaskCount={setOpenWorkCount} />
              </div>

              {profileTab === 'files' ? (
                <div className="space-y-4">
                  <section className="rounded-lg border border-[#f0f3f5] bg-[#ffffff] p-3">
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
                        className="cursor-pointer rounded border border-dashed border-[#bfd2e8] bg-[#f8f9fa] px-3 py-2 text-sm md:col-span-3"
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
                      <p className="mt-2 text-xs text-[#73818f]">
                        Selected: {selectedUploadName}
                        {typeof selectedUploadSize === 'number' ? ` (${Math.ceil(selectedUploadSize / 1024)} KB)` : ''}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void createFileRecord()}
                      className="mt-2 rounded bg-[#20a8d8] px-3 py-2 text-xs font-semibold text-white"
                    >
                      Save File
                    </button>
                  </section>

                  {files.length === 0 ? <p className="text-sm text-[#73818f]">No file records yet.</p> : null}
                  {files.map((item) => (
                    <article key={item.id} className="rounded-lg border border-[#f0f3f5] bg-[#ffffff] p-3">
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
                              className="rounded bg-[#20a8d8] px-3 py-1.5 text-xs font-semibold text-white"
                              onClick={() => void saveFileEdit()}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="rounded bg-[#e4e5e6] px-3 py-1.5 text-xs font-semibold text-[#5c6873]"
                              onClick={() => setEditingFileId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-[#14324f]">{item.file_name}</p>
                          <p className="text-xs text-[#73818f]">{item.file_type || '--'} · {item.status || 'uploaded'} · {safeDate(item.uploaded_at)}</p>
                          {item.file_url ? (
                            <a href={item.file_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-[#20a8d8] hover:underline">
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
                  <section className="rounded-lg border border-[#f0f3f5] bg-[#ffffff] p-3">
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
                        className="rounded bg-[#20a8d8] px-3 py-2 text-xs font-semibold text-white"
                      >
                        Add
                      </button>
                    </div>
                  </section>

                  <div className="flex flex-wrap gap-2">
                    {tags.length === 0 ? <p className="text-sm text-[#73818f]">No tags yet.</p> : null}
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
                  {activities.length === 0 ? <p className="text-sm text-[#73818f]">No client activity entries yet.</p> : null}
                  {activities.map((item) => (
                    <article key={item.id} className="rounded-lg border border-[#f0f3f5] bg-[#ffffff] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#73818f]">{item.activity_type}</p>
                      <p className="text-sm font-semibold text-[#14324f]">{item.title}</p>
                      {item.body ? <p className="mt-1 whitespace-pre-line text-sm text-[#425468]">{item.body}</p> : null}
                      <p className="mt-1 text-xs text-[#73818f]">{safeDate(item.occurred_at)}</p>
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
                  <section className="rounded-lg border border-[#f0f3f5] bg-[#ffffff] p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Underwriting Risk Flags</h4>
                    <button
                      type="button"
                      className="mt-2 rounded bg-[#fff3de] px-3 py-2 text-xs font-semibold text-[#8a4d00]"
                      onClick={() => void runRiskExtraction()}
                    >
                      Extract risk profile
                    </button>
                    <div className="mt-2 space-y-1">
                      {aiRiskSignals.length === 0 ? <p className="text-sm text-[#73818f]">Run extraction to view current flags.</p> : null}
                      {aiRiskSignals.map((flag) => (
                        <p key={flag} className="text-sm text-[#425468]">• {flag}</p>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-lg border border-[#f0f3f5] bg-[#ffffff] p-3">
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
            className={`fixed right-0 top-0 z-40 h-full w-full max-w-[26rem] transform border-l border-[#c8ced3] bg-white shadow-2xl transition-transform duration-300 ${
              isConversationOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="flex h-full flex-col">
              <div className="border-b border-[#f0f3f5] px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-[#23282c]">Client Conversation</h3>
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
                      conversationTab === 'thread' ? 'bg-[#20a8d8] text-white' : 'bg-[#eff5ff] text-[#0a4f8f]'
                    }`}
                    onClick={() => setConversationTab('thread')}
                  >
                    Conversation
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      conversationTab === 'delivery' ? 'bg-[#20a8d8] text-white' : 'bg-[#eff5ff] text-[#0a4f8f]'
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
                          channelFilter === 'email' ? 'bg-[#167495] text-white' : 'bg-[#e7f2ff] text-[#0a4f8f]'
                        }`}
                        onClick={() => setChannelFilter('email')}
                      >
                        Email
                      </button>
                      <button
                        type="button"
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          channelFilter === 'sms' ? 'bg-[#167495] text-white' : 'bg-[#e7f2ff] text-[#0a4f8f]'
                        }`}
                        onClick={() => setChannelFilter('sms')}
                      >
                        SMS
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-2">
                      <button
                        type="button"
                        className="rounded bg-[#167495] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0a4f8f] disabled:opacity-60"
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
                          setProfileTab('tasks');
                        }}
                      >
                        View Tasks
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
                          <article key={`${item.kind}-${item.id}`} className="rounded-xl border border-[#e8eef7] bg-[#ffffff] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#73818f]">
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

                    <section className="rounded border border-[#c8ced3] bg-white p-4 shadow-sm">
                      <h3 className="text-base font-semibold text-[#23282c]">Send Message</h3>
                      <p className="mb-3 text-xs text-[#73818f]">Send now or schedule a follow-up message.</p>
                      <div className="space-y-2">
                        <select
                          className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                          value={composer.channel}
                          onChange={(e) => setComposer((prev) => ({ ...prev, channel: e.target.value as 'email' | 'sms' }))}
                        >
                          <option value="email">Email</option>
                          <option value="sms">SMS</option>
                        </select>
                        <select
                          className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
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
                          className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                          placeholder="Subject"
                          value={composer.subject}
                          onChange={(e) => setComposer((prev) => ({ ...prev, subject: e.target.value }))}
                        />
                        <div className="relative">
                          <textarea
                            id="messageTextarea"
                            className="min-h-24 w-full rounded border border-[#c8ced3] px-3 py-2 pr-28 text-sm"
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
                          className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                          type="datetime-local"
                          value={composer.sendAt}
                          onChange={(e) => setComposer((prev) => ({ ...prev, sendAt: e.target.value }))}
                        />
                        <input
                          className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
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
                            <p className="mt-1 text-[11px] text-[#73818f]">
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
                          className="w-full rounded bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7] disabled:opacity-60"
                        >
                          {savingMessage ? 'Saving...' : composer.sendAt ? 'Schedule Message' : 'Send Now'}
                        </button>
                      </div>
                    </section>
                  </div>
                ) : (
                  <section className="rounded border border-[#c8ced3] bg-white p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-base font-semibold text-[#23282c]">Delivery Activity</h3>
                      <span className="text-xs text-[#73818f]">{deliveryAudit.length} recent</span>
                    </div>
                    <div className="space-y-2">
                      {deliveryAudit.length === 0 ? <p className="text-sm text-[#73818f]">No recent delivery activity.</p> : null}
                      {deliveryAudit.slice(0, 12).map((item) => (
                        <article key={item.msg_id} className="rounded-lg border border-[#f0f3f5] bg-[#fbfbfb] p-3 text-sm">
                          <p className="font-semibold text-[#14324f]">{item.subject || 'Email message'}</p>
                          <p className="text-xs text-[#73818f]">{item.to_email || '--'} · {safeDate(item.last_event_time)} · {item.status}</p>
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
          <div className="w-full max-w-lg rounded border border-[#c8ced3] bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-bold text-[#23282c]">Edit Scheduled Message</h3>
            <div className="space-y-2">
              <input
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingMessage.subject ?? ''}
                onChange={(e) => setEditingMessage((prev) => (prev ? { ...prev, subject: e.target.value } : prev))}
              />
              <textarea
                className="min-h-28 w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingMessage.body}
                onChange={(e) => setEditingMessage((prev) => (prev ? { ...prev, body: e.target.value } : prev))}
              />
              <input
                type="datetime-local"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingMessage.send_at.slice(0, 16)}
                onChange={(e) =>
                  setEditingMessage((prev) => (prev ? { ...prev, send_at: new Date(e.target.value).toISOString() } : prev))
                }
              />
              <select
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingMessage.channel}
                onChange={(e) =>
                  setEditingMessage((prev) => (prev ? { ...prev, channel: e.target.value as 'email' | 'sms' } : prev))
                }
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
              <select
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
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
                className="w-full rounded bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingMessage(null)}
                className="w-full rounded bg-[#e4e5e6] px-3 py-2 text-sm font-semibold text-[#5c6873] hover:bg-[#c8ced3]"
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
