import React, { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useDraftAutosave } from "../src/features/requisicoes-bpm/useDraftAutosave";
import { DynamicForm } from "../src/features/requisicoes-bpm/DynamicForm";
import {
  BpmRecordEditor,
  BpmDraftEditorPage,
} from "../src/features/requisicoes-bpm/BpmDraftEditorPage";
import {
  BpmNewRequestPage,
  BpmPortalPage,
  BpmVersionPage,
} from "../src/features/requisicoes-bpm/BpmPages";
import { bpmApi } from "../src/features/requisicoes-bpm/api";
vi.mock("../src/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("../src/features/requisicoes-bpm/api", () => ({
  bpmApi: {
    capabilities: vi.fn(),
    requestsPage: vi.fn(),
    version: vi.fn(),
    patchVersion: vi.fn(),
    validateVersion: vi.fn(),
    publishVersion: vi.fn(),
    cloneVersion: vi.fn(),
    catalog: vi.fn(),
    createRequest: vi.fn(),
    draft: vi.fn(),
    request: vi.fn(),
    timeline: vi.fn().mockResolvedValue([]),
    attachment: vi.fn(),
    submit: vi.fn(),
    claim: vi.fn(),
    complete: vi.fn(),
    release: vi.fn(),
    reassign: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    comment: vi.fn(),
  },
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
const snap = (title: string) => ({ title, description: "", fields: {} });
const initial: any = {
  id: "r1",
  code: "REQ-1",
  title: "Original title",
  description: "Description",
  fields: { count: 0, flag: false, protected: "keep" },
  schema: [
    { key: "count", label: "Count", type: "integer" },
    { key: "flag", label: "Flag", type: "boolean" },
    { key: "docs", label: "Documents", type: "attachment" },
  ],
  version: 1,
  currentVersion: 7,
  status: "rascunho",
  allowedActions: ["saveDraft", "submit"],
  attachments: [],
  activities: [],
};
const mount = (r = initial) =>
  render(
    <MemoryRouter>
      <BpmRecordEditor initial={r} />
    </MemoryRouter>,
  );

describe("autosave with React and controlled timers", () => {
  it("serializes pending edits, uses authoritative versions and survives StrictMode", async () => {
    vi.useFakeTimers();
    let resolve!: (v: any) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue({ currentVersion: 12 });
    const { result, unmount } = renderHook(() => useDraftAutosave(save, 7), {
      wrapper: StrictMode,
    });
    act(() => result.current.schedule(snap("first")));
    await act(() => vi.advanceTimersByTimeAsync(400));
    act(() => result.current.schedule(snap("latest")));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].expectedVersion).toBe(7);
    await act(async () => {
      resolve({ currentVersion: 11 });
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({
      title: "latest",
      expectedVersion: 11,
    });
    expect(result.current.state).toBe("saved");
    unmount();
  });
  it("retries the identical failed payload and stops automatic saves after 409", async () => {
    vi.useFakeTimers();
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({ currentVersion: 8 })
      .mockRejectedValue({ response: { status: 409 } });
    const { result } = renderHook(() => useDraftAutosave(save, 7));
    act(() => result.current.schedule(snap("A")));
    await act(() => vi.advanceTimersByTimeAsync(400));
    const attempt = save.mock.calls[0][0];
    act(() => result.current.schedule(snap("B")));
    await act(async () => {
      await result.current.retry().catch(() => undefined);
    });
    expect(save.mock.calls[1][0]).toEqual(attempt);
    expect(result.current.state).toBe("conflict");
    act(() => result.current.schedule(snap("C")));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(save).toHaveBeenCalledTimes(3);
  });
  it("cancels the debounce on unmount and initializes a different record version", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ currentVersion: 23 });
    const one = renderHook(() => useDraftAutosave(save, 7));
    act(() => one.result.current.schedule(snap("abandoned")));
    one.unmount();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save).not.toHaveBeenCalled();
    const two = renderHook(() => useDraftAutosave(save, 22));
    act(() => two.result.current.schedule(snap("new record")));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save.mock.calls[0][0].expectedVersion).toBe(22);
  });
});

