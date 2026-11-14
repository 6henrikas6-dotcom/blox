CREATE TABLE "Giveaway" ("id" TEXT NOT NULL,"guildId" TEXT NOT NULL,"channelId" TEXT NOT NULL,"messageId" TEXT NOT NULL,"prize" TEXT NOT NULL,"winnerCount" INTEGER NOT NULL DEFAULT 1,"endsAt" TIMESTAMP(3) NOT NULL,"ended" BOOLEAN NOT NULL DEFAULT false,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "Giveaway_pkey" PRIMARY KEY ("id"));
CREATE TABLE "GiveawayEntry" ("giveawayId" TEXT NOT NULL,"userId" TEXT NOT NULL,CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("giveawayId","userId"));
CREATE UNIQUE INDEX "Giveaway_messageId_key" ON "Giveaway"("messageId");
CREATE INDEX "Giveaway_guildId_ended_endsAt_idx" ON "Giveaway"("guildId","ended","endsAt");
