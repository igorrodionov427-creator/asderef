export type PaymentStatus = "CREATING" | "CREATE_FAILED" | "PENDING" | "PAID" | "UNDERPAID" | "EXPIRED" | "FAILED";
export type PaymentKind = "FULL" | "DEPOSIT" | "BALANCE";

export interface Note {
  id: string;
  body: string;
  createdAt: string;
}

export interface WebhookEventRow {
  id: string;
  eventId: string;
  type: string;
  status: string;
  error: string | null;
  receivedAt: string;
  attempts: number;
}

export interface Payment {
  id: string;
  onepayId: string | null;
  kind: PaymentKind;
  status: PaymentStatus;
  amount: string;
  chargedAmount: string | null;
  currency: string;
  serviceName: string;
  clientName: string | null;
  clientEmail: string | null;
  description: string | null;
  checkoutUrl: string | null;
  livemode: boolean | null;
  expiresAt: string | null;
  paidAt: string | null;
  settledAmount: string | null;
  settledAsset: string | null;
  provider: string | null;
  txidOut: string | null;
  verifyError: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clientId: string | null;
  projectId: string | null;
  notes?: Note[];
  events?: WebhookEventRow[];
  project?: { id: string; serviceName: string; totalAmount: string; currency: string } | null;
}

export interface Stats {
  totals: {
    revenue: string;
    payments: number;
    paid: number;
    pending: number;
    failed: number;
    breakdown: { expired: number; underpaid: number; failed: number };
  };
  range: { days: number; revenue: string; paidCount: number; series: { date: string; revenue: number; count: number }[] };
  recent: Payment[];
}

export interface Project {
  id: string;
  serviceName: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  client: { id: string; name: string | null; email: string | null } | null;
  paid: string;
  remaining: string;
  payments: Payment[];
}

export interface ClientRow {
  id: string;
  name: string | null;
  email: string | null;
  paymentsCount: number;
  lastService: string | null;
  lastAmount: string | null;
}

export interface ServerConfig {
  onepayConfigured: boolean;
  livemode: boolean | null;
  webhookSecretConfigured: boolean;
  webhookUrl: string | null;
  cardOnly: boolean;
  cronConfigured: boolean;
}
