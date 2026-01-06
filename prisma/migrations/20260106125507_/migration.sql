/*
  Warnings:

  - You are about to drop the column `n8nHttpWebhookUrl` on the `agents` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "agents" DROP COLUMN "n8nHttpWebhookUrl",
ADD COLUMN     "httpWebhookUrl" TEXT;
