-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('FULL', 'DEPOSIT', 'BALANCE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATING', 'CREATE_FAILED', 'PENDING', 'PAID', 'UNDERPAID', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'REJECTED', 'ERROR');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginGuard" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginGuard_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "onepayId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'FULL',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATING',
    "amount" DECIMAL(12,2) NOT NULL,
    "chargedAmount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "serviceName" TEXT NOT NULL,
    "clientName" TEXT,
    "clientEmail" TEXT,
    "description" TEXT,
    "checkoutUrl" TEXT,
    "livemode" BOOLEAN,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "settledAmount" DECIMAL(14,2),
    "settledAsset" TEXT,
    "provider" TEXT,
    "txidOut" TEXT,
    "verifyError" TEXT,
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT,
    "projectId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "onepayPaymentId" TEXT,
    "paymentId" TEXT,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_adminId_idx" ON "Session"("adminId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Client_key_key" ON "Client"("key");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_onepayId_key" ON "Payment"("onepayId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE INDEX "Payment_clientId_idx" ON "Payment"("clientId");

-- CreateIndex
CREATE INDEX "Payment_projectId_idx" ON "Payment"("projectId");

-- CreateIndex
CREATE INDEX "Note_paymentId_createdAt_idx" ON "Note"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_paymentId_idx" ON "WebhookEvent"("paymentId");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
