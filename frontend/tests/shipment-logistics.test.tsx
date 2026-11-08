import React from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/api/requests", () => ({ requestsApi: { resolveShipmentApprover: vi.fn() } }));

import { ShipmentDetails } from "../src/components/ShipmentDetails";
import { deliveredByMaterial, logisticsStatusLabel, logisticsTone, shortageItems } from "../src/utils/shipmentLogistics";

afterEach(cleanup);

const logistics = {
  orderId: "ord-1",
  orderCode: "ATD-00000007",
  requestVersion: 1,
  status: "AGUARDANDO_ESTOQUE",
  statusReason: null,
  statusAt: null,
  stage: 1,
  items: [
    { materialCode: "RED-CAB-0123", description: "Cabo óptico 12F", unit: "m", quantity: "1200.000", reserved: "0.000", shortage: "1200.000" },
    { materialCode: "RED-CON-0001", description: "Conector LC", unit: "un", quantity: "40.000", reserved: "40.000", shortage: "0.000" },
  ],
  shipments: [],
  deliveries: [
    { eventId: "e1", shipmentId: "s1", complete: false, deliveredAt: null, receiverName: null, pendingPackages: 1, items: [{ materialCode: "RED-CON-0001", quantity: "10.000" }] },
    { eventId: "e2", shipmentId: "s1", complete: false, deliveredAt: null, receiverName: null, pendingPackages: 0, items: [{ materialCode: "RED-CON-0001", quantity: "5.500" }] },
  ],
  refusals: [],
  dispatchedAt: null,
  deliveredAt: null,
};

const shipment = {
  projectQuoteId: "q-1",
  recipientCollaboratorId: "c-1",
  recipientName: "Carla",
  neededBy: "2026-11-30",
  destination: { siteId: "s-1", siteCode: "GRU53", siteName: "Aeroporto GRU", address: "Rod. X", city: "Guarulhos", state: "SP", latitude: null, longitude: null },
  items: [
    { materialCode: "RED-CAB-0123", logisticsMaterialId: null, description: "Cabo óptico 12F", unit: "m", quantity: "1200.000" },
    { materialCode: "RED-CON-0001", logisticsMaterialId: null, description: "Conector LC", unit: "un", quantity: "40.000" },
  ],
  warnings: [],
  approvedAt: "2026-11-08T10:00:00Z",
};

const request = { id: "r-1", status: "em_atendimento", approvals: [], estimatedValue: "100.00", projectId: "p-1" } as never;

const renderDetails = (extra: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <ShipmentDetails request={request} shipment={{ ...shipment, ...extra } as never} statusLabel="Em atendimento" canAdminRequests={false} onChanged={() => undefined} />
    </MemoryRouter>,
  );

describe("situação do envio na Logística (PT-09)", () => {
  it("não mostra o cartão enquanto a Logística não avisou", () => {
    renderDetails();
    expect(screen.queryByTestId("logistics-card")).toBeNull();
    expect(screen.queryByText("Entregue")).toBeNull();
  });

  it("mostra a ordem, a situação, a falta por item e o entregue somado", () => {
    renderDetails({ logistics });
    const card = screen.getByTestId("logistics-card");
    expect(within(card).getByText("ATD-00000007")).toBeTruthy();
    expect(within(card).getByText("Aguardando estoque")).toBeTruthy();
    expect(within(card).getByRole("alert").textContent).toContain("faltam 1.200 de 1.200 m");
    expect(within(card).getByRole("alert").textContent).toContain("Suprimentos");
    // Coluna "Entregue": 10 + 5,5 do conector; nada do cabo.
    const row = screen.getByText("RED-CON-0001").closest("tr")!;
    expect(within(row).getByText("15,5")).toBeTruthy();
  });
});

describe("auxiliares da situação na Logística", () => {
  it("rótulos e tons em português; código desconhecido aparece como veio", () => {
    expect(logisticsStatusLabel("RESERVADA_PARCIAL")).toBe("Reserva parcial (falta material)");
    expect(logisticsStatusLabel("OUTRA")).toBe("OUTRA");
    expect(logisticsTone("ENTREGUE")).toBe("success");
    expect(logisticsTone("AGUARDANDO_ESTOQUE")).toBe("warning");
    expect(logisticsTone("DIVERGENCIA")).toBe("danger");
    expect(logisticsTone("EXPEDIDA")).toBe("default");
  });

  it("soma o entregue por material e lista só as faltas", () => {
    expect(deliveredByMaterial(logistics as never)).toEqual({ "RED-CON-0001": 15.5 });
    expect(deliveredByMaterial(undefined)).toEqual({});
    expect(shortageItems(logistics as never).map((i) => i.materialCode)).toEqual(["RED-CAB-0123"]);
  });
});
