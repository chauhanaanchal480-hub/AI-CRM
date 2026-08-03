// Shared domain types mirroring the API contract.

export type Role = 'ADMIN' | 'SALES_MANAGER' | 'EMPLOYEE';
export type CustomerStatus = 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'CHURNED';
export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'UNQUALIFIED' | 'CONVERTED';
export type LeadSource =
  | 'WEBSITE' | 'REFERRAL' | 'COLD_CALL' | 'EVENT' | 'SOCIAL' | 'EMAIL_CAMPAIGN' | 'OTHER';
export type DealStatus = 'OPEN' | 'WON' | 'LOST';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';
export type ActivityType =
  | 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'STATUS_CHANGE' | 'FILE' | 'DEAL_UPDATE' | 'TASK' | 'AI_INSIGHT';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  avatarUrl?: string | null;
  title?: string | null;
  phone?: string | null;
  isActive: boolean;
  mfaEnabled?: boolean;
  mfaEnabledAt?: string | null;
  createdAt: string;
}

export interface UserRef {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  email?: string;
}

export interface Customer {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  status: CustomerStatus;
  tags: string[];
  website?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  notes?: string | null;
  avatarUrl?: string | null;
  ownerId: string;
  owner?: UserRef;
  createdAt: string;
  updatedAt: string;
  _count?: { deals: number; leads: number; tasks: number };
}

export interface CustomerDetail extends Customer {
  deals: Deal[];
  leads: Lead[];
  customerNotes: Note[];
  emails: EmailLog[];
  attachments: Attachment[];
  insights: AiInsight[];
  activities: Activity[];
}

export type LeadRating = 'COLD' | 'WARM' | 'HOT';

export interface Lead {
  id: string;
  title: string;
  status: LeadStatus;
  source: LeadSource;
  value: string | number;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  score?: number | null;
  scoreRating?: LeadRating | null;
  scoreReason?: string | null;
  scoredAt?: string | null;
  customerId?: string | null;
  assignedToId?: string | null;
  assignedTo?: UserRef | null;
  customer?: { id: string; name: string; company?: string | null } | null;
  createdAt: string;
}

export interface Stage {
  id: string;
  name: string;
  order: number;
  color: string;
  pipelineId: string;
}

export interface Deal {
  id: string;
  title: string;
  value: string | number;
  currency: string;
  status: DealStatus;
  probability: number;
  position: number;
  expectedCloseDate?: string | null;
  closedAt?: string | null;
  stageId: string;
  stage?: Stage;
  customerId: string;
  customer?: { id: string; name: string; company?: string | null; avatarUrl?: string | null };
  owner?: UserRef;
  ownerId: string;
  createdAt: string;
}

export interface BoardColumn extends Stage {
  deals: Deal[];
  totalValue: number;
}

export interface Board {
  pipelineId: string;
  columns: BoardColumn[];
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate?: string | null;
  completedAt?: string | null;
  assigneeId: string;
  assignee?: UserRef;
  customerId?: string | null;
  customer?: { id: string; name: string; company?: string | null } | null;
  dealId?: string | null;
  createdAt: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  summary: string;
  metadata?: Record<string, unknown> | null;
  userId: string;
  user?: UserRef;
  customerId?: string | null;
  customer?: { id: string; name: string } | null;
  createdAt: string;
}

export interface Note {
  id: string;
  body: string;
  customerId: string;
  userId: string;
  user?: UserRef;
  createdAt: string;
}

export interface EmailLog {
  id: string;
  subject: string;
  body: string;
  direction: 'INBOUND' | 'OUTBOUND';
  fromAddr: string;
  toAddr: string;
  sentAt: string;
}

export interface Attachment {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

export interface AiInsight {
  id: string;
  kind: 'SUMMARY' | 'FOLLOWUP' | 'NEXT_STEP';
  content: string;
  customerId: string;
  createdAt: string;
}

export interface FollowUpSuggestion {
  title: string;
  reason: string;
  priority: Priority;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface MeetingSummary {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  read: boolean;
  createdAt: string;
}

export interface DashboardStats {
  totalCustomers: number;
  activeCustomers: number;
  openDealsCount: number;
  openPipelineValue: number;
  wonDealsCount: number;
  wonValue: number;
  winRate: number;
  tasksDueSoon: number;
  totalLeads: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Raw API envelope for paginated list endpoints: { success, data: T[], meta }. */
export interface ListEnvelope<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
  methods: readonly ['totp', 'recovery_code'];
  risk: { level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] };
}
