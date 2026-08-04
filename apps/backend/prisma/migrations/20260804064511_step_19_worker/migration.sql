/*
  Warnings:

  - Changed the type of `topology_source` on the `incidents` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `evidence_type` to the `pole_states` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `source` on the `topology_edges` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `topology_source` on the `transformers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "GroundTruthTopologySource" AS ENUM ('RECORDED', 'MISSING');

-- CreateEnum
CREATE TYPE "EdgeTopologySource" AS ENUM ('AUTHORITATIVE', 'INFERRED');

-- AlterTable
ALTER TABLE "incidents" DROP COLUMN "topology_source",
ADD COLUMN     "topology_source" "EdgeTopologySource" NOT NULL;

-- AlterTable
ALTER TABLE "pole_states" ADD COLUMN     "candidate_dark_since" TIMESTAMP(3),
ADD COLUMN     "evidence_type" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "topology_edges" DROP COLUMN "source",
ADD COLUMN     "source" "EdgeTopologySource" NOT NULL;

-- AlterTable
ALTER TABLE "transformers" DROP COLUMN "topology_source",
ADD COLUMN     "topology_source" "GroundTruthTopologySource" NOT NULL;

-- DropEnum
DROP TYPE "TopologySource";
