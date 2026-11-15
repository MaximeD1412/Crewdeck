-- CreateEnum
CREATE TYPE "mcp_transport" AS ENUM ('stdio', 'http');

-- CreateEnum
CREATE TYPE "mcp_server_state" AS ENUM ('ready', 'failed');

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "transport" "mcp_transport" NOT NULL,
    "state" "mcp_server_state" NOT NULL,
    "tool_count" INTEGER,
    "reported_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_pilot_id_name_key" ON "mcp_servers"("pilot_id", "name");

-- AddForeignKey
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

