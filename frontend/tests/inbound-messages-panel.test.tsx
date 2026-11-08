import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const get = vi.fn();
vi.mock("../src/api/inbox", () => ({ inboxApi: { list: (...a: unknown[]) => list(...a), get: (...a: unknown[]) => get(...a) } }));

import { InboundMessagesPanel } from "../src/components/InboundMessagesPanel";

const SATELLITES = [
  { id: "sat-log", name: "logistica" },
  { id: "sat-fin", name: "financeiro" },
];

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "m1",
  satelliteId: "sat-log",
  satelliteName: "logistica",
  eventId: "ev-1",
  eventType: "shipment.dispatched",
  status: "processed",
  error: null,
  receivedAt: "2026-11-08T15:00:00.000Z",
  processedAt: "2026-11-08T15:00:01.000Z",
  ...overrides,
});

describe("InboundMessagesPanel", () => {
  beforeEach(() => {
    list.mockReset();
    get.mockReset();
  });
  afterEach(cleanup);

  it("lista as mensagens recebidas com satélite e status em português", async () => {
    list.mockResolvedValue({
      data: [message(), message({ id: "m2", eventType: "payable.paid", satelliteName: "financeiro", status: "failed", error: "falhou" })],
      meta: { page: 1, perPage: 100, total: 2 },
    });
    render(<InboundMessagesPanel satellites={SATELLITES} />);
    expect(await screen.findByText("shipment.dispatched")).toBeTruthy();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Processada")).toBeTruthy();
    expect(table.getByText("Falhou")).toBeTruthy();
    expect(table.getByText("falhou")).toBeTruthy();
    expect(list).toHaveBeenCalledWith({ satelliteId: undefined, status: undefined, perPage: 100 });
  });

  it("filtra por satélite e por status no servidor", async () => {
    list.mockResolvedValue({ data: [], meta: { page: 1, perPage: 100, total: 0 } });
    render(<InboundMessagesPanel satellites={SATELLITES} />);
    await screen.findByText("Nenhuma mensagem recebida.");

    fireEvent.change(screen.getByLabelText("Filtrar por satélite"), { target: { value: "sat-fin" } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ satelliteId: "sat-fin", status: undefined, perPage: 100 }));

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "failed" } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ satelliteId: "sat-fin", status: "failed", perPage: 100 }));
  });

  it("mostra o erro na tela quando a listagem falha", async () => {
    list.mockRejectedValue({ response: { status: 403, data: { message: "Forbidden" } } });
    render(<InboundMessagesPanel satellites={SATELLITES} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Você não tem permissão para esta ação.");
  });

  it("usa a mensagem padrão quando a rede cai", async () => {
    list.mockRejectedValue(new Error("Network Error"));
    render(<InboundMessagesPanel satellites={SATELLITES} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Não foi possível carregar as mensagens recebidas.");
  });

  it("abre o detalhe com o payload e mostra erro se o detalhe falhar", async () => {
    list.mockResolvedValue({ data: [message()], meta: { page: 1, perPage: 100, total: 1 } });
    get.mockResolvedValueOnce({ ...message(), payload: { order_code: "OF-1" } });
    render(<InboundMessagesPanel satellites={SATELLITES} />);
    fireEvent.click(await screen.findByText("shipment.dispatched"));
    expect(await screen.findByText(/"order_code": "OF-1"/)).toBeTruthy();

    cleanup();
    get.mockRejectedValueOnce(new Error("boom"));
    render(<InboundMessagesPanel satellites={SATELLITES} />);
    fireEvent.click(await screen.findByText("shipment.dispatched"));
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível abrir a mensagem.");
  });
});
