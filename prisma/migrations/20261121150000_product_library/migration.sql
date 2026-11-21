CREATE TABLE IF NOT EXISTS "ProductLibraryItem" (
 "id" TEXT NOT NULL,
 "guildId" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "fileName" TEXT NOT NULL,
 "fileMime" TEXT NOT NULL,
 "fileSize" INTEGER NOT NULL,
 "fileData" BYTEA NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ProductLibraryItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProductLibraryItem_guildId_createdAt_idx" ON "ProductLibraryItem"("guildId","createdAt");
