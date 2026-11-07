import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const purchaseOrder = vi.fn().mockResolvedValue({});
const confirmReceipt = vi.fn().mockResolvedValue({});
vi.mock("../src/api/requests", () => ({
  requestsApi: {
    purchaseOrder: (...args: unknown[]) => purchaseOrder(...args),
    confirmReceipt: (...args: unknown[]) => confirmReceipt(...args),
  },
}));

import { PurchaseDeliveries } from "../src/components/PurchaseDeliveries";
import { deliveryGroups, formatIsoDate, latestPendingForecast } from "../src/utils/purchaseDeliveries";

const purchaseItems = [
  { materialId: "m1", item: "Cabo UTP", quantity: 3, unitPrice: "1" },
  { materialId: "m2", item: "Conector", quantity: 2, unitPrice: "1" },
  { materialId: "m3", item: "Fita", quantity: 1, unitPrice: "1" },
] as never[];
const selection = [
  { materialId: "m1", quotationId: "qa", supplier: "Forn A", unitPrice: "2.0000", quantity: 3, total: "6.00" },
  { materialId: "m2", quotationId: "qb", supplier: "Forn B", unitPrice: "1.0000", quantity: 2, total: "2.00" },
];
// m3 sai do estoque.

const delivery = (groupId: string, supplier: string, extra: Record<string, unknown> = {}) => ({
  groupId,
  supplier,
  items: [{ materialId: "m1", item: "Cabo UTP", quantity: 3 }],
  orderNumber: "PC-1",
  orderDate: "2026-11-10",
  expectedDeliveryDate: "2026-11-20",
  notes: "",
  receivedAt: null,
  receivedBy: null,
  history: [{ expectedDeliveryDate: "2026-11-20", changedAt: "2026-11-10T12:00:00Z", changedBy: "x" }],
  ...extra,
});

function detail(status: string, deliveries?: unknown[]) {
  return { id: "req-1", status, formData: { purchaseItems, procurementSelection: selection, ...(deliveries ? { procurementDeliveries: deliveries } : {}) } } as never;
}

describe("deliveryGroups", () => {
  it("agrupa por fornecedor e cria o grupo Estoque", () => {
    const groups = deliveryGroups(purchaseItems, selection as never);
    expect(groups.map((g) => [g.groupId, g.supplier])).toEqual([["qa", "Forn A"], ["qb", "Forn B"], ["estoque", "Estoque"]]);
  });

  it("junta cotações do mesmo fornecedor no primeiro quotationId", () => {
    const groups = deliveryGroups(purchaseItems, [selection[0], { ...selection[1], supplier: " forn a ", quotationId: "qz" }] as never);
    expect(groups.filter((g) => g.groupId !== "estoque")).toHaveLength(1);
    expect(groups[0].groupId).toBe("qa");
    expect(groups[0].items).toHaveLength(2);
  });

  it("formata datas sem deslocar o dia e acha a previsão mais distante pendente", () => {
    expect(formatIsoDate("2026-11-20")).toBe("20/11/2026");
    expect(latestPendingForecast([delivery("a", "A"), delivery("b", "B", { expectedDeliveryDate: "2026-12-01" }), delivery("c", "C", { expectedDeliveryDate: "2027-01-01", receivedAt: "x" })] as never)).toBe("2026-12-01");
  });
});

