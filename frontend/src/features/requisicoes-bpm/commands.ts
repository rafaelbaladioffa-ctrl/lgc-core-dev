export type CommandMeta = {
  expectedVersion: number;
  commandKey: string;
  commandId: string;
};
export type CommandAction =
  "submit" | "claim" | "complete" | "release" | "close" | "cancel" | "reassign";
export type CommandAttempt =
  | { action: "submit" | "claim"; target: string; body: CommandMeta }
  | {
      action: "complete";
      target: string;
      body: CommandMeta & { resolution: string };
    }
  | {
      action: "release" | "close" | "cancel";
      target: string;
      body: CommandMeta & { reason: string };
    }
  | {
      action: "reassign";
      target: string;
      body: CommandMeta & { reason: string; assigneeId: string };
    };
export function isCommandAction(action: string): action is CommandAction {
  return [
    "submit",
    "claim",
    "complete",
    "release",
    "close",
    "cancel",
    "reassign",
  ].includes(action);
}
export function buildCommand(
  action: CommandAction,
  target: string,
  meta: CommandMeta,
  text: string,
  assigneeId?: string,
): CommandAttempt {
  const body = {
    expectedVersion: meta.expectedVersion,
    commandKey: meta.commandKey,
    commandId: meta.commandId,
  };
  switch (action) {
    case "submit":
    case "claim":
      return { action, target, body };
    case "complete":
      return { action, target, body: { ...body, resolution: text } };
    case "reassign":
      return {
        action,
        target,
        body: { ...body, reason: text, assigneeId: assigneeId ?? "" },
      };
    default:
      return { action, target, body: { ...body, reason: text } };
  }
}
type Client = {
  [A in CommandAction]: (
    target: string,
    body: Extract<CommandAttempt, { action: A }>["body"] | CommandMeta,
  ) => Promise<unknown>;
};
// Explicit dispatch keeps each action bound to its DTO and target.
export function executeCommand(client: Client, attempt: CommandAttempt) {
  switch (attempt.action) {
    case "submit":
      return client.submit(attempt.target, attempt.body);
    case "claim":
      return client.claim(attempt.target, attempt.body);
    case "complete":
      return client.complete(attempt.target, attempt.body);
    case "release":
      return client.release(attempt.target, attempt.body);
    case "close":
      return client.close(attempt.target, attempt.body);
    case "cancel":
      return client.cancel(attempt.target, attempt.body);
    case "reassign":
      return client.reassign(attempt.target, attempt.body);
  }
}
export function createPayload(input: {
  categoryId: string;
  versionId: string;
  title?: string;
  description?: string;
  fields?: Record<string, unknown>;
  commandKey?: string;
  commandId?: string;
}) {
  const {
    categoryId,
    versionId,
    title,
    description,
    fields,
    commandKey,
    commandId,
  } = input;
  return {
    categoryId,
    versionId,
    title,
    description,
    fields,
    commandKey,
    commandId,
  };
}
export function draftPayload(
  input: CommandMeta & {
    title?: string;
    description?: string;
    fields?: Record<string, unknown>;
  },
) {
  const { expectedVersion, commandKey, commandId, title, description, fields } =
    input;
  return { expectedVersion, commandKey, commandId, title, description, fields };
}
export function attachmentPayload(input: {
  filename: string;
  contentBase64: string;
  fieldKey?: string;
  previousId?: string;
  expectedVersion?: number;
  commandKey?: string;
  commandId?: string;
}) {
  const {
    filename,
    contentBase64,
    fieldKey,
    previousId,
    expectedVersion,
    commandKey,
    commandId,
  } = input;
  return {
    filename,
    contentBase64,
    fieldKey,
    previousId,
    expectedVersion,
    commandKey,
    commandId,
  };
}
