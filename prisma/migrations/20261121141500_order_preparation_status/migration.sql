ALTER TABLE "DigitalOrderItem" ADD COLUMN IF NOT EXISTS "preparationStatus" TEXT NOT NULL DEFAULT 'preparing';
UPDATE "DigitalOrderItem" SET "preparationStatus" = 'ready' WHERE "fileName" IS NOT NULL AND "preparationStatus" = 'preparing';
