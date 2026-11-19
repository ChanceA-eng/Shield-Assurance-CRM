export interface GmailConnectionStatus {
  id: string;
  email: string;
  status: 'connected' | 'reconnect' | 'disconnected';
  last_sync_at: string | null;
  last_error: string | null;
  watch_expires_at: string | null;
  bootstrap_complete: boolean;
}

export interface MailboxSendIdentity {
  userId: string;
  connectionId: string;
  name: string;
  signature: string;
}

export interface GmailAcceptedMessage {
  provider: 'gmail';
  messageId: string;
  threadId: string;
  rfcMessageId: string;
}
