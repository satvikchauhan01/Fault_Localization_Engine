-- CreateTable
CREATE TABLE "sim_true_topology" (
    "pole_id" TEXT NOT NULL,
    "parent_pole_id" TEXT,

    CONSTRAINT "sim_true_topology_pkey" PRIMARY KEY ("pole_id")
);
