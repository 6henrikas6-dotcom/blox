CREATE TABLE "GuildConfig" (
 "guildId" TEXT NOT NULL,
 "logChannelId" TEXT,
 "announcementChannelId" TEXT,
 "verifiedRoleId" TEXT,
 "joinThreshold" INTEGER NOT NULL DEFAULT 8,
 "lockdown" BOOLEAN NOT NULL DEFAULT false,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("guildId")
);
CREATE TABLE "Subscription" (
 "guildId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT true,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "Subscription_pkey" PRIMARY KEY ("guildId","userId")
);
CREATE TABLE "ModerationCase" (
 "id" TEXT NOT NULL,
 "guildId" TEXT NOT NULL,
 "targetId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "reason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModerationCase_guildId_targetId_idx" ON "ModerationCase"("guildId","targetId");
CREATE TABLE "AuditEvent" (
 "id" TEXT NOT NULL,
 "guildId" TEXT NOT NULL,
 "actorId" TEXT,
 "event" TEXT NOT NULL,
 "detail" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditEvent_guildId_createdAt_idx" ON "AuditEvent"("guildId","createdAt");
CREATE TABLE "Xp" (
 "guildId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "points" INTEGER NOT NULL DEFAULT 0,
 "lastEarnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Xp_pkey" PRIMARY KEY ("guildId","userId")
);

CREATE TABLE "LockdownOverwrite" (
 "guildId" TEXT NOT NULL,
 "channelId" TEXT NOT NULL,
 "previous" TEXT NOT NULL,
 CONSTRAINT "LockdownOverwrite_pkey" PRIMARY KEY ("guildId","channelId")
);
