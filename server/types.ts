export type UserRole = 'user' | 'admin' | 'super_admin';
export type UserStatus = 'active' | 'suspended';
export type ThemePreference = 'light' | 'dark';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  googleId: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  preferredTheme: ThemePreference;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingProfile {
  userId: string;
  preferredTheme: ThemePreference;
  discoverySource: 'Google' | 'Instagram' | 'YouTube' | 'Facebook' | 'X' | 'Other';
  projectPurpose: 'Personal' | 'Business' | 'Organization' | 'Institution' | 'Government';
  projectScale: 'Small' | 'Medium' | 'Large' | 'Enterprise';
  completedAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string;
  ipAddress: string;
  expiresAt: string;
  createdAt: string;
}

export interface PasswordResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface PlanRecord {
  id: string;
  slug: string;
  name: string;
  audience: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number;
  monthlyPriceInr: number;
  monthlyCredits: number;
  maxProjects: number;
  rateLimitRpm: number;
  dailyRequestLimit: number;
  customDomainsEnabled: boolean;
  features: string[];
  active: boolean;
  sortOrder: number;
}

export interface WalletRecord {
  userId: string;
  balanceCredits: number;
  lifetimeCreditsPurchased: number;
  lifetimeCreditsUsed: number;
  lowCreditThreshold: number;
  updatedAt: string;
}

