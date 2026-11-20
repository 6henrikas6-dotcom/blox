CREATE TABLE "DigitalOrder" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "buyerId" TEXT,
    "productName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DigitalOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DigitalOrder_guildId_orderNumber_key" ON "DigitalOrder"("guildId","orderNumber");
CREATE INDEX "DigitalOrder_guildId_buyerId_idx" ON "DigitalOrder"("guildId","buyerId");
CREATE TABLE "DigitalOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productNumber" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "fileName" TEXT,
    "fileMime" TEXT,
    "fileData" BYTEA,
    "deliveryState" TEXT NOT NULL DEFAULT 'pending',
    "deliveredTo" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DigitalOrderItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DigitalOrderItem_orderId_productNumber_key" ON "DigitalOrderItem"("orderId","productNumber");
ALTER TABLE "DigitalOrderItem" ADD CONSTRAINT "DigitalOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DigitalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
