import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const decidePurchase = vi.fn().mockResolvedValue({});
vi.mock("../src/api/requests", () => ({
  requestsApi: {
    decidePurchase: (...args: unknown[]) => decidePurchase(...args),
    purchaseQuotation: vi.fn().mockResolvedValue({}),
    deletePurchaseQuotation: vi.fn().mockResolvedValue({}),
    submitPurchaseForApproval: vi.fn().mockResolvedValue({}),
    attachment: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

import { PurchaseQuotations } from "../src/components/PurchaseQuotations";

const purchaseItems = [
  { materialId: "m1", item: "Cabo UTP", unit: "m", quantity: 3, unitPrice: "1" },
  { materialId: "m2", item: "Conector", unit: "un", quantity: 2, unitPrice: "1" },
];

function detail(extra: Record<string, unknown> = {}, status = "aguardando_aprovacao") {
  return {
    id: "req-1",
    status,
    attachments: [],
    formData: {
      purchaseItems,
      procurementAnalysis: { items: purchaseItems.map((i) => ({ materialId: i.materialId, needsQuotation: true })) },
      procurementQuotations: [
        { quotationId: "qa", supplier: "Forn A", quoteNumber: "10", totalValue: "29.00", items: [{ materialId: "m1", unitPrice: "3.0000" }, { materialId: "m2", unitPrice: "10.0000" }] },
        { quotationId: "qb", supplier: "Forn B", totalValue: "6.00", items: [{ materialId: "m1", unitPrice: "2.0000" }] },
      ],
      ...extra,
    },
  } as never;
}

describe("PurchaseQuotations", () => {
  beforeEach(() => decidePurchase.mockClear());
  afterEach(cleanup);

  it("mostra o mapa comparativo com o menor preço e célula vazia quando não cotou", () => {
    render(<PurchaseQuotations request={detail()} purchaseItems={purchaseItems} canQuote={false} canDecide={false} onChanged={vi.fn()} />);
    expect(screen.getByText("Mapa comparativo")).toBeTruthy();
    expect(screen.getAllByText("Menor preço").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("—", { selector: "td" })).toBeTruthy();
    expect(screen.queryByText("Aprovar compra")).toBeNull();
  });

  it("responsável pré-seleciona o menor preço e aprova com a escolha por item", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<PurchaseQuotations request={detail()} purchaseItems={purchaseItems} canQuote={false} canDecide onChanged={onChanged} />);
    expect(screen.getByRole("status").textContent).toContain("2 fornecedores");
    fireEvent.click(screen.getByText("Aprovar compra"));
    await waitFor(() => expect(decidePurchase).toHaveBeenCalled());
    expect(decidePurchase).toHaveBeenCalledWith("req-1", {
      decision: "aprovar",
      selections: [{ materialId: "m1", quotationId: "qb" }, { materialId: "m2", quotationId: "qa" }],
    });
  });

  it("trocar o radio muda a seleção enviada", async () => {
    render(<PurchaseQuotations request={detail()} purchaseItems={purchaseItems} canQuote={false} canDecide onChanged={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByLabelText("Escolher Forn A para Cabo UTP"));
    expect(screen.getByRole("status").textContent).toContain("1 fornecedor");
    fireEvent.click(screen.getByText("Aprovar compra"));
    await waitFor(() => expect(decidePurchase).toHaveBeenCalled());
    expect(decidePurchase.mock.calls[0][1].selections[0]).toEqual({ materialId: "m1", quotationId: "qa" });
  });

  it("depois de aprovada mostra os fornecedores escolhidos", () => {
    const selection = [
      { materialId: "m1", quotationId: "qb", supplier: "Forn B", unitPrice: "2.0000", quantity: 3, total: "6.00" },
      { materialId: "m2", quotationId: "qa", supplier: "Forn A", unitPrice: "10.0000", quantity: 2, total: "20.00" },
    ];
    render(<PurchaseQuotations request={detail({ procurementSelection: selection }, "aprovada")} purchaseItems={purchaseItems} canQuote={false} canDecide={false} onChanged={vi.fn()} />);
    expect(screen.getByText("Fornecedores escolhidos")).toBeTruthy();
    expect(screen.getAllByText("Escolhido").length).toBe(2);
  });

  it("Suprimentos: enviar para aprovação fica desabilitado enquanto falta cotação de item", () => {
    const partial = detail({ procurementQuotations: [{ quotationId: "qb", supplier: "Forn B", totalValue: "6.00", items: [{ materialId: "m1", unitPrice: "2.0000" }] }] }, "em_atendimento");
    render(<PurchaseQuotations request={partial} purchaseItems={purchaseItems} canQuote canDecide={false} onChanged={vi.fn()} />);
    const button = screen.getByText("Enviar para aprovação") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("Conector");
  });

  it("cotação no formato antigo aparece como somente leitura, sem Editar", () => {
    const legacy = detail({ procurementQuotations: [{ quotationId: "legacy-1", supplier: "Velho", totalValue: "10.00" }] }, "em_atendimento");
    render(<PurchaseQuotations request={legacy} purchaseItems={purchaseItems} canQuote canDecide={false} onChanged={vi.fn()} />);
    expect(screen.getByText("Formato antigo (somente leitura)")).toBeTruthy();
    expect(screen.queryByText("Editar")).toBeNull();
    expect(screen.getByText("Excluir")).toBeTruthy();
  });
});
