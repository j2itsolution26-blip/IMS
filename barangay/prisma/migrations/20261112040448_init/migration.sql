-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CAPTAIN', 'SECRETARY', 'TREASURER', 'KAGAWAD', 'LUPON', 'STAFF');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "CivilStatus" AS ENUM ('SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED', 'LIVE_IN');

-- CreateEnum
CREATE TYPE "ResidentStatus" AS ENUM ('ACTIVE', 'MOVED_OUT', 'DECEASED');

-- CreateEnum
CREATE TYPE "CertificateTemplate" AS ENUM ('CLEARANCE', 'RESIDENCY', 'INDIGENCY', 'BUSINESS', 'GENERIC');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ISSUED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CaseKind" AS ENUM ('BLOTTER', 'KP');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('RECORDED', 'MEDIATION', 'CONCILIATION', 'ARBITRATION', 'SETTLED', 'CFA_ISSUED', 'DISMISSED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarangaySettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "barangayName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "hallAddress" TEXT NOT NULL DEFAULT '',
    "contactNumber" TEXT NOT NULL DEFAULT '',
    "captainName" TEXT NOT NULL,
    "secretaryName" TEXT NOT NULL DEFAULT '',
    "treasurerName" TEXT NOT NULL DEFAULT '',
    "validityDays" INTEGER NOT NULL DEFAULT 180,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BarangaySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purok" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purok_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "householdNo" TEXT NOT NULL,
    "purokId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resident" (
    "id" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "sex" "Sex" NOT NULL,
    "birthDate" DATE NOT NULL,
    "birthPlace" TEXT NOT NULL DEFAULT '',
    "civilStatus" "CivilStatus" NOT NULL,
    "citizenship" TEXT NOT NULL DEFAULT 'Filipino',
    "occupation" TEXT NOT NULL DEFAULT '',
    "contactNumber" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL,
    "purokId" TEXT NOT NULL,
    "householdId" TEXT,
    "relationshipToHead" TEXT NOT NULL DEFAULT '',
    "residentSince" INTEGER,
    "isVoter" BOOLEAN NOT NULL DEFAULT false,
    "isPwd" BOOLEAN NOT NULL DEFAULT false,
    "is4Ps" BOOLEAN NOT NULL DEFAULT false,
    "isSoloParent" BOOLEAN NOT NULL DEFAULT false,
    "isIndigent" BOOLEAN NOT NULL DEFAULT false,
    "status" "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template" "CertificateTemplate" NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "controlNo" TEXT NOT NULL,
    "verifyCode" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "businessName" TEXT NOT NULL DEFAULT '',
    "businessAddress" TEXT NOT NULL DEFAULT '',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "issuedById" TEXT NOT NULL,
    "receiptId" TEXT,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ISSUED',
    "revokedReason" TEXT NOT NULL DEFAULT '',
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "orNumber" TEXT NOT NULL,
    "payorName" TEXT NOT NULL,
    "residentId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedById" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PAID',
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlotterCase" (
    "id" TEXT NOT NULL,
    "caseNo" TEXT NOT NULL,
    "kind" "CaseKind" NOT NULL,
    "complainant" TEXT NOT NULL,
    "respondent" TEXT NOT NULL,
    "natureOfCase" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "incidentAt" TIMESTAMP(3) NOT NULL,
    "incidentPlace" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'RECORDED',
    "resolution" TEXT NOT NULL DEFAULT '',
    "filedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "recordedById" TEXT NOT NULL,

    CONSTRAINT "BlotterCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hearing" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "stage" "CaseStatus" NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hearing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_username_createdAt_idx" ON "LoginAttempt"("username", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Purok_name_key" ON "Purok"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Household_householdNo_key" ON "Household"("householdNo");

-- CreateIndex
CREATE INDEX "Resident_lastName_firstName_idx" ON "Resident"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Resident_purokId_idx" ON "Resident"("purokId");

-- CreateIndex
CREATE INDEX "Resident_status_idx" ON "Resident"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_name_key" ON "DocumentType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_controlNo_key" ON "Certificate"("controlNo");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_verifyCode_key" ON "Certificate"("verifyCode");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_receiptId_key" ON "Certificate"("receiptId");

-- CreateIndex
CREATE INDEX "Certificate_issuedAt_idx" ON "Certificate"("issuedAt");

-- CreateIndex
CREATE INDEX "Certificate_residentId_idx" ON "Certificate"("residentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_orNumber_key" ON "Receipt"("orNumber");

-- CreateIndex
CREATE INDEX "Receipt_paidAt_idx" ON "Receipt"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlotterCase_caseNo_key" ON "BlotterCase"("caseNo");

-- CreateIndex
CREATE INDEX "BlotterCase_status_idx" ON "BlotterCase"("status");

-- CreateIndex
CREATE INDEX "BlotterCase_filedAt_idx" ON "BlotterCase"("filedAt");

-- CreateIndex
CREATE INDEX "Hearing_caseId_idx" ON "Hearing"("caseId");

-- CreateIndex
CREATE INDEX "Hearing_scheduledAt_idx" ON "Hearing"("scheduledAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Household" ADD CONSTRAINT "Household_purokId_fkey" FOREIGN KEY ("purokId") REFERENCES "Purok"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_purokId_fkey" FOREIGN KEY ("purokId") REFERENCES "Purok"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlotterCase" ADD CONSTRAINT "BlotterCase_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "BlotterCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
