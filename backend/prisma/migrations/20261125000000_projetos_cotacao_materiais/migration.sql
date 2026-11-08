-- Materiais da cotação do Financeiro (PT-05 do plano projeto aprovado → obra, PA-08): o Financeiro passa a
-- devolver os materiais a enviar ao site, cada um com o código do catálogo da Logística.
-- Só aditivo. Sem preço, custo ou frete: isso fica no Financeiro.
-- `logistics_material_id` é resolvido no servidor pelo código (PT-06); fica nulo por enquanto.

-- CreateTable
CREATE TABLE "project_quote_materials" (
    "id" TEXT NOT NULL,
    "project_quote_id" TEXT NOT NULL,
    "material_code" TEXT NOT NULL,
    "logistics_material_id" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "project_quote_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_quote_materials_project_quote_id_material_code_key" ON "project_quote_materials"("project_quote_id", "material_code");

-- AddForeignKey
ALTER TABLE "project_quote_materials" ADD CONSTRAINT "project_quote_materials_project_quote_id_fkey" FOREIGN KEY ("project_quote_id") REFERENCES "project_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