export interface CreditTransactionRecord {
  id: string;
  userId: string;
  type: 'grant' | 'topup' | 'deduction' | 'refund' | 'admin_adjustment';
  amount: number;
  balanceAfter: number;
  idempotencyKey: string | null;
  referenceId: string | null;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SubscriptionRecord {
  id: string;
  userId: string;
  planId: string;
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  billingCycle: 'monthly' | 'annual';
  provider: 'internal' | 'razorpay' | 'stripe';
  externalSubscriptionId: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  provider: 'razorpay' | 'stripe' | 'internal';
  providerOrderId: string | null;
  providerPaymentId: string | null;
  kind: 'subscription' | 'credit_topup';
  planId: string | null;
  creditsGranted: number;
  amount: number;
  currency: string;
  status: 'created' | 'verified' | 'failed' | 'refunded';
  verifiedAt: string | null;
  createdAt: string;
}

export interface InvoiceRecord {
  id: string;
  paymentId: string;
  userId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: 'paid' | 'refunded' | 'pending';
  issuedAt: string;
}

export type ProviderKind = 'vektor_self_hosted' | 'gemini' | 'openai' | 'deepseek' | 'openai_compatible';
export type ProviderStatus = 'available' | 'unconfigured' | 'offline' | 'error';

export interface AiProviderRecord {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string | null;
  apiKeyEnvVar: string | null;
  encryptedApiKey: string | null;
  enabled: boolean;
  status: ProviderStatus;
  lastCheckedAt: string | null;
}

export interface AiModelRecord {
  id: string;
  providerId: string;
  modelIdentifier: string;
  displayName: string;
  roleTag: string;
  inputCreditsPer1k: number;
  outputCreditsPer1k: number;
  maxContextTokens: number;
  supportsStreaming: boolean;
  enabled: boolean;
  isPreferredCoding: boolean;
}

export type TaskType =
  | 'orchestration'
  | 'coding'
  | 'app_creation'
  | 'reasoning'
  | 'design_ux'
  | 'testing_debug'
  | 'publishing';

export interface TaskRoutingRule {
  taskType: TaskType;
  primaryModelId: string;
  fallbackModelId: string | null;
  description: string;
  updatedAt: string;
}

export interface SelfHostedModelConfig {
  modelName: string;
  inferenceServerUrl: string;
  weightsPath: string;
  hasApiKey: boolean;
  status: 'unconfigured' | 'weights_missing' | 'server_unreachable' | 'healthy';
  lastCheckedAt: string | null;
  lastMessage: string;
  discoveredModels?: string[];
  runtimeDetected?: string | null;
  latencyMs?: number | null;
}

export interface VektorApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  permissions: string[];
  rateLimitRpm: number;
  isInternal: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface GatewayLogRecord {
  id: string;
  apiKeyId: string | null;
  userId: string | null;
  endpoint: string;
  requestedModel: string;
  routedModel: string;
  promptTokens: number;
  completionTokens: number;
  creditsCharged: number;
  latencyMs: number;
  statusCode: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface ProjectFileRecord {
  id: string;
  projectId: string;
  path: string;
  content: string;
  language: string;
  updatedAt: string;
}

export interface ProjectVersionRecord {
  id: string;
  projectId: string;
  versionNumber: number;
  summary: string;
  filesSnapshot: Array<{ path: string; content: string; language: string }>;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  projectId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelUsed?: string;
  tokensUsed?: number;
  latencyMs?: number;
  createdAt: string;
}

export interface OrchestrationTaskStep {
  stepKey: string;
  title: string;
  taskType: TaskType;
  assignedModelId: string;
  actualModelUsed: string | null;
  status: 'pending' | 'running' | 'completed' | 'paused' | 'failed';
  latencyMs: number;
  tokensUsed: number;
  outputSummary: string | null;
}

export interface JobEventRecord {
  id: string;
  timestamp: string;
  type: 'job_started' | 'task_delegated' | 'model_response' | 'file_written' | 'checkpoint_saved' | 'low_credit_warning' | 'job_paused' | 'job_stopped' | 'job_completed' | 'job_error';
  message: string;
  meta?: Record<string, unknown>;
}

export interface OrchestrationJobRecord {
  id: string;
  projectId: string;
  userId: string;
  prompt: string;
  requestedModelId: string;
  status: 'queued' | 'running' | 'paused_insufficient_credits' | 'stopped' | 'completed' | 'failed';
  currentStepIndex: number;
  tasks: OrchestrationTaskStep[];
  events: JobEventRecord[];
  tokensUsed: number;
  creditsUsed: number;
  latencyMs: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  description: string;
  status: 'draft' | 'building' | 'ready' | 'paused_credits' | 'failed' | 'published';
  selectedModelId: string;
  previewSlug: string | null;
  activeVersionId: string | null;
  totalTokensUsed: number;
  githubRepoFullName: string | null;
  githubBranch: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentRecord {
  id: string;
  projectId: string;
  userId: string;
  slug: string;
  liveUrl: string;
  versionId: string | null;
  status: 'building' | 'live' | 'failed';
  logs: string[];
  publishedAt: string;
}

export interface CustomDomainRecord {
  id: string;
  projectId: string;
  userId: string;
  domain: string;
  verificationToken: string;
  dnsVerified: boolean;
  sslStatus: 'pending' | 'provisioning' | 'active' | 'failed';
  status: 'pending_verification' | 'verified' | 'active' | 'failed';
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface GithubConnectionRecord {
  userId: string;
  githubUserId: string;
  githubUsername: string;
  avatarUrl: string | null;
  accessTokenEncrypted: string;
  connectedAt: string;
}

export interface ErrorLogRecord {
  id: string;
  source: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  message: string;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface VektorDatabaseState {
  users: UserRecord[];
  onboardingProfiles: OnboardingProfile[];
  sessions: SessionRecord[];
  passwordResets: PasswordResetRecord[];
  plans: PlanRecord[];
  wallets: WalletRecord[];
  creditTransactions: CreditTransactionRecord[];
  subscriptions: SubscriptionRecord[];
  payments: PaymentRecord[];
  invoices: InvoiceRecord[];
  aiProviders: AiProviderRecord[];
  aiModels: AiModelRecord[];
  taskRoutingRules: TaskRoutingRule[];
  selfHostedConfig: SelfHostedModelConfig;
  vektorApiKeys: VektorApiKeyRecord[];
  gatewayLogs: GatewayLogRecord[];
  projects: ProjectRecord[];
  projectFiles: ProjectFileRecord[];
  projectVersions: ProjectVersionRecord[];
  chatMessages: ChatMessageRecord[];
  orchestrationJobs: OrchestrationJobRecord[];
  deployments: DeploymentRecord[];
  customDomains: CustomDomainRecord[];
  githubConnections: GithubConnectionRecord[];
  errorLogs: ErrorLogRecord[];
}
