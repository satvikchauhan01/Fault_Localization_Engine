/*
  Warnings:

  - Added the required column `historical_affected_pole_ids` to the `incidents` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "historical_affected_pole_ids" JSONB NOT NULL;
