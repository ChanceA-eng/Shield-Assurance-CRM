import type { UnreadMessageSummary } from './unread-messages';

export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  href: string | null;
  read: boolean;
  created_at: string;
}

export interface ShellSummary {
  overdueCount: number;
  dueTodayCount: number;
  notifications: NotificationItem[];
  unreadCount: number;
  unreadMessages: UnreadMessageSummary;
}