describe("real draft controls with mocked API", () => {
  it("loads the personal inbox and queue through the paginated query", async () => {
    vi.mocked(bpmApi.capabilities).mockResolvedValue({ enabled: true } as any);
    vi.mocked(bpmApi.requestsPage)
      .mockResolvedValueOnce({ items: [initial], nextCursor: "next" })
      .mockResolvedValueOnce({
        items: [{ ...initial, id: "r2", code: "REQ-2" }],
        nextCursor: null,
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    render(
      <MemoryRouter>
        <BpmPortalPage />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText(/REQ-1 —/));
    fireEvent.click(screen.getByText("Carregar mais"));
    await waitFor(() => screen.getByText(/REQ-2 —/));
    expect(vi.mocked(bpmApi.requestsPage).mock.calls[1]).toEqual([
      "mine",
      "next",
    ]);
    fireEvent.click(screen.getByText("Inbox e fila de atendimento"));
    await waitFor(() =>
      expect(vi.mocked(bpmApi.requestsPage).mock.calls[2][0]).toBe("queue"),
    );
  });
  it("exposes loading, empty and offline retry states without losing the view", async () => {
    let rejectFirst!: (error: Error) => void;
    vi.mocked(bpmApi.capabilities).mockResolvedValue({ enabled: true } as any);
    vi.mocked(bpmApi.requestsPage)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    render(
      <MemoryRouter>
        <BpmPortalPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status").textContent).toContain("Carregando requisições");
    await act(async () => rejectFirst(new Error("Offline")));
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());
    fireEvent.click(screen.getByText("Tentar novamente"));
    await waitFor(() =>
      expect(screen.getByText("Nenhuma requisição nesta visão.")).toBeTruthy(),
    );
  });
  it("edits SLA metadata and previews options, while published versions stay immutable", async () => {
    const version: any = {
      id: "v1",
      version: 1,
      bpmStatus: "draft",
      bpmRevision: 3,
      category: { id: "p", configRevision: 4 },
      bpmDefinition: {
        form: [
          {
            key: "kind",
            label: "Kind",
            type: "select",
            options: [{ id: "old", label: "Old" }],
          },
        ],
        sla: { firstResponseMinutes: 10, resolutionMinutes: 20 },
      },
    };
    vi.mocked(bpmApi.version).mockResolvedValue(version);
    vi.mocked(bpmApi.patchVersion).mockResolvedValue({});
    render(
      <MemoryRouter initialEntries={["/version/v1"]}>
        <Routes>
          <Route path="/version/:id" element={<BpmVersionPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByLabelText("Primeira resposta (minutos)"));
    fireEvent.change(screen.getByLabelText("Primeira resposta (minutos)"), {
      target: { value: "15" },
    });
    fireEvent.change(
      screen.getByLabelText("Opções (id=rótulo, uma por linha)"),
      { target: { value: "new=New option" } },
    );
    expect(screen.getByText("New option")).toBeTruthy();
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() => expect(bpmApi.patchVersion).toHaveBeenCalled());
    expect(
      vi.mocked(bpmApi.patchVersion).mock.calls[0][1].definition.sla
        .firstResponseMinutes,
    ).toBe(15);
  });
  it("covers A03 publish UI: validates the edited draft, publishes once, and locks the published snapshot", async () => {
    const draft: any = {
      id: "a03-version",
      version: 1,
      bpmStatus: "draft",
      bpmRevision: 3,
      bpmDefinition: { form: [], sla: { firstResponseMinutes: 10, resolutionMinutes: 20 } },
      category: { id: "a03-process", configRevision: 4 },
    };
    const published = {
      ...draft,
      bpmStatus: "published",
      bpmRevision: 4,
      bpmContentHash: "hash-new",
      bpmDefinition: { ...draft.bpmDefinition, sla: { firstResponseMinutes: 15, resolutionMinutes: 20 } },
    };
    let publishedLoaded = false;
    vi.mocked(bpmApi.version).mockImplementation(async () =>
      publishedLoaded ? published : draft,
    );
    vi.mocked(bpmApi.patchVersion).mockResolvedValue(draft);
    vi.mocked(bpmApi.validateVersion).mockResolvedValue({ valid: true, errors: [], validatedHash: "hash-new" });
    vi.mocked(bpmApi.publishVersion).mockImplementation(async () => {
      publishedLoaded = true;
      return published;
    });

    render(
      <MemoryRouter initialEntries={["/version/a03-version"]}>
        <Routes>
          <Route path="/version/:id" element={<BpmVersionPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const firstResponse = await screen.findByLabelText("Primeira resposta (minutos)");
    fireEvent.change(firstResponse, { target: { value: "15" } });
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() => expect(bpmApi.patchVersion).toHaveBeenCalledWith(
      "a03-version",
      expect.objectContaining({ expectedVersion: 3 }),
    ));
    fireEvent.click(screen.getByText("Validar"));
    await waitFor(() => expect(bpmApi.validateVersion).toHaveBeenCalledWith("a03-version", 3));
    fireEvent.click(screen.getByText("Publicar"));
    await waitFor(() => expect(bpmApi.publishVersion).toHaveBeenCalledWith(
      "a03-version",
      { expectedVersion: 3, validatedHash: "hash-new" },
    ));
    await waitFor(() =>
      expect(
        screen.getByLabelText("Primeira resposta (minutos)").closest("fieldset")?.hasAttribute("disabled"),
      ).toBe(true),
    );
    expect(screen.getByText("Clonar para novo rascunho")).toBeTruthy();
    expect(screen.getByText("Publicar").hasAttribute("disabled")).toBe(true);
  });
  it("lets a manager reassign an incident to an eligible target with an explicit reason", async () => {
    vi.mocked(bpmApi.reassign).mockResolvedValue({});
    vi.mocked(bpmApi.request).mockResolvedValue({
      ...initial,
      status: "em_atendimento",
      allowedActions: [],
      activities: [],
    });
    mount({
      ...initial,
      status: "em_atendimento",
      allowedActions: [],
      assignmentTargets: [{ id: "executor", label: "Executor" }],
      incidents: [{ id: "incident", type: "NO_ELIGIBLE_ASSIGNEE" }],
      activities: [
        {
          id: "a",
          phase: "execution",
          state: "available",
          allowedActions: ["reassign"],
        },
      ],
    });
    fireEvent.change(screen.getByLabelText("Responsável"), {
      target: { value: "executor" },
    });
    fireEvent.change(screen.getByLabelText("Resolução ou motivo"), {
      target: { value: "Recovered queue membership" },
    });
    fireEvent.click(screen.getByText("Reatribuir"));
    await waitFor(() => expect(bpmApi.reassign).toHaveBeenCalled());
    expect(vi.mocked(bpmApi.reassign).mock.calls[0][1]).toMatchObject({
      assigneeId: "executor",
      reason: "Recovered queue membership",
    });
    expect(vi.mocked(bpmApi.reassign).mock.calls[0][1]).not.toHaveProperty(
      "resolution",
    );
  });
  it("creates, edits, resumes fixed v1, uploads, submits, completes triage/execution and closes", async () => {
    let row: any = {
      ...initial,
      currentVersion: 0,
      fields: {},
      schema: [{ key: "docs", label: "Documents", type: "attachment" }],
    };
    vi.mocked(bpmApi.catalog).mockResolvedValue([
      {
        id: "process",
        name: "Process",
        versions: [
          { id: "v1", bpmStatus: "published", bpmDefinition: { form: [] } },
        ],
      },
    ] as any);
    vi.mocked(bpmApi.createRequest).mockResolvedValue({ id: "r1" });
    vi.mocked(bpmApi.request).mockImplementation(async () =>
      structuredClone(row),
    );
    vi.mocked(bpmApi.draft).mockImplementation(async (_id, body) => {
      row = {
        ...row,
        title: body.title,
        description: body.description,
        fields: { ...row.fields, ...body.fields },
        currentVersion: row.currentVersion + 1,
      };
      return { currentVersion: row.currentVersion };
    });
    vi.mocked(bpmApi.attachment).mockResolvedValue({
      id: "file",
      filename: "doc.txt",
      version: 1,
    });
    vi.mocked(bpmApi.submit).mockImplementation(async () => {
      row = {
        ...row,
        status: "enviada",
        currentVersion: row.currentVersion + 1,
        allowedActions: [],
        activities: [
          {
            id: "triage",
            phase: "triage",
            state: "available",
            allowedActions: ["claim"],
          },
        ],
      };
    });
    vi.mocked(bpmApi.claim).mockImplementation(async () => {
      row = {
        ...row,
        currentVersion: row.currentVersion + 1,
        activities: row.activities.map((a: any) => ({
          ...a,
          state: "claimed",
          allowedActions: ["complete"],
        })),
      };
    });
    vi.mocked(bpmApi.complete).mockImplementation(async () => {
      const triage = row.activities[0].phase === "triage";
      row = {
        ...row,
        currentVersion: row.currentVersion + 1,
        status: triage ? "em_atendimento" : "concluida",
        allowedActions: triage ? [] : ["close"],
        activities: triage
          ? [
              {
                id: "execute",
                phase: "execution",
                state: "available",
                allowedActions: ["claim"],
              },
            ]
          : [],
      };
    });
    vi.mocked(bpmApi.close).mockImplementation(async () => {
      row = { ...row, status: "encerrada", allowedActions: [] };
    });
    const view = render(
      <MemoryRouter initialEntries={["/new"]}>
        <Routes>
          <Route path="/new" element={<BpmNewRequestPage />} />
          <Route path="/requests/bpm/:id" element={<BpmDraftEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText("Process"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "process" },
    });
    fireEvent.change(screen.getByPlaceholderText("Título"), {
      target: { value: "A valid request title" },
    });
    fireEvent.click(screen.getByText("Salvar rascunho"));
    await waitFor(() => screen.getByLabelText("Título"));
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Edited title" },
    });
    fireEvent.click(screen.getByText("Salvar agora"));
    await waitFor(() => expect(row.title).toBe("Edited title"));
    view.unmount();
    vi.mocked(bpmApi.catalog).mockResolvedValue([
      { id: "process", versions: [{ id: "v2", version: 2 }] },
    ] as any);
    render(
      <MemoryRouter initialEntries={["/requests/bpm/r1"]}>
        <Routes>
          <Route path="/requests/bpm/:id" element={<BpmDraftEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText(/REQ-1 — versão 1/));
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe(
      "Edited title",
    );
    fireEvent.change(screen.getByLabelText("Documents"), {
      target: { files: [new File(["document"], "doc.txt")] },
    });
    await waitFor(() => expect(row.fields.docs).toEqual(["file"]));
    fireEvent.click(screen.getByText("Revisar e enviar"));
    await waitFor(() => screen.getByText("Assumir"));
    fireEvent.click(screen.getByText("Assumir"));
    await waitFor(() => screen.getByText("Concluir atividade"));
    fireEvent.change(screen.getByLabelText("Resolução ou motivo"), {
      target: { value: "Resolved triage" },
    });
    fireEvent.click(screen.getByText("Concluir atividade"));
    await waitFor(() => screen.getByText("Assumir"));
    fireEvent.click(screen.getByText("Assumir"));
    await waitFor(() => screen.getByText("Concluir atividade"));
    fireEvent.click(screen.getByText("Concluir atividade"));
    await waitFor(() => screen.getByText("Encerrar"));
    fireEvent.click(screen.getByText("Encerrar"));
    await waitFor(() => screen.getByText("Status: encerrada"));
  });
  it("renders and emits false, zero, decimal text, date and option IDs", () => {
    const onChange = vi.fn();
    render(
      <DynamicForm
        fields={[
          { key: "b", label: "Boolean", type: "boolean" },
          { key: "i", label: "Integer", type: "integer" },
          { key: "d", label: "Decimal", type: "decimal" },
          { key: "date", label: "Date", type: "date" },
          {
            key: "s",
            label: "Select",
            type: "select",
            options: [{ id: "x", label: "Choice" }],
          },
        ]}
        values={{ b: true, i: 2 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Boolean"));
    fireEvent.change(screen.getByLabelText("Integer"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Decimal"), {
      target: { value: "0.10" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-11-02" },
    });
    fireEvent.change(screen.getByLabelText("Select"), {
      target: { value: "x" },
    });
    expect(onChange.mock.calls).toEqual([
      ["b", false],
      ["i", 0],
      ["d", "0.10"],
      ["date", "2026-11-02"],
      ["s", "x"],
    ]);
  });
  it("saves title-only edits before submit with loaded revision and fixed v1 schema", async () => {
    vi.mocked(bpmApi.draft).mockResolvedValue({ currentVersion: 8 });
    vi.mocked(bpmApi.submit).mockResolvedValue({});
    vi.mocked(bpmApi.request).mockResolvedValue({
      ...initial,
      status: "enviada",
      allowedActions: [],
    });
    mount();
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Changed title" },
    });
    fireEvent.click(screen.getByText("Revisar e enviar"));
    await waitFor(() => expect(bpmApi.submit).toHaveBeenCalled());
    expect(vi.mocked(bpmApi.draft).mock.calls[0][1]).toMatchObject({
      expectedVersion: 7,
      title: "Changed title",
    });
    expect(vi.mocked(bpmApi.submit).mock.calls[0][1].expectedVersion).toBe(8);
    expect(screen.getByText(/versão 1/)).toBeTruthy();
  });
  it("A11 keeps the losing edit visible on 409 and does not submit", async () => {
    vi.mocked(bpmApi.draft).mockRejectedValue({ response: { status: 409 } });
    mount();
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Keep my edit" },
    });
    fireEvent.click(screen.getByText("Revisar e enviar"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("conflict"),
    );
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe(
      "Keep my edit",
    );
    expect(document.activeElement).toBe(
      screen.getByText("Conflito: edição preservada. Recarregue para resolver.").parentElement,
    );
    expect(bpmApi.submit).not.toHaveBeenCalled();
  });
  it("preserves the edited value across an offline save and retries the same intent", async () => {
    vi.mocked(bpmApi.draft)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ currentVersion: 8 });
    mount();
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Keep this offline edit" },
    });
    fireEvent.click(screen.getByText("Salvar agora"));
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe(
      "Keep this offline edit",
    );
    fireEvent.click(screen.getByText("Salvar agora"));
    await waitFor(() => expect(bpmApi.draft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(bpmApi.draft).mock.calls[1][1]).toEqual(
      vi.mocked(bpmApi.draft).mock.calls[0][1],
    );
  });
  it("keeps the new-process controls named for keyboard navigation", async () => {
    vi.mocked(bpmApi.catalog).mockResolvedValue([
      { id: "process", name: "Process", versions: [{ id: "v1", bpmStatus: "published", bpmDefinition: { form: [] } }] },
    ] as any);
    render(
      <MemoryRouter initialEntries={["/new"]}>
        <Routes>
          <Route path="/new" element={<BpmNewRequestPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByRole("combobox", { name: "Processo" }));
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Título")).toBeTruthy();
  });
  it("A07: preserves the submit key and payload after a lost transition response", async () => {
    vi.mocked(bpmApi.submit)
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce({});
    vi.mocked(bpmApi.request).mockResolvedValue({
      ...initial,
      status: "enviada",
      allowedActions: [],
    });
    mount();
    fireEvent.click(screen.getByText("Revisar e enviar"));
    await waitFor(() => screen.getByText("Repetir tentativa"));
    const first = vi.mocked(bpmApi.submit).mock.calls[0][1];
    fireEvent.click(screen.getByText("Repetir tentativa"));
    await waitFor(() => expect(bpmApi.submit).toHaveBeenCalledTimes(2));
    expect(vi.mocked(bpmApi.submit).mock.calls[1][1]).toEqual(first);
  });
  it("releases a definitively rejected intention so the resolution can be corrected", async () => {
    vi.mocked(bpmApi.complete)
      .mockRejectedValueOnce({ response: { status: 400 } })
      .mockResolvedValueOnce({});
    vi.mocked(bpmApi.request).mockResolvedValue({
      ...initial,
      status: "concluida",
      allowedActions: ["close"],
      activities: [],
    });
    mount({
      ...initial,
      status: "em_atendimento",
      allowedActions: ["cancel"],
      activities: [
        {
          id: "execution",
          phase: "execution",
          state: "claimed",
          allowedActions: ["complete"],
        },
      ],
    });
    fireEvent.change(screen.getByLabelText("Resolução ou motivo"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByText("Concluir atividade"));
    await waitFor(() => expect(bpmApi.complete).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Resolução ou motivo") as HTMLTextAreaElement)
          .disabled,
      ).toBe(false),
    );
    const rejected = vi.mocked(bpmApi.complete).mock.calls[0][1];
    fireEvent.change(screen.getByLabelText("Resolução ou motivo"), {
      target: { value: "Corrected resolution" },
    });
    fireEvent.click(screen.getByText("Concluir atividade"));
    await waitFor(() => expect(bpmApi.complete).toHaveBeenCalledTimes(2));
    const corrected = vi.mocked(bpmApi.complete).mock.calls[1][1];
    expect(corrected.resolution).toBe("Corrected resolution");
    expect(corrected.commandKey).not.toBe(rejected.commandKey);
    expect(corrected).not.toHaveProperty("reason");
  });
  it("blocks other actions during an ambiguous request and preserves only its retry", async () => {
    vi.mocked(bpmApi.complete).mockRejectedValue(new Error("No response"));
    mount({
      ...initial,
      status: "em_atendimento",
      allowedActions: ["cancel"],
      activities: [
        {
          id: "execution",
          phase: "execution",
          state: "claimed",
          allowedActions: ["complete"],
        },
      ],
    });
    fireEvent.change(screen.getByLabelText("Resolução ou motivo"), {
      target: { value: "Resolution" },
    });
    fireEvent.click(screen.getByText("Concluir atividade"));
    await waitFor(() => screen.getByText("Repetir tentativa"));
    expect((screen.getByText("Cancelar") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByText("Concluir atividade") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByText("Cancelar"));
    expect(bpmApi.cancel).not.toHaveBeenCalled();
  });
  it("requires reconciliation after a command 409 and offers no automatic retry", async () => {
    vi.mocked(bpmApi.complete).mockRejectedValue({ response: { status: 409 } });
    mount({
      ...initial,
      status: "em_atendimento",
      allowedActions: ["cancel"],
      activities: [
        {
          id: "execution",
          phase: "execution",
          state: "claimed",
          allowedActions: ["complete"],
        },
      ],
    });
    fireEvent.click(screen.getByText("Concluir atividade"));
    await waitFor(() => screen.getByText("Descartar edição e recarregar"));
    expect(screen.queryByText("Repetir tentativa")).toBeNull();
    expect((screen.getByText("Cancelar") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it("uploads multiple independent files then saves their IDs without reloading local edits", async () => {
    vi.mocked(bpmApi.draft).mockResolvedValue({ currentVersion: 8 });
    vi.mocked(bpmApi.attachment)
      .mockResolvedValueOnce({ id: "file1", filename: "one.txt", version: 1 })
      .mockResolvedValueOnce({ id: "file2", filename: "two.txt", version: 1 });
    mount();
    fireEvent.change(screen.getByLabelText("Documents"), {
      target: {
        files: [new File(["one"], "one.txt"), new File(["two"], "two.txt")],
      },
    });
    await waitFor(() => expect(bpmApi.attachment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(bpmApi.draft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(bpmApi.draft).mock.calls[1][1].fields.docs).toEqual([
      "file1",
      "file2",
    ]);
    expect(bpmApi.request).not.toHaveBeenCalled();
  });
  it("shows upload errors and preserves the draft", async () => {
    vi.mocked(bpmApi.attachment).mockRejectedValue(new Error("Upload failed"));
    mount();
    fireEvent.change(screen.getByLabelText("Documents"), {
      target: { files: [new File(["bad"], "bad.txt")] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Upload failed"),
    );
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe(
      initial.title,
    );
  });
  it("retries a lost upload response using the same key and file bytes", async () => {
    vi.mocked(bpmApi.draft).mockResolvedValue({ currentVersion: 8 });
    vi.mocked(bpmApi.attachment)
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce({
        id: "same-file",
        filename: "file.pdf",
        version: 1,
      });
    mount();
    fireEvent.change(screen.getByLabelText("Documents"), {
      target: { files: [new File(["%PDF-1.7"], "file.pdf")] },
    });
    await waitFor(() => screen.getByText("Repetir upload"));
    const first = vi.mocked(bpmApi.attachment).mock.calls[0][1];
    fireEvent.click(screen.getByText("Repetir upload"));
    await waitFor(() => expect(bpmApi.attachment).toHaveBeenCalledTimes(2));
    expect(vi.mocked(bpmApi.attachment).mock.calls[1][1]).toEqual(first);
  });
  it("renders read-only fields disabled and excludes them from the PATCH", async () => {
    vi.mocked(bpmApi.draft).mockResolvedValue({ currentVersion: 8 });
    mount({
      ...initial,
      formAccess: { protected: "read" },
      schema: [
        ...initial.schema,
        { key: "protected", label: "Protected", type: "text" },
      ],
    });
    expect(
      (screen.getByLabelText("Protected") as HTMLInputElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Only editable data" },
    });
    fireEvent.click(screen.getByText("Salvar agora"));
    await waitFor(() => expect(bpmApi.draft).toHaveBeenCalled());
    expect(vi.mocked(bpmApi.draft).mock.calls[0][1].fields).not.toHaveProperty(
      "protected",
    );
  });
  it("exposes claim, completion and manual closure for the current allowed actions", async () => {
    const active = {
      ...initial,
      status: "enviada",
      allowedActions: [],
      activities: [
        {
          id: "triage",
          phase: "triage",
          state: "available",
          allowedActions: ["claim"],
        },
      ],
    };
    vi.mocked(bpmApi.claim).mockResolvedValue({});
    vi.mocked(bpmApi.request).mockResolvedValue({
      ...active,
      activities: [{ ...active.activities[0], allowedActions: ["complete"] }],
    });
    mount(active);
    fireEvent.click(screen.getByText("Assumir"));
    await waitFor(() =>
      expect(screen.getByText("Concluir atividade")).toBeTruthy(),
    );
    vi.mocked(bpmApi.complete).mockResolvedValue({});
    vi.mocked(bpmApi.request).mockResolvedValue({
      ...initial,
      status: "concluida",
      allowedActions: ["close"],
      activities: [],
    });
    fireEvent.change(screen.getByLabelText("Resolução ou motivo"), {
      target: { value: "Resolved" },
    });
    fireEvent.click(screen.getByText("Concluir atividade"));
    await waitFor(() => expect(screen.getByText("Encerrar")).toBeTruthy());
    vi.mocked(bpmApi.close).mockResolvedValue({});
    vi.mocked(bpmApi.request).mockResolvedValue({
      ...initial,
      status: "encerrada",
      allowedActions: [],
      activities: [],
    });
    fireEvent.click(screen.getByText("Encerrar"));
    await waitFor(() =>
      expect(screen.getByText("Status: encerrada")).toBeTruthy(),
    );
  });
});
