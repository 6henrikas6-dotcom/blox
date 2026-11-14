CREATE TABLE "CommunityAutomation" (
 "guildId" TEXT NOT NULL PRIMARY KEY,
 "welcomeChannelId" TEXT,
 "goodbyeChannelId" TEXT,
 "inviteLogChannelId" TEXT,
 "levelChannelId" TEXT,
 "welcomeMessage" TEXT NOT NULL DEFAULT '👋 Sveikas atvykęs, {user}! Tu esi {count}-asis narys.',
 "goodbyeMessage" TEXT NOT NULL DEFAULT '👋 {username} paliko serverį.',
 "levelMessage" TEXT NOT NULL DEFAULT '🎉 {user} pasiekė {level} lygį!',
 "xpEnabled" BOOLEAN NOT NULL DEFAULT true,
 "xpPerMessage" INTEGER NOT NULL DEFAULT 5,
 "xpCooldownSeconds" INTEGER NOT NULL DEFAULT 60,
 "levelUpEnabled" BOOLEAN NOT NULL DEFAULT true,
 "inviteTrackingEnabled" BOOLEAN NOT NULL DEFAULT true,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "MemberInvite" (
 "guildId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "inviterId" TEXT,
 "inviteCode" TEXT,
 "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MemberInvite_pkey" PRIMARY KEY ("guildId","userId")
);
CREATE INDEX "MemberInvite_guildId_inviterId_idx" ON "MemberInvite"("guildId","inviterId");