describe("PurchaseDeliveries", () => {
  beforeEach(() => {
    purchaseOrder.mockClear();
    confirmReceipt.mockClear();
  });
  afterEach(cleanup);

  it("Suprimentos em aprovada vê um cartão por grupo e exige a previsão", async () => {
    render(<PurchaseDeliveries request={detail("aprovada")} purchaseItems={purchaseItems} canOrder canConfirm={false} onChanged={vi.fn()} />);
    expect(screen.getByText("Pedido ao fornecedor")).toBeTruthy();
    expect(screen.getAllByText("Forn A").length).toBeGreaterThan(0);
    expect(screen.getByText("Estoque")).toBeTruthy();
    fireEvent.click(screen.getByText("Registrar pedido e informar previsão"));
    expect((await screen.findByRole("alert")).textContent).toContain("Informe a previsão de entrega");
    expect(purchaseOrder).not.toHaveBeenCalled();
  });

  it("registra o pedido com todos os grupos", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<PurchaseDeliveries request={detail("aprovada")} purchaseItems={purchaseItems} canOrder canConfirm={false} onChanged={onChanged} />);
    for (const input of screen.getAllByLabelText("Previsão de entrega")) fireEvent.change(input, { target: { value: "2099-01-31" } });
    fireEvent.click(screen.getByText("Registrar pedido e informar previsão"));
    await waitFor(() => expect(purchaseOrder).toHaveBeenCalled());
    const [id, inputs] = purchaseOrder.mock.calls[0] as [string, Array<{ groupId: string; expectedDeliveryDate: string }>];
    expect(id).toBe("req-1");
    expect(inputs.map((i) => i.groupId)).toEqual(["qa", "qb", "estoque"]);
    expect(inputs.every((i) => i.expectedDeliveryDate === "2099-01-31")).toBe(true);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("solicitante vê a faixa de previsão e confirma só o grupo marcado", async () => {
    const deliveries = [delivery("qa", "Forn A"), delivery("qb", "Forn B", { expectedDeliveryDate: "2026-12-05" })];
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<PurchaseDeliveries request={detail("aguardando_entrega", deliveries)} purchaseItems={purchaseItems} canOrder={false} canConfirm onChanged={onChanged} />);
    expect(screen.getByRole("status").textContent).toContain("previsão 05/12/2026");
    expect((screen.getByText("Confirmar recebimento") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Recebi os itens de Forn A"));
    fireEvent.click(screen.getByText("Confirmar recebimento"));
    fireEvent.click(screen.getAllByText("Confirmar recebimento").pop()!);
    await waitFor(() => expect(confirmReceipt).toHaveBeenCalledWith("req-1", ["qa"], undefined));
    expect(screen.queryByText("Alterar previsão")).toBeNull();
  });

  it("Suprimentos altera a previsão de grupo não recebido; recebido não tem o botão", async () => {
    const deliveries = [delivery("qa", "Forn A"), delivery("qb", "Forn B", { receivedAt: "2026-11-18T12:00:00Z", receivedByName: "Maria" })];
    render(<PurchaseDeliveries request={detail("aguardando_entrega", deliveries)} purchaseItems={purchaseItems} canOrder canConfirm={false} onChanged={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getAllByText("Alterar previsão")).toHaveLength(1);
    expect(screen.getByText(/Recebido em .* por Maria/)).toBeTruthy();
    fireEvent.click(screen.getByText("Alterar previsão"));
    fireEvent.change(screen.getByLabelText("Previsão de entrega"), { target: { value: "2026-11-25" } });
    fireEvent.click(screen.getByText("Salvar previsão"));
    await waitFor(() => expect(purchaseOrder).toHaveBeenCalled());
    expect(purchaseOrder.mock.calls[0][1]).toEqual([expect.objectContaining({ groupId: "qa", expectedDeliveryDate: "2026-11-25" })]);
  });

  it("encerrada mostra as entregas só leitura", () => {
    const deliveries = [delivery("qa", "Forn A", { receivedAt: "2026-11-18T12:00:00Z" })];
    render(<PurchaseDeliveries request={detail("encerrada", deliveries)} purchaseItems={purchaseItems} canOrder canConfirm={false} onChanged={vi.fn()} />);
    expect(screen.getByText("Entregas")).toBeTruthy();
    expect(screen.queryByText("Alterar previsão")).toBeNull();
    expect(screen.queryByText("Confirmar recebimento")).toBeNull();
  });

  it("não renderiza nada fora do pedido para quem só lê, antes de haver entregas", () => {
    const { container } = render(<PurchaseDeliveries request={detail("aprovada")} purchaseItems={purchaseItems} canOrder={false} canConfirm={false} onChanged={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
