import { api } from "../../api/client";
import { createPayload, draftPayload, attachmentPayload } from "./commands";
const post = (url: string, input: any) =>
  api.post(url, input, { headers: { "Idempotency-Key": input.commandKey } });
const configAttempts = new Map<
  string,
  { commandKey: string; commandId: string }
>();
async function configRequest(
  method: "post" | "patch" | "put",
  url: string,
  input: Record<string, unknown>,
) {
  const identity = JSON.stringify({ method, url, input });
  const command = configAttempts.get(identity) ?? {
    commandKey: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
  };
  configAttempts.set(identity, command);
  try {
    const response =
      method === "put"
        ? await api.put(
            url,
            { ...input, ...command },
            { headers: { "Idempotency-Key": command.commandKey } },
          )
        : await api[method](
            url,
            { ...input, ...command },
            { headers: { "Idempotency-Key": command.commandKey } },
          );
    configAttempts.delete(identity);
    return response.data;
  } catch (error: any) {
    if (error?.response?.status >= 400 && error?.response?.status < 500)
      configAttempts.delete(identity);
    throw error;
  }
}

export interface BpmCapabilities {
  enabled: boolean;
  format: string;
  nodes: string[];
  permissions: string[];
  limits: { fields: number; nodes: number; slaMinutes: number[] };
}
export interface BpmProcess {
  id: string;
  code: string;
  name: string;
  runtimeEnabled: boolean;
  configRevision: number;
  grants: Array<{
    userId: string;
    role: "modeler" | "publisher" | "operator" | "auditor";
    restrictedRead: boolean;
  }>;
  versions: BpmVersion[];
}
export interface BpmVersion {
  id: string;
  version: number;
  bpmStatus: string;
  bpmRevision: number;
  bpmDefinition: any;
  bpmValidatedHash?: string | null;
  bpmContentHash?: string | null;
}
export interface BpmSlaEntry {
  metric: string;
  targetAt: string | null;
  elapsedSeconds: number;
  breachedAt: string | null;
}
export interface BpmRequest {
  id: string;
  code: string;
  title: string;
  description: string;
  fields: Record<string, unknown>;
  schema?: any[];
  formAccess?: Record<string, unknown>;
  status: string;
  currentVersion: number;
  cycle: number;
  category: { id: string; code: string; name: string };
  version: number;
  // list-only SLA fields (ISO strings)
  slaDueFirstResponseAt?: string | null;
  slaDueResolutionAt?: string | null;
  createdAt?: string;
  activities?: Array<{
    id: string;
    nodeId?: string;
    phase: string;
    state: string;
    assigneeId?: string;
    assigneeName?: string | null;
    assignedToCurrentUser?: boolean;
    queueId?: string;
    resolution?: string;
    question?: string | null;
    correctionFieldKeys?: string[] | null;
    allowedActions: string[];
  }>;
  attachments?: Array<{
    id: string;
    filename: string;
    fieldKey?: string | null;
    mimeType: string;
    sizeBytes: number;
    version: number;
  }>;
  sla?: BpmSlaEntry[];
  allowedActions?: string[];
}
export const bpmApi = {
  capabilities: () =>
    api.get<BpmCapabilities>("/bpm/capabilities").then((r) => r.data),
  queues: () => api.get<any[]>("/bpm/queues").then((r) => r.data),
  collaborators: () => api.get<any[]>("/bpm/collaborators").then((r) => r.data),
  createQueue: (input: any) => configRequest("post", "/bpm/queues", input),
  processes: () => api.get<BpmProcess[]>("/bpm/processes").then((r) => r.data),
  catalog: () => api.get<BpmProcess[]>("/bpm/catalog").then((r) => r.data),
  createProcess: (input: any) => configRequest("post", "/bpm/processes", input),
  version: (id: string) =>
    api.get<BpmVersion>(`/bpm/versions/${id}`).then((r) => r.data),
  cloneVersion: (id: string, expectedVersion: number, cloneVersionId: number) =>
    configRequest("post", `/bpm/processes/${id}/versions`, {
      expectedVersion,
      cloneVersionId,
    }),
  grants: (id: string, grants: any[], expectedVersion: number) =>
    configRequest("put", `/bpm/processes/${id}/grants`, {
      grants,
      expectedVersion,
    }),
  updateQueue: (id: string, input: Record<string, unknown>) =>
    configRequest("patch", `/bpm/queues/${id}`, input),
  patchVersion: (id: string, input: any) =>
    configRequest("patch", `/bpm/versions/${id}`, input),
  validateVersion: (id: string, expectedVersion?: number) =>
    configRequest("post", `/bpm/versions/${id}/validate`, {
      expectedVersion: expectedVersion ?? 0,
    }),
  publishVersion: (id: string, input: any) =>
    configRequest("post", `/bpm/versions/${id}/publish`, input),
  enable: (id: string, expectedVersion: number) =>
    configRequest("post", `/bpm/processes/${id}/enable`, { expectedVersion }),
  requests: () =>
    api.get<{ items: BpmRequest[] }>("/bpm/requests").then((r) => r.data.items),
  requestsPage: (view: "mine" | "queue", cursor?: string) =>
    api
      .get<{ items: BpmRequest[]; nextCursor: string | null }>(
        "/bpm/requests",
        { params: { view, cursor } },
      )
      .then((r) => r.data),
  logisticsItems: (q: string, limit = 20) =>
    api
      .get<{ items: Array<{ id: string; code: string; name: string; unit?: string; unitPrice?: number }> }>(
        "/bpm/logistics/items",
        { params: { q, limit } },
      )
      .then((r) => r.data.items),
  request: (id: string) =>
    api.get<BpmRequest>(`/bpm/requests/${id}`).then((r) => r.data),
  createRequest: (input: Parameters<typeof createPayload>[0]) =>
    api
      .post("/bpm/requests", createPayload(input), {
        headers: { "Idempotency-Key": input.commandKey },
      })
      .then((r) => r.data),
  draft: (id: string, input: Parameters<typeof draftPayload>[0]) =>
    api
      .patch(`/bpm/requests/${id}/draft`, draftPayload(input), {
        headers: { "Idempotency-Key": input.commandKey },
      })
      .then((r) => r.data),
  submit: (id: string, input: any) =>
    post(`/bpm/requests/${id}/submit`, input).then((r) => r.data),
  claim: (id: string, input: any) =>
    post(`/bpm/activities/${id}/claim`, input).then((r) => r.data),
  complete: (id: string, input: any) =>
    post(`/bpm/activities/${id}/complete`, input).then((r) => r.data),
  close: (id: string, input: any) =>
    post(`/bpm/requests/${id}/close`, input).then((r) => r.data),
  cancel: (id: string, input: any) =>
    post(`/bpm/requests/${id}/cancel`, input).then((r) => r.data),
  timeline: (id: string) =>
    api.get<any[]>(`/bpm/requests/${id}/timeline`).then((r) => r.data),
  comment: (id: string, input: any) =>
    post(`/bpm/requests/${id}/comments`, input).then((r) => r.data),
  attachment: (id: string, input: Parameters<typeof attachmentPayload>[0]) =>
    api
      .post(`/bpm/requests/${id}/attachments`, attachmentPayload(input), {
        headers: { "Idempotency-Key": input.commandKey },
      })
      .then((r) => r.data),
  download: (id: string, attachmentId: string) =>
    api
      .get(`/bpm/requests/${id}/attachments/${attachmentId}`, {
        responseType: "blob",
      })
      .then((r) => r.data),
  release: (id: string, input: any) =>
    post(`/bpm/activities/${id}/release`, input).then((r) => r.data),
  reassign: (id: string, input: any) =>
    post(`/bpm/activities/${id}/reassign`, input).then((r) => r.data),
  returnForCorrection: (activityId: string, input: any) =>
    post(`/bpm/activities/${activityId}/return`, input).then((r) => r.data),
  saveCorrection: (
    requestId: string,
    input: {
      expectedVersion: number;
      fields?: Record<string, unknown>;
      commandKey?: string;
      commandId?: string;
    },
  ) =>
    api
      .patch(`/bpm/requests/${requestId}/correction`, input, {
        headers: input.commandKey
          ? { "Idempotency-Key": input.commandKey }
          : {},
      })
      .then((r) => r.data),
  resubmit: (requestId: string, input: any) =>
    post(`/bpm/requests/${requestId}/resubmit`, input).then((r) => r.data),
  requestInformation: (activityId: string, input: any) =>
    post(`/bpm/activities/${activityId}/question`, input).then((r) => r.data),
  respondInformation: (requestId: string, input: any) =>
    post(`/bpm/requests/${requestId}/respond`, input).then((r) => r.data),
};
