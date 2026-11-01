-- CreateTable
CREATE TABLE "user_logistics_roles" (
    "axis_user_id" TEXT NOT NULL,
    "logistics_role_id" TEXT NOT NULL,
    "granted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_logistics_roles_pkey" PRIMARY KEY ("axis_user_id","logistics_role_id")
);

-- AddForeignKey
ALTER TABLE "user_logistics_roles" ADD CONSTRAINT "user_logistics_roles_logistics_role_id_fkey" FOREIGN KEY ("logistics_role_id") REFERENCES "logistics_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
