'use client';

import Link from 'next/link';
import { useEmailDocument } from '../../../hooks/useEmailDocument';
import { useParams, useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import SectionLayout from '../../../components/crm/SectionLayout';
import { useNotifications } from '../../../context/NotificationContext';
import RecordAssetsPanel from '../../../components/crm/RecordAssetsPanel';
import AgentSenderBadge from '../../../components/crm/AgentSenderBadge';
import ScheduleSend from '../../../components/crm/ScheduleSend';
import SalesTemplatePicker, { type SelectedSalesTemplate } from '../../../components/crm/SalesTemplatePicker';
import MessageComposer, { composerDraftClass, composerSendClass } from '../../../components/crm/MessageComposer';
import ConversationMessage from '../../../components/crm/ConversationMessage';
import ConversationHistory from '../../../components/crm/ConversationHistory';
import ConversationAppointment from '../../../components/crm/ConversationAppointment';
import ConversationSequences from '../../../components/crm/ConversationSequences';
import ConversationReplyControl from '../../../components/crm/ConversationReplyControl';
import { useAgencyTimeZone } from '../../../hooks/useAgencyTimeZone';
import { agencyDateTimeInput, agencyInputToIso } from '../../../lib/agency-time';
import IntelligenceDossierPanel from '../../../components/crm/IntelligenceDossierPanel';
import RecordWorkPanel from '../../../components/crm/RecordWorkPanel';
import QuoteOptionsPanel from '../../../components/crm/QuoteOptionsPanel';
import PolicyQuoteProvenance from '../../../components/crm/PolicyQuoteProvenance';
import PolicyServiceRequests from '../../../components/crm/PolicyServiceRequests';
import { accountLifecycle } from '../../../lib/account-lifecycle';
import { workspaceFetch, workspacePages, workspacePage } from '../../../lib/workspace-fetch';
import type { WorkspaceNote, WorkspaceTask } from '@crm/shared';
import { Card, CardHeader, CardBody } from '../../../components/ui/Card';
import { formatArizonaDateTime } from '../../../lib/arizona-time';
import { uploadAccountDocument, downloadAccountDocument } from '../../../lib/account-document-client';
import { INTAKE_FIELDS, type ReviewedIntakeFields, type IntakeField } from '../../../lib/policy-document-intake';
import { markMessagesRead } from '../../../lib/message-read';
import AccountContextRecord from '../../../components/crm/AccountContextRecord';
import IntakeDetailsSummary from '../../../components/crm/IntakeDetailsSummary';
import { receiptForMessage, type EmailReceipt } from '../../../lib/message-receipts';
import EmailOpenStatus from '../../../components/crm/EmailOpenStatus';
import { Mail, Maximize2, Minimize2, X, Send, Phone } from 'lucide-react';
import { watchConversationUpdates } from '../../../lib/conversation-updates';
import { taskRecordHref } from '../../../lib/task-links';
import { useUnsavedChanges, useWorkspaceNavigation } from '../../../context/WorkspaceNavigationContext';
import ContactPreferenceControl from '../../../components/crm/ContactPreferenceControl';
import IntakeRequestDialog from '../../../components/crm/IntakeRequestDialog';

interface Client {
  intake_details?: unknown;
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
  quote_snapshot?: unknown;
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
  prior_policy_id?: string | null;
  billing_type?: string | null;
  source?: string | null;
  sub_type?: string | null;
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
  metadata?: Record<string, unknown> | null;
  read_at?: string | null;
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
  action_href?: string | null;
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
  source_kind?: 'stored' | 'link' | 'legacy_placeholder';
  download_url?: string | null;
  intake_review?: ReviewedIntakeFields;
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
type ProfileTab = 'overview' | 'policies' | 'assets' | 'notes' | 'tasks' | 'files' | 'tags' | 'activity' | 'insights' | 'quotes';

const emptyComposer: {
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  automationType: string;
} = {
  channel: 'email',
  subject: '',
  body: '',
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
  const { navigate } = useWorkspaceNavigation();
  const params = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const [showIntake, setShowIntake] = useState(searchParams.get('intake') === '1');
  useEffect(() => { if (searchParams.get('intake') === '1') setShowIntake(true); }, [searchParams]);
  const { refresh: refreshNotificationCounts, unreadMessages } = useNotifications();
  const clientId = params.clientId;

  const [client, setClient] = useState<Client | null>(null);
  const [doNotContact, setDoNotContact] = useState(true);
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

  const [deliveryAudit, setDeliveryAudit] = useState<EmailReceipt[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timelineLimit, setTimelineLimit] = useState(120);
  const [activityLimit, setActivityLimit] = useState(80);

  const [profileTab, setProfileTab] = useState<ProfileTab>(() => searchParams.get('tab') === 'policies' ? 'policies' : 'overview');
  const [visitedTabs, setVisitedTabs] = useState<Set<ProfileTab>>(() => new Set(['overview']));
  useEffect(() => { if (searchParams.get('tab') === 'policies') setProfileTab('policies'); }, [searchParams]);
  useEffect(() => { setVisitedTabs((previous) => previous.has(profileTab) ? previous : new Set([...previous, profileTab])); }, [profileTab]);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('email');
  const [isConversationOpen, setIsConversationOpen] = useState(false);
  const [conversationExpanded, setConversationExpanded] = useState(false);

  const [composer, setComposer] = useState(emptyComposer);
  const { bodyDocument, setBodyDocument } = useEmailDocument(composer.body);
  const [emailProvider, setEmailProvider] = useState<'default' | 'gmail'>('default');
  const [replyId, setReplyId] = useState('');
  useEffect(() => { setReplyId(''); }, [clientId, emailProvider, composer.channel]);
  const [savingMessage, setSavingMessage] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [salesTemplate, setSalesTemplate] = useState<SelectedSalesTemplate | null>(null);
  const sendRequest = useRef<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);
  const [editSendAt, setEditSendAt] = useState('');
  const agencyTime = useAgencyTimeZone();

  const [compose, setCompose] = useState<{ kind: 'note' | 'reminder'; token: number }>();
  const [assetComposeToken, setAssetComposeToken] = useState(0);
  const [openWorkCount, setOpenWorkCount] = useState<number | null>(null);
  const [fileForm, setFileForm] = useState(emptyFileForm);
  const [selectedUploadName, setSelectedUploadName] = useState('');
  const [selectedUploadSize, setSelectedUploadSize] = useState<number | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [savingFile, setSavingFile] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [fileEditForm, setFileEditForm] = useState(emptyFileEditForm);
  const [newTag, setNewTag] = useState('');

  const [aiSummary, setAiSummary] = useState('');
  const [aiRiskSignals, setAiRiskSignals] = useState<string[]>([]);
  const [runningAiAction, setRunningAiAction] = useState<'summary' | 'flags' | null>(null);
  const [draftingAiMessage, setDraftingAiMessage] = useState(false);
  const [includeDossierInAiDraft, setIncludeDossierInAiDraft] = useState(false);
  const [draftCitedSignals, setDraftCitedSignals] = useState<string[]>([]);
  const [draftDossierFacts, setDraftDossierFacts] = useState<string[]>([]);
  const [draftRequestedDossier, setDraftRequestedDossier] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState('');
  const [selectedExistingFileIds, setSelectedExistingFileIds] = useState<string[]>([]);
  const [composerUploadFile, setComposerUploadFile] = useState<File | null>(null);
  useUnsavedChanges(Boolean(composer.subject || composer.body || selectedExistingFileIds.length || composerUploadFile || selectedUpload));
  const loadedClientId = useRef<string | null>(null);
  const loadVersion = useRef(0);
  const [loadingSavedWork, setLoadingSavedWork] = useState(true);
  const [loadingCommunications, setLoadingCommunications] = useState(false);
  const [communicationLoadError, setCommunicationLoadError] = useState('');
  const communicationVersion = useRef(0);
  const [communicationReload, setCommunicationReload] = useState(0);
  const [communicationNext, setCommunicationNext] = useState<number | null>(null);
  const communicationDepth = useRef(100);
  const olderMessagesBusy = useRef(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);

  const loadData = async (): Promise<void> => {
    const version = ++loadVersion.current;
    setError(null);
    setLoadingSavedWork(true);
    try {
      const core = workspaceFetch<WorkspacePayload>(`/api/clients/${clientId}/workspace?mode=core&timelineLimit=${timelineLimit}&activityLimit=${activityLimit}`);
      const visibleCore = core.then((payload) => {
        if (version === loadVersion.current) {
          loadedClientId.current = clientId;
          setClient(payload.client);
          setPolicies(payload.policies ?? []);
          setClaims(payload.claims ?? []);
          setAssets(payload.assets ?? []);
          setLoading(false);
        }
        return payload;
      });
      const [payload, savedNotes, savedTasks, savedFiles] = await Promise.all([
        visibleCore,
        workspacePages<WorkspaceNote>(`/api/interactions?record_type=client&record_id=${clientId}`, 100, 'page'),
        workspacePages<WorkspaceTask>(`/api/tasks?record_type=client&record_id=${clientId}&status=all&sort=due_asc&limit=200`, 200, 'offset'),
        workspaceFetch<ClientFile[]>(`/api/clients/${clientId}/files`),
      ]);
      if (version !== loadVersion.current) return;
      loadedClientId.current = clientId;
      setClient(payload.client);
      setPolicies(payload.policies ?? []);
      setLeads(payload.leads ?? []);
      setScheduledMessages(payload.scheduledMessages ?? []);
      setEvents(payload.events ?? []);
      setNotifications(payload.notifications ?? []);
      setClaims(payload.claims ?? []);
      setEndorsements(payload.endorsements ?? []);
      setCertificates(payload.certificates ?? []);
      setAssets(payload.assets ?? []);
      setClientTasks(savedTasks);
      setOpenWorkCount(savedTasks.filter((task) => task.status === 'open').length);
      setFiles(savedFiles);
      setTags(payload.tags ?? []);
      setActivities(payload.activities ?? []);
      setNotes(savedNotes);
    } catch (failure) {
      if (version === loadVersion.current) setError(failure instanceof Error ? failure.message : 'Client workspace could not be loaded. Refresh the page to try again.');
    } finally {
      if (version === loadVersion.current) { setLoading(false); setLoadingSavedWork(false); }
    }
  };

  useEffect(() => {
    if ((!isConversationOpen && profileTab !== 'insights') || !client || loadedClientId.current !== clientId) return;
    const version = ++communicationVersion.current;
    let active = false;
    let pending = false;
    const refresh = async (initial = false): Promise<void> => {
      if ((!initial && document.visibilityState !== 'visible') || olderMessagesBusy.current) return;
      if (active) { pending = true; return; }
      active = true;
      if (initial) setLoadingCommunications(true);
      try {
        const [messages, delivery, tasks] = await Promise.all([
          workspacePage<CommunicationItem>(`/api/communication-log?client_id=${clientId}&limit=100`),
          client.email ? workspacePages<EmailReceipt>(`/api/communication-log/delivery?to_email=${encodeURIComponent(client.email)}&limit=100`, 100, 'offset') : Promise.resolve([]),
          workspacePages<WorkspaceTask>(`/api/tasks?record_type=client&record_id=${clientId}&status=all&sort=due_asc&limit=200`, 200, 'offset'),
        ]);
        if (version !== communicationVersion.current) return;
        setCommunications((current) => [...new Map([...current, ...messages.rows].map((item) => [item.id, item])).values()]);
        setCommunicationNext((previous) => communicationDepth.current <= 100 ? messages.nextOffset : previous);
        setDeliveryAudit(delivery); setCommunicationLoadError('');
        setClientTasks(tasks);
        setOpenWorkCount(tasks.filter((task) => task.status === 'open').length);
      } catch (failure) {
        if (version === communicationVersion.current) setCommunicationLoadError(failure instanceof Error ? failure.message : 'Communication could not be loaded.');
      } finally {
        active = false;
        if (version === communicationVersion.current) setLoadingCommunications(false);
        if (pending && version === communicationVersion.current) { pending = false; void refresh(); }
      }
    };
    void refresh(true);
    const stopUpdates = watchConversationUpdates(refresh);
    return () => {
      ++communicationVersion.current;
      stopUpdates();
    };
  }, [isConversationOpen, clientId, client, profileTab === 'insights', communicationReload]);

  const loadEarlierMessages = async (): Promise<void> => {
    if (communicationNext === null || olderMessagesBusy.current) return;
    const version = communicationVersion.current;
    olderMessagesBusy.current = true; setLoadingOlderMessages(true);
    try {
      const page = await workspacePage<CommunicationItem>(`/api/communication-log?client_id=${clientId}&limit=100&offset=${communicationNext}`);
      if (version !== communicationVersion.current) return;
      setCommunications((current) => [...new Map([...current, ...page.rows].map((item) => [item.id, item])).values()]);
      communicationDepth.current = communicationNext + page.rows.length;
      setCommunicationNext(page.nextOffset); setCommunicationLoadError('');
    } catch (failure) {
      if (version === communicationVersion.current) setCommunicationLoadError(failure instanceof Error ? failure.message : 'Earlier messages could not be loaded.');
    } finally { olderMessagesBusy.current = false; setLoadingOlderMessages(false); }
  };

  useEffect(() => {
    if (clientId) {
      if (loadedClientId.current !== clientId) {
        setLoading(true);
        setComposer(emptyComposer);
        setSalesTemplate(null);
        sendRequest.current = null;
        setClient(null);
        setCommunications([]);
        setCommunicationNext(null);
        communicationDepth.current = 100;
        setDeliveryAudit([]);
        setClientTasks([]);
        setNotes([]);
        setFiles([]);
        setOpenWorkCount(0);
        setVisitedTabs(new Set(['overview']));
      }
      void loadData();
    }
  }, [clientId, timelineLimit, activityLimit]);

  useEffect(() => {
    const requested = searchParams.get('tab');
    if (requested === 'overview' || requested === 'policies' || requested === 'quotes' || requested === 'assets' || requested === 'notes' || requested === 'tasks'
      || requested === 'files' || requested === 'activity' || requested === 'tags' || requested === 'insights') setProfileTab(requested);
    if (requested === 'communication') setIsConversationOpen(true);
  }, [searchParams]);

  const unreadFromAccount = unreadMessages.byClient[clientId] ?? 0;
  const markingReadRef = useRef(false);
  useEffect(() => {
    if (!isConversationOpen || document.visibilityState !== 'visible' || loading || loadingCommunications || communicationLoadError || error || loadedClientId.current !== clientId || markingReadRef.current) return;
    const ids = communications.filter((message) => message.direction === 'inbound' && !message.read_at && message.channel === channelFilter).map((message) => message.id);
    if (!ids.length) return;
    markingReadRef.current = true;
    void markMessagesRead(ids)
      .then(async (result) => {
        if (!result.ok) { setError(result.message); return; }
        setCommunications((rows) => rows.map((row) => ids.includes(row.id) ? { ...row, read_at: new Date().toISOString() } : row));
        await refreshNotificationCounts();
      })
      .finally(() => {
        markingReadRef.current = false;
      });
    // The provider refresh function is recreated on badge updates, not a thread-view change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConversationOpen, channelFilter, loading, loadingCommunications, communicationLoadError, communications, clientId]);

  const lifecycleStage = useMemo(() => accountLifecycle(policies), [policies]);
  const contactEmail = client?.email?.trim() ?? '';
  const contactPhone = client?.phone?.trim() ?? '';

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

  const timeline = useMemo(() => {
    const rows = communications.filter((item) => item.channel === 'email' || item.channel === 'sms');
    return rows.sort((left, right) => {
      const leftDate = new Date(left.sent_at ?? 0).getTime();
      const rightDate = new Date(right.sent_at ?? 0).getTime();
      return leftDate - rightDate || left.id.localeCompare(right.id);
    });
  }, [communications]);

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
    if (!client || savingMessage || scheduleBusy) return;
    if (composer.channel === 'sms') {
      setError('Text sending and scheduling are unavailable until an SMS provider is connected.');
      return;
    }
    if (composer.channel === 'email' && !emailCommunicationOn) {
      setError('This client has not consented to email messages.');
      return;
    }
    const selectedExistingFiles = files.filter((item) => selectedExistingFileIds.includes(item.id));

    setSavingMessage(true);
    setError(null);
    try {

    const linkedProfileFiles = selectedExistingFiles
      .filter((item) => item.file_url)
      .map((item) => ({ id: item.id, file_name: item.file_name, file_url: item.file_url as string }));

    const profileLinksBlock = linkedProfileFiles.length > 0
      ? `\n\nAttached client file links:\n${linkedProfileFiles.map((item) => `- ${item.file_name}: ${item.file_url}`).join('\n')}`
      : '';

    const messageBody = `${composer.body}${profileLinksBlock}`;

    let uploadAttachments: ComposerAttachment[] = [];
    if (composerUploadFile) {
      const base64 = await readFileAsBase64(composerUploadFile);
      uploadAttachments = [
        {
          filename: composerUploadFile.name,
          content: base64,
          type: composerUploadFile.type || 'application/octet-stream',
        },
      ];
    }

    const endpoint = '/api/communication-log';
    const payload = {
          client_id: client.id,
          request_id: sendRequest.current ?? (sendRequest.current = crypto.randomUUID()),
          sales_template: salesTemplate,
          ...(bodyDocument ? { body_document: bodyDocument } : {}),
          ...(replyId ? { reply_to_message_id: replyId } : {}),
          channel: composer.channel,
          direction: 'outbound' as const,
          subject: composer.subject || null,
          body: messageBody,
          automation_type: composer.automationType || 'manual',
          ...(emailProvider === 'gmail' ? { email_provider: 'gmail' as const } : {}),
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

    setComposer({ ...emptyComposer, channel: channelFilter });
    setReplyId('');
    setSalesTemplate(null);
    sendRequest.current = null;
    setActiveTemplate('');
    setComposerUploadFile(null);
    setSelectedExistingFileIds([]);
    setSavingMessage(false);
    await logActivity(
      'message_sent',
      'Sent outbound message',
      composer.subject || composer.body,
    );
    await loadData();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sending was not confirmed. Refresh the conversation before trying again.');
    } finally { setSavingMessage(false); }
  };

  const saveScheduledMessage = async (): Promise<void> => {
    if (!editingMessage) return;
    const iso = agencyTime.timeZone ? agencyInputToIso(editSendAt, agencyTime.timeZone) : null;
    if (!iso || Date.parse(iso) <= Date.now()) {
      setError('Choose a valid future send time in the agency time zone.');
      return;
    }

    const response = await fetch('/api/scheduled-messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingMessage.id,
        send_at: iso,
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

  const createFileRecord = async (): Promise<void> => {
    if (savingFile) return;
    if (!fileForm.file_name.trim()) { setError('Name the document or select a file.'); return; }
    setSavingFile(true); setError(null);
    try {
      if (selectedUpload) {
        const result = await uploadAccountDocument(clientId, selectedUpload, { onProgress: (fraction) => setUploadProgress(Math.round(fraction * 100)) });
        if (!result.ok) throw new Error(result.message);
      } else {
        await workspaceFetch(`/api/clients/${clientId}/files`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...fileForm, kind: 'link' }),
        });
      }
      setFileForm(emptyFileForm); setSelectedUpload(null); setSelectedUploadName(''); setSelectedUploadSize(null);
      if (uploadInput.current) uploadInput.current.value = '';
      await loadData();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Document could not be saved.'); }
    finally { setSavingFile(false); setUploadProgress(null); }
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
        ...(files.find((file) => file.id === editingFileId)?.source_kind === 'link' ? { file_url: fileEditForm.file_url } : {}),
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
    if (!payloadData.summary) {
      setError('The conversation summary was not returned. Try again.'); setRunningAiAction(null); return;
    }
    setAiSummary(payloadData.summary);
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
    setDraftRequestedDossier(false);

    const response = await fetch(`/api/ai/draft-message?clientId=${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: composer.body,
        subject: composer.subject,
        channel: composer.channel,
        include_dossier: includeDossierInAiDraft,
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

    const payloadData = (await response.json()) as {
      text?: string;
      subject?: string;
      cited_signals?: string[];
      dossier_requested?: boolean;
      dossier_facts_included?: string[];
    };
    setSalesTemplate(null);
    sendRequest.current = null;
    setComposer((prev) => ({
      ...prev,
      subject: payloadData.subject ?? prev.subject,
      body: payloadData.text ?? prev.body,
    }));
    setDraftCitedSignals(payloadData.cited_signals ?? []);
    setDraftRequestedDossier(payloadData.dossier_requested === true);
    setDraftDossierFacts(payloadData.dossier_facts_included ?? []);
    setDraftingAiMessage(false);
  };

  return (
    <SectionLayout title="Account">
      {!loading && loadingSavedWork ? <p role="status" className="mb-2 text-xs text-cui-muted">Loading saved notes, tasks and documents...</p> : null}
      {searchParams.get('context_type') && searchParams.get('context_id') ? <AccountContextRecord clientId={clientId} type={searchParams.get('context_type')!} id={searchParams.get('context_id')!} /> : null}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/clients" className="text-sm font-semibold text-cui-primary-strong hover:underline">
            Back to Accounts
          </Link>
          <h2 className="mt-1 text-2xl font-bold text-cui-text">{client?.full_name ?? 'Loading account workspace...'}</h2>
          <p className="text-sm text-cui-muted">
            {contactEmail ? doNotContact ? contactEmail : <a href={`mailto:${contactEmail}`} className="text-cui-primary underline-offset-2 hover:underline focus-visible:underline">{contactEmail}</a> : '--'}
            {' · '}
            {contactPhone ? doNotContact ? contactPhone : <a href={`tel:${contactPhone}`} className="text-cui-primary underline-offset-2 hover:underline focus-visible:underline">{contactPhone}</a> : '--'}
          </p>
          {client ? <div className="mt-2 max-w-md"><ContactPreferenceControl type="client" id={clientId} onValue={setDoNotContact} /></div> : null}
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-cui-muted">
          <span className="inline-flex items-center rounded-lg bg-cui-primary/10 px-3 py-1 font-semibold text-cui-primary-strong">{lifecycleStage}</span>
          <button type="button" disabled={loading || !client} onClick={() => navigate(`/policies?account_id=${clientId}`)}
            className="crm-button min-h-8 px-2 py-1.5 text-xs">Record policy</button>
          <button type="button" disabled={loading || !client} onClick={() => setShowIntake(true)}
            className="crm-button min-h-8 px-2 py-1.5 text-xs">Intake requests</button>
          <button type="button" disabled={loading || !client} onClick={() => { setProfileTab('notes'); setCompose((value) => ({ kind: 'note', token: (value?.token ?? 0) + 1 })); }}
            className="crm-button min-h-8 px-2 py-1.5 text-xs">Add note</button>
          <button type="button" disabled={loading || !client} onClick={() => { setProfileTab('tasks'); setCompose((value) => ({ kind: 'reminder', token: (value?.token ?? 0) + 1 })); }}
            className="crm-button min-h-8 px-2 py-1.5 text-xs">Add reminder</button>
          <button type="button" disabled={loading || !client} onClick={() => { setProfileTab('assets'); setAssetComposeToken((value) => value + 1); }}
            className="crm-button min-h-8 px-2 py-1.5 text-xs">Add asset</button>
          <button
            type="button"
            className="crm-button-primary relative min-h-8 px-3 py-1.5 text-xs"
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
              <p className="mt-1 text-sm text-[#5a2f2f]">Review and complete due tasks in Tasks.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setProfileTab('tasks')}
            className="rounded-lg border border-[#cf6a63] bg-white px-3 py-1.5 text-xs font-semibold text-[#7f2d2d] hover:bg-[#fff0ef]"
          >
            Review tasks
          </button>
        </div>
      ) : null}

      {error ? <div role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{error} <button type="button" onClick={() => void loadData()} className="font-semibold underline">Refresh</button></div> : null}
      {loading ? <div className="text-sm text-cui-muted">Loading client workspace...</div> : null}

      {!loading && client ? (
        <div className={`relative grid grid-cols-1 gap-4 transition-all duration-300 ${isConversationOpen ? 'xl:pr-[26rem]' : ''}`}>
          <section className="rounded-xl border border-cui-border bg-cui-panel shadow-card">
            <div className="border-b border-cui-light px-3 py-2">
              <div className="crm-tabs flex-wrap border-0 shadow-none" aria-label="Account sections">
                {([
                  ['overview', 'Overview'],
                  ['policies', 'Policies'],
                  ['quotes', 'Quotes'],
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
                    className="crm-tab"
                    onClick={() => setProfileTab(value)}
                  >
                    {label}
                  </button>
                ))}
                <details className="relative ml-auto">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-cui-muted">More</summary>
                  <div className="absolute right-0 z-20 w-44 rounded-lg border border-cui-border bg-white p-2 shadow-lg">
                    {([['activity', 'Activity history'], ['tags', 'Manage tags'], ['insights', 'Risk review']] as const).map(([value, label]) =>
                      <button key={value} type="button" className="block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-cui-light"
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
                      {openClientTasks.slice(0, 4).map((task) => <button key={task.id} onClick={() => {
                        const href = task.action_href ? taskRecordHref(task) : null;
                        if (href) navigate(href);
                        else setProfileTab('tasks');
                      }} className="block w-full border-b border-cui-border/50 py-2 text-left">
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
                      <p>Email: {contactEmail ? doNotContact ? contactEmail : <a href={`mailto:${contactEmail}`} className="break-all text-cui-primary underline-offset-2 hover:underline focus-visible:underline">{contactEmail}</a> : '--'}</p>
                      <p>Phone: {contactPhone ? doNotContact ? contactPhone : <a href={`tel:${contactPhone}`} className="text-cui-primary underline-offset-2 hover:underline focus-visible:underline">{contactPhone}</a> : '--'}</p>
                      <p>Address: {client?.address || '--'}</p>
                      <p>Account type: {client.account_type || 'Not recorded'}</p>
                      <p>Assigned agent: {client.assigned_producer || 'Unassigned'}</p>
                      <p>Preferred contact: {client.preferred_channel || 'Not recorded'}</p>
                      <p>Consent recorded: Email {client.email_consent ? 'Yes' : 'No'} · SMS {client.sms_consent ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">{tags.map((tag) => <span key={tag.id} className="rounded-lg bg-cui-light px-2 py-1 text-xs text-cui-muted">{tag.tag}</span>)}</div>
                    <div className="mt-3"><IntakeDetailsSummary value={client.intake_details} /></div>
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

                  <details className="rounded-lg border border-cui-border p-4 lg:col-span-2">
                    <summary className="cursor-pointer text-sm font-semibold text-cui-text">Linked leads & submission history</summary>
                    <div className="mt-3 flex flex-wrap gap-2">{leads.map((lead) => <Link key={lead.id} href={`/leads?lead=${lead.id}`} className="text-sm font-semibold text-cui-primary hover:underline">{lead.full_name || 'Open linked lead'}</Link>)}</div>

                    {commercialSubmissionAssets.length === 0 && personalSubmissionAssets.length === 0 ? (
                      <p className="mt-2 text-sm text-cui-muted">No linked submission data yet.</p>
                    ) : null}

                    {commercialSubmissionAssets.map((asset) => {
                      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
                      return (
                        <article key={asset.id} className="mt-3 rounded-lg border border-[#d8e3f0] bg-white p-3">
                          <p className="text-sm font-semibold text-[#14324f]">Commercial Submission</p>
                          <p className="text-xs text-cui-muted">{asset.title}</p>
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
                        <article key={asset.id} className="mt-3 rounded-lg border border-[#d8e3f0] bg-white p-3">
                          <p className="text-sm font-semibold text-[#14324f]">Personal Submission</p>
                          <p className="text-xs text-cui-muted">{asset.title}</p>
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
                  <div className="lg:col-span-2"><IntelligenceDossierPanel key={clientId} target={{ type: 'client', id: clientId }} /></div>
                </div>
              ) : null}

              {profileTab === 'policies' ? (
                <div className="space-y-3">
                  <p className="text-xs text-cui-muted">Policy details stay in sync with the Policies page.</p>
                  {client ? <PolicyServiceRequests accountId={client.id} policies={policies}
                    focusRequestId={searchParams.get('service_request')} /> : null}
                  {policies.length === 0 ? <p className="text-sm text-cui-muted">No linked policies.</p> : null}
                  {policies.map((policy) => (
                    <article key={policy.id} className="rounded-lg border border-cui-light bg-cui-panel p-3">
                      <p className="text-sm font-semibold text-[#14324f]">{policy.carrier || '--'} · {policy.line_of_business || 'Policy'}</p>
                      <p className="text-xs text-cui-muted">
                        Premium {formatCurrency(policy.premium)} · Status {policy.status || '--'} · Policy # {policy.policy_number || '--'}
                      </p>
                      <p className="mt-1 text-xs text-[#425468]">Effective {safeDateOnly(policy.effective_date)} · Renewal {safeDateOnly(policy.renewal_date)}</p>
                      <p className="text-xs text-[#425468]">Expires {safeDateOnly(policy.expiration_date)} · Billing {policy.billing_type || 'Not recorded'}</p>
                      <Link className="mt-2 inline-block text-xs font-semibold text-cui-primary underline"
                        href={`/clients/${clientId}?context_type=policy&context_id=${encodeURIComponent(policy.id)}`}>View policy term details</Link>
                      <PolicyQuoteProvenance snapshot={policy.quote_snapshot} />
                    </article>
                  ))}
                </div>
              ) : null}

              <div hidden={profileTab !== 'quotes'}>
                {visitedTabs.has('quotes') ? <QuoteOptionsPanel key={clientId} target={{ type: 'client', id: clientId }} contact={client ?? { full_name: '' }} accountId={clientId} /> : null}
              </div>
              <div hidden={profileTab !== 'assets'}>
                {visitedTabs.has('assets') ? <RecordAssetsPanel key={clientId} target={{ type: 'client', id: clientId }} composeToken={assetComposeToken} onChanged={() => void loadData()} /> : null}
              </div>
              <div hidden={profileTab !== 'notes' && profileTab !== 'tasks'}>
                {visitedTabs.has('notes') || visitedTabs.has('tasks') ? <RecordWorkPanel key={clientId} target={{ type: 'client', id: clientId }} name={client?.full_name ?? 'Account'} section={profileTab === 'notes' ? 'notes' : 'tasks'}
                  compose={compose} onChanged={() => void loadData()} onTaskCount={setOpenWorkCount} /> : null}
              </div>

              {profileTab === 'files' ? (
                <div className="space-y-4">
                  <section className="rounded-lg border border-cui-light bg-cui-panel p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Documents & References</h4>
                    <p className="mt-1 text-xs text-cui-muted">Upload a private file (up to 25 MB), or save a web reference.</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                      <input
                        className="rounded-lg border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="File name"
                        aria-label="Document name"
                        value={fileForm.file_name}
                        onChange={(e) => setFileForm((prev) => ({ ...prev, file_name: e.target.value }))}
                      />
                      <input
                        className="rounded-lg border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="File URL"
                        aria-label="External reference URL"
                        disabled={Boolean(selectedUpload) || savingFile}
                        value={fileForm.file_url}
                        onChange={(e) => setFileForm((prev) => ({ ...prev, file_url: e.target.value }))}
                      />
                      <select
                        className="rounded-lg border border-[#d8e3f0] px-3 py-2 text-sm"
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
                        ref={uploadInput}
                        aria-label="Choose document file"
                        disabled={savingFile}
                        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt"
                        className="cursor-pointer rounded-lg border border-dashed border-[#bfd2e8] bg-cui-light px-3 py-2 text-sm md:col-span-3"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          setSelectedUpload(file ?? null);
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
                            file_url: '',
                          }));
                        }}
                      />
                    </div>
                    {selectedUploadName ? (
                      <p className="mt-2 text-xs text-cui-muted">
                        Selected: {selectedUploadName}
                        {typeof selectedUploadSize === 'number' ? ` (${Math.ceil(selectedUploadSize / 1024)} KB)` : ''}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void createFileRecord()}
                      disabled={savingFile}
                      className="mt-2 rounded-lg bg-cui-primary-strong px-3 py-2 text-xs font-semibold text-white"
                    >
                      {savingFile ? `Uploading${uploadProgress === null ? '...' : ` ${uploadProgress}%`}` : selectedUpload ? 'Upload document' : 'Save reference'}
                    </button>
                  </section>

                  {files.length === 0 ? <p className="text-sm text-cui-muted">No file records yet.</p> : null}
                  {files.map((item) => (
                    <article key={item.id} className="rounded-lg border border-cui-light bg-cui-panel p-3">
                      {editingFileId === item.id ? (
                        <div className="space-y-2">
                          <input
                            className="w-full rounded-lg border border-[#d8e3f0] px-3 py-2 text-sm"
                            value={fileEditForm.file_name}
                            onChange={(e) => setFileEditForm((prev) => ({ ...prev, file_name: e.target.value }))}
                          />
                          <input
                            className="w-full rounded-lg border border-[#d8e3f0] px-3 py-2 text-sm"
                            value={fileEditForm.file_url}
                            aria-label="Edit reference URL"
                            disabled={item.source_kind !== 'link'}
                            onChange={(e) => setFileEditForm((prev) => ({ ...prev, file_url: e.target.value }))}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              className="rounded-lg border border-[#d8e3f0] px-3 py-2 text-sm"
                              value={fileEditForm.file_type}
                              onChange={(e) => setFileEditForm((prev) => ({ ...prev, file_type: e.target.value }))}
                            />
                            <input
                              className="rounded-lg border border-[#d8e3f0] px-3 py-2 text-sm"
                              value={fileEditForm.status}
                              onChange={(e) => setFileEditForm((prev) => ({ ...prev, status: e.target.value }))}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-lg bg-cui-primary-strong px-3 py-1.5 text-xs font-semibold text-white"
                              onClick={() => void saveFileEdit()}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="rounded-lg bg-cui-body px-3 py-1.5 text-xs font-semibold text-cui-muted"
                              onClick={() => setEditingFileId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-[#14324f]">{item.file_name}</p>
                          <p className="text-xs text-cui-muted">{item.file_type || '--'} · {item.status || 'uploaded'} · {safeDate(item.uploaded_at)}</p>
                          {item.source_kind === 'stored' && item.download_url ? (
                            <button type="button" className="mt-1 text-xs font-semibold text-cui-primary hover:underline" onClick={() => {
                              void downloadAccountDocument({ file_name: item.file_name, download_url: item.download_url ?? null }).then((result) => { if (!result.ok) setError(result.message); });
                            }}>Download private file</button>
                          ) : item.source_kind === 'link' && item.file_url ? (
                            <a href={item.file_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-cui-primary-strong hover:underline">
                              Open external reference
                            </a>
                          ) : <p className="mt-1 text-xs text-amber-800">Legacy record only: no stored file. Upload the original document.</p>}
                          {item.intake_review && Object.keys(item.intake_review).length ? <details className="mt-2 text-xs">
                            <summary className="cursor-pointer font-semibold text-cui-primary">Reviewed policy details</summary>
                            <dl className="mt-2 space-y-2">
                              {(Object.keys(item.intake_review) as IntakeField[]).map((field) => <div key={field}>
                                <dt className="font-semibold">{INTAKE_FIELDS[field]}</dt>
                                <dd className="whitespace-pre-wrap break-words">{item.intake_review?.[field]}</dd>
                              </div>)}
                            </dl>
                          </details> : null}
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              className="rounded-lg bg-cui-primary/10 px-3 py-1.5 text-xs font-semibold text-cui-primary-strong"
                              onClick={() => startFileEdit(item)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="rounded-lg bg-[#ffe8e8] px-3 py-1.5 text-xs font-semibold text-[#9f2f2f]"
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
                  <section className="rounded-lg border border-cui-light bg-cui-panel p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Add Tag</h4>
                    <div className="mt-2 flex gap-2">
                      <input
                        className="w-full rounded-lg border border-[#d8e3f0] px-3 py-2 text-sm"
                        placeholder="Tag"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => void createTag()}
                        className="rounded-lg bg-cui-primary-strong px-3 py-2 text-xs font-semibold text-white"
                      >
                        Add
                      </button>
                    </div>
                  </section>

                  <div className="flex flex-wrap gap-2">
                    {tags.length === 0 ? <p className="text-sm text-cui-muted">No tags yet.</p> : null}
                    {tags.map((tag) => (
                      <span key={tag.id} className="inline-flex items-center gap-2 rounded-full bg-cui-primary/10 px-3 py-1 text-xs font-semibold text-cui-primary-strong">
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
                  {activities.length === 0 ? <p className="text-sm text-cui-muted">No client activity entries yet.</p> : null}
                  {activities.map((item) => (
                    <article key={item.id} className="rounded-lg border border-cui-light bg-cui-panel p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cui-muted">{item.activity_type}</p>
                      <p className="text-sm font-semibold text-[#14324f]">{item.title}</p>
                      {item.body ? <p className="mt-1 whitespace-pre-line text-sm text-[#425468]">{item.body}</p> : null}
                      <p className="mt-1 text-xs text-cui-muted">{safeDate(item.occurred_at)}</p>
                    </article>
                  ))}
                  {activities.length >= activityLimit ? (
                    <button
                      type="button"
                      className="mt-2 rounded-lg bg-cui-primary/10 px-3 py-1.5 text-xs font-semibold text-cui-primary-strong"
                      onClick={() => setActivityLimit((prev) => prev + 80)}
                    >
                      Load more activity
                    </button>
                  ) : null}
                </div>
              ) : null}

              {profileTab === 'insights' ? (
                <div className="space-y-4">
                  {loadingCommunications ? <p role="status" className="text-sm text-cui-muted">Loading conversation for risk insights...</p> : null}
                  {communicationLoadError ? (
                    <div role="alert" className="text-sm text-red-700">
                      <p>{communicationLoadError}</p>
                      <button type="button" className="mt-1 font-semibold underline" onClick={() => setCommunicationReload((value) => value + 1)}>Retry conversation</button>
                    </div>
                  ) : null}
                  <section className="rounded-lg border border-cui-light bg-cui-panel p-3">
                    <h4 className="text-sm font-semibold text-[#14324f]">Underwriting Risk Flags</h4>
                    <button
                      type="button"
                      className="mt-2 rounded-lg bg-[#fff3de] px-3 py-2 text-xs font-semibold text-[#8a4d00] disabled:opacity-60"
                      disabled={loadingCommunications || Boolean(communicationLoadError) || runningAiAction === 'flags'}
                      onClick={() => void runRiskExtraction()}
                    >
                      Extract risk profile
                    </button>
                    <div className="mt-2 space-y-1">
                      {aiRiskSignals.length === 0 ? <p className="text-sm text-cui-muted">Run extraction to view current flags.</p> : null}
                      {aiRiskSignals.map((flag) => (
                        <p key={flag} className="text-sm text-[#425468]">• {flag}</p>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-lg border border-cui-light bg-cui-panel p-3">
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
            aria-label="Client conversation"
            aria-hidden={!isConversationOpen}
            inert={!isConversationOpen}
            className={`fixed right-0 top-0 z-[90] h-dvh w-full ${conversationExpanded ? 'max-w-none' : 'max-w-[26rem]'} transform border-l border-cui-border bg-white shadow-2xl transition-transform duration-300 ${
              isConversationOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="flex h-full flex-col">
              <div className="shrink-0 border-b border-slate-700 bg-slate-900 px-3 py-2 text-white">
                <div aria-label="Conversation toolbar" className="flex h-8 items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={client.full_name}>{client.full_name}</h3>
                  {contactPhone && !doNotContact ? <a href={`tel:${contactPhone}`}
                    aria-label={`Call ${client.full_name}`} title={`Call ${contactPhone}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-300 hover:bg-slate-800 hover:text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
                    <Phone aria-hidden="true" className="h-4 w-4" />
                  </a> : <button type="button" disabled aria-label={doNotContact ? 'Calling blocked: do not contact' : 'Call unavailable: no phone number'}
                    title={doNotContact ? 'Do not contact is enabled for this account' : 'Add a phone number to call this client'}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500">
                    <Phone aria-hidden="true" className="h-4 w-4" />
                  </button>}
                  <select aria-label="Conversation channel" value={channelFilter} disabled={scheduleBusy || savingMessage || draftingAiMessage}
                    className="h-8 shrink-0 rounded-lg border border-slate-600 bg-slate-800 px-2 text-xs font-medium text-white"
                    onChange={(event) => {
                      const channel = event.target.value === 'sms' ? 'sms' : 'email';
                      if (scheduleBusy || savingMessage || draftingAiMessage) return;
                      setChannelFilter(channel); setComposer((value) => ({ ...value, channel }));
                    }}>
                    <option value="email">Email</option><option value="sms">SMS</option>
                  </select>
                  <button type="button" aria-expanded={conversationExpanded} onClick={() => setConversationExpanded((value) => !value)}
                    aria-label={conversationExpanded ? 'Collapse' : 'Expand'} title={conversationExpanded ? 'Collapse' : 'Expand'}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white">
                    {conversationExpanded ? <Minimize2 aria-hidden="true" className="h-3.5 w-3.5" /> : <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white"
                    aria-label="Close"
                    onClick={() => setIsConversationOpen(false)}
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
                {loadingCommunications ? <span role="status" className="sr-only">Loading complete conversation...</span> : null}
                {communicationLoadError ? <p role="alert" className="mt-2 text-sm text-cui-danger">{communicationLoadError}
                  <button type="button" className="ml-2 underline" onClick={() => setCommunicationReload((value) => value + 1)}>Retry</button></p> : null}
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
              <ConversationHistory key={`${clientId}:${channelFilter}:${isConversationOpen}`} revision={communications.map((item) => `${item.id}:${item.sent_at}:${item.body}`).join('|')}>
                    {communicationNext !== null ? <button type="button" disabled={loadingOlderMessages}
                      className="text-sm font-semibold text-cui-primary" onClick={() => void loadEarlierMessages()}>
                      {loadingOlderMessages ? 'Loading earlier messages...' : 'Load earlier messages'}
                    </button> : null}
                    {channelFilter === 'email' && deliveryAudit.some((receipt) => !communications.some((message) => receiptForMessage(message.metadata, [receipt]))) ? (
                      <details className="rounded-lg border border-cui-border bg-white p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-cui-muted">Earlier email receipts</summary>
                        <div className="mt-2 space-y-3">
                          {deliveryAudit.filter((receipt) => !communications.some((message) => receiptForMessage(message.metadata, [receipt]))).map((receipt) => (
                            <article key={receipt.msg_id} className="text-xs text-cui-muted">
                              <p className="font-semibold text-cui-text">{receipt.subject || 'Email message'}</p>
                              <p>{safeDate(receipt.last_event_time)} AZ</p><EmailOpenStatus receipt={receipt} />
                            </article>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    {timeline
                      .filter((item) => item.channel === channelFilter)
                      .map((item) => {
                        const timestamp = item.sent_at;
                        const inbound = item.direction === 'inbound';
                        const receipt = !inbound && item.channel === 'email'
                          ? receiptForMessage(item.metadata, deliveryAudit) : undefined;
                        const initialStatus = typeof item.metadata?.delivery_status === 'string'
                          ? item.metadata.delivery_status : '';
                        const headline = item.subject || item.automation_type || 'Message';

                        return (
                          <article key={item.id} data-history-id={item.id} aria-label={inbound ? 'Incoming message' : 'Outgoing message'}
                            className={`flex flex-col ${inbound ? 'items-start' : 'items-end'}`}>
                              <ConversationMessage outbound={!inbound} channel={item.channel} subject={headline} body={item.body}
                                header={<>
                                  <span className="font-semibold">{inbound ? client.full_name : 'You'} · {item.channel}</span>
                                  <span>{inbound ? client.email : `To: ${client.email || client.full_name}`}</span>
                                </>} />
                              <p className="mt-1.5 px-1 text-[11px] text-slate-500">{safeDate(timestamp)} AZ</p>
                              {!inbound && item.channel === 'email' ? <div className="mt-1">
                                <EmailOpenStatus receipt={receipt} status={initialStatus} />
                              </div> : null}
                          </article>
                        );
                      })}
                    {!loadingCommunications && !communicationLoadError && !timeline.some((item) => item.channel === channelFilter)
                      ? <p className="py-8 text-center text-sm text-cui-muted">No messages yet.</p> : null}
              </ConversationHistory>
                    <section aria-label="Message composer" className="shrink-0 border-t border-slate-200 bg-white p-3">
                      {error ? <p role="alert" className="mb-2 text-sm text-cui-danger">{error}</p> : null}
                      <MessageComposer conversationKey={`client:${clientId}`} subject={composer.subject} body={composer.body} channel={composer.channel} expanded={conversationExpanded}
                        bodyDocument={bodyDocument} onDocumentChange={setBodyDocument}
                        emailDesign={salesTemplate?.email_design}
                        emailProvider={emailProvider} onEmailProviderChange={setEmailProvider}
                        reply={emailProvider === 'gmail' && composer.channel === 'email' ? <ConversationReplyControl key={`reply:${clientId}`}
                          target={{ type: 'client', id: clientId }} value={replyId} disabled={savingMessage || scheduleBusy || draftingAiMessage}
                          hasDraft={Boolean(composer.body.trim())}
                          onBusy={setScheduleBusy}
                          onChange={(id, subject) => { setReplyId(id); if (subject) setComposer((value) => ({ ...value, subject })); sendRequest.current = null; }}
                          onDraft={(body) => { setComposer((value) => ({ ...value, body })); setSalesTemplate(null); sendRequest.current = null; }} /> : null}
                        tools={<ConversationAppointment key={`appointment:${clientId}`} target={{ type: 'client', id: clientId }} name={client.full_name}
                          disabled={savingMessage || scheduleBusy || draftingAiMessage} />}
                        onSubjectChange={(subject) => setComposer((value) => ({ ...value, subject }))}
                        onBodyChange={(body) => setComposer((value) => ({ ...value, body }))}
                        disabled={scheduleBusy || savingMessage || draftingAiMessage} sender={<AgentSenderBadge />}
                        draftFeedback={error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
                        templates={<SalesTemplatePicker key={`sales:${clientId}:${composer.channel}`} conversation={`client:${clientId}`} channel={composer.channel}
                          appliedTemplate={salesTemplate} onRemove={() => {
                            setComposer((value) => ({ ...value, subject: '', body: '' })); setSalesTemplate(null); sendRequest.current = null;
                            setDraftCitedSignals([]); setDraftRequestedDossier(false); setDraftDossierFacts([]);
                          }}
                          disabled={savingMessage || scheduleBusy || draftingAiMessage} hasDraft={Boolean(composer.body.trim())} onBusy={setScheduleBusy}
                          onApply={(draft) => { setComposer((value) => ({ ...value, subject: draft.subject, body: draft.body }));
                            setSalesTemplate(draft.template); sendRequest.current = null; }}>
                          <label className="block text-xs font-semibold">Saved messages
                            <select aria-label="Message template" className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                              value={activeTemplate} disabled={savingMessage || scheduleBusy || draftingAiMessage}
                              onChange={(event) => {
                                const key = event.target.value; setActiveTemplate(key);
                                const template = messageTemplates.find((item) => item.key === key);
                                if (!template) return;
                                setSalesTemplate(null); sendRequest.current = null;
                                setComposer((previous) => ({ ...previous, subject: template.subject, body: template.body }));
                              }}>
                              <option value="">Use a template</option>
                              {messageTemplates.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
                            </select>
                          </label>
                        </SalesTemplatePicker>}
                        draftAction={<>
                          <button type="button" disabled={savingMessage || scheduleBusy || draftingAiMessage || !composer.body.trim()}
                            className={composerDraftClass} onClick={() => void draftMessageWithAi()}>
                            {draftingAiMessage ? 'Drafting...' : 'Draft with AI'}
                          </button>
                        </>}
                        actions={<>
                          <button type="button" disabled={savingMessage || scheduleBusy || draftingAiMessage || composer.channel === 'sms' || !composer.body.trim()}
                            onClick={() => void sendManualMessage()} className={composerSendClass}>
                            <Send aria-hidden="true" className="h-3.5 w-3.5" />{savingMessage ? 'Sending...' : 'Send Now'}
                          </button>
                        </>}
                        schedule={<ScheduleSend key={`schedule:${clientId}:${composer.channel}`} conversationKey={`client:${clientId}`}
                            replySelected={Boolean(replyId)}
                            template={salesTemplate} channel={composer.channel} subject={composer.subject} body={composer.body} bodyDocument={bodyDocument}
                            emailProvider={emailProvider} disabled={savingMessage || draftingAiMessage || Boolean(composerUploadFile) || selectedExistingFileIds.length > 0}
                            onBusy={setScheduleBusy} onScheduled={() => {
                              setComposer({ ...emptyComposer, channel: channelFilter }); setSalesTemplate(null); sendRequest.current = null; void loadData();
                            }}
                            onEdit={(id) => {
                              const item = scheduledMessages.find((message) => message.id === id);
                              if (!item || !agencyTime.timeZone) { setError('Refresh scheduled emails before editing.'); return; }
                              setEditSendAt(agencyDateTimeInput(new Date(item.send_at), agencyTime.timeZone)); setEditingMessage(item);
                            }}>
                            {composerUploadFile || selectedExistingFileIds.length ? <p className="text-xs text-cui-muted">
                              Scheduled attachments are not supported. Remove selected files to schedule, or use Send Now.
                            </p> : null}
                            {scheduledMessages.length >= Math.max(50, Math.floor(timelineLimit / 2)) && timelineLimit < 400 ? <button type="button"
                              className="text-xs font-semibold text-cui-primary" onClick={() => setTimelineLimit((prev) => prev + 80)}>Load more scheduled history</button> : null}
                          </ScheduleSend>}
                        footer={<>
                          {composer.channel === 'email' ? <ConversationSequences key={`sequences:${clientId}`} target={{ type: 'client', id: clientId }} /> : null}
                        </>}
                        summary={<>
                              {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
                              <button type="button" disabled={runningAiAction === 'summary' || loadingCommunications || Boolean(communicationLoadError)}
                                className="text-xs font-semibold text-cui-primary disabled:opacity-50" onClick={() => void runConversationSummary()}>
                                {runningAiAction === 'summary' ? 'Summarizing...' : 'Summarize Chat'}
                              </button>
                              {aiSummary ? <p className="text-sm">{aiSummary}</p> : null}
                        </>}
                        attachmentsSelected={Boolean(composerUploadFile) || selectedExistingFileIds.length > 0}
                        attachments={<fieldset disabled={scheduleBusy || savingMessage || draftingAiMessage} className="space-y-3">
                          <label className="block text-xs font-semibold">Attach documents
                            <input type="file" accept="application/pdf,image/*" className="mt-2 w-full text-xs"
                              onChange={(event) => setComposerUploadFile(event.target.files?.[0] ?? null)} />
                          </label>
                          {composerUploadFile ? <div className="flex items-center gap-2 text-xs">
                            <span>{composerUploadFile.name} ({Math.ceil(composerUploadFile.size / 1024)} KB)</span>
                            <button type="button" className="text-cui-primary underline" onClick={() => setComposerUploadFile(null)}>Remove upload</button>
                          </div> : null}
                          <p className="text-xs font-semibold">Client profile files</p>
                          {files.length === 0 ? <p className="text-xs">No saved files available.</p> : null}
                          {files.map((item) => <label key={item.id} className="flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={selectedExistingFileIds.includes(item.id)}
                              onChange={(event) => setSelectedExistingFileIds((previous) => event.target.checked ? [...previous, item.id] : previous.filter((id) => id !== item.id))} />
                            <span className="truncate">{item.file_name}</span>
                          </label>)}
                        </fieldset>}>
                          <fieldset disabled={scheduleBusy || savingMessage || draftingAiMessage} className="space-y-3">
                            <label className="flex items-start gap-2 text-xs text-slate-700">
                              <input type="checkbox" checked={includeDossierInAiDraft}
                                onChange={(event) => setIncludeDossierInAiDraft(event.target.checked)} />
                              <span>Include current confirmed dossier findings in this AI draft only</span>
                            </label>
                            <p className="text-[11px] text-slate-500">
                              When selected, confirmed business findings and their confirmation date are sent to AI for this draft. Evidence references stay in the CRM. Review every generated fact before sending.
                            </p>
                            {draftRequestedDossier ? <p role="status" className="text-[11px] text-slate-600">
                              {draftDossierFacts.length > 0
                                ? `Dossier findings included in the most recent draft: ${draftDossierFacts.join(', ')}`
                                : 'No current confirmed dossier findings were available; no dossier content was sent.'}
                            </p> : null}
                            {draftCitedSignals.length > 0 ? <p className="text-[11px] text-slate-600">
                              Draft grounding: {draftCitedSignals.join(' · ')}
                            </p> : null}
                        <input
                          aria-label="Message category"
                          className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                          placeholder="Message category"
                          value={composer.automationType}
                          onChange={(e) => setComposer((prev) => ({ ...prev, automationType: e.target.value }))}
                        />
                          </fieldset>
                      </MessageComposer>
                    </section>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {editingMessage ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-cui-border bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-bold text-cui-text">Edit Scheduled Message</h3>
            <div className="space-y-2">
              <input
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingMessage.subject ?? ''}
                onChange={(e) => setEditingMessage((prev) => (prev ? { ...prev, subject: e.target.value } : prev))}
              />
              <textarea
                className="min-h-28 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingMessage.body}
                onChange={(e) => setEditingMessage((prev) => (prev ? { ...prev, body: e.target.value } : prev))}
              />
              <input
                type="datetime-local"
                aria-label={`Scheduled send time - ${agencyTime.timeZone ?? 'loading'}`}
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editSendAt}
                onChange={(e) => setEditSendAt(e.target.value)}
              />
              <p className="text-xs text-cui-muted">Send time: {agencyTime.timeZone ?? 'loading agency time zone'}</p>
              <select
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingMessage.channel}
                onChange={(e) =>
                  setEditingMessage((prev) => (prev ? { ...prev, channel: e.target.value as 'email' | 'sms' } : prev))
                }
              >
                <option value="email">Email</option>
                <option value="sms" disabled>SMS - provider not connected</option>
              </select>
              <select
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingMessage.status}
                onChange={(e) =>
                  setEditingMessage((prev) =>
                    prev ? { ...prev, status: e.target.value as ScheduledMessage['status'] } : prev,
                  )
                }
              >
                <option value="pending">Pending</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void saveScheduledMessage()}
                className="w-full rounded-lg bg-cui-primary-strong px-3 py-2 text-sm font-semibold text-white hover:bg-cui-primary-hover"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingMessage(null)}
                className="w-full rounded-lg bg-cui-body px-3 py-2 text-sm font-semibold text-cui-muted hover:bg-cui-border"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showIntake ? <IntakeRequestDialog target={{ type: 'client', id: clientId }}
        onClose={() => setShowIntake(false)} onReviewed={() => void loadData()} /> : null}
    </SectionLayout>
  );
}
