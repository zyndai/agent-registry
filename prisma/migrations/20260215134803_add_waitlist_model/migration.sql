-- CreateEnum
CREATE TYPE "WaitlistRole" AS ENUM ('BUILDER', 'FOUNDER', 'INVESTOR', 'RESEARCHER', 'STUDENT', 'OTHER');

-- CreateTable
CREATE TABLE "waitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "linkedinProfile" TEXT,
    "role" "WaitlistRole" NOT NULL,
    "building" TEXT,
    "attendingAiSummit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");
