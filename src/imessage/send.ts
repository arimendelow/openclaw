import { loadConfig } from "../config/config.js";
import { resolveMarkdownTableMode } from "../config/markdown-tables.js";
import { convertMarkdownTables } from "../markdown/tables.js";
import { mediaKindFromMime } from "../media/constants.js";
import { saveMediaBuffer } from "../media/store.js";
import { loadWebMedia } from "../web/media.js";
import { resolveIMessageAccount } from "./accounts.js";
import { createIMessageRpcClient, type IMessageRpcClient } from "./client.js";
import { formatIMessageChatTarget, type IMessageService, parseIMessageTarget } from "./targets.js";

export type IMessageSendOpts = {
  cliPath?: string;
  dbPath?: string;
  service?: IMessageService;
  region?: string;
  accountId?: string;
  mediaUrl?: string;
  maxBytes?: number;
  timeoutMs?: number;
  chatId?: number;
  client?: IMessageRpcClient;
  /** BlueBubbles message GUID to reply to (sends via BB HTTP API). */
  replyToGuid?: string;
};

export type IMessageSendResult = {
  messageId: string;
};

function resolveMessageId(result: Record<string, unknown> | null | undefined): string | null {
  if (!result) {
    return null;
  }
  const raw =
    (typeof result.messageId === "string" && result.messageId.trim()) ||
    (typeof result.message_id === "string" && result.message_id.trim()) ||
    (typeof result.id === "string" && result.id.trim()) ||
    (typeof result.guid === "string" && result.guid.trim()) ||
    (typeof result.message_id === "number" ? String(result.message_id) : null) ||
    (typeof result.id === "number" ? String(result.id) : null);
  return raw ? String(raw).trim() : null;
}

async function resolveAttachment(
  mediaUrl: string,
  maxBytes: number,
): Promise<{ path: string; contentType?: string }> {
  const media = await loadWebMedia(mediaUrl, maxBytes);
  const saved = await saveMediaBuffer(
    media.buffer,
    media.contentType ?? undefined,
    "outbound",
    maxBytes,
  );
  return { path: saved.path, contentType: saved.contentType };
}

/**
 * Send a reply via BlueBubbles HTTP API (selectedMessageGuid).
 * Falls through to normal send if BB config is missing.
 */
async function sendViaBlueBubblesReply(
  chatGuid: string,
  text: string,
  selectedMessageGuid: string,
  cfg: ReturnType<typeof loadConfig>,
): Promise<IMessageSendResult | null> {
  const bbCfg = cfg.channels?.bluebubbles;
  const serverUrl = (bbCfg as Record<string, unknown> | undefined)?.serverUrl as string | undefined;
  const password = (bbCfg as Record<string, unknown> | undefined)?.password as string | undefined;
  if (!serverUrl || !password) {
    return null;
  }

  const url = `${serverUrl.replace(/\/$/, "")}/api/v1/message/text?password=${encodeURIComponent(password)}`;
  const body = {
    chatGuid,
    message: text,
    selectedMessageGuid,
    method: "private-api",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.warn(`[bluebubbles-reply] HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    return null;
  }

  const json = (await res.json()) as Record<string, unknown>;
  const data = json.data as Record<string, unknown> | undefined;
  const guid = data?.guid as string | undefined;
  return { messageId: guid ?? "ok" };
}

export async function sendMessageIMessage(
  to: string,
  text: string,
  opts: IMessageSendOpts = {},
): Promise<IMessageSendResult> {
  const cfg = loadConfig();
  const account = resolveIMessageAccount({
    cfg,
    accountId: opts.accountId,
  });
  const cliPath = opts.cliPath?.trim() || account.config.cliPath?.trim() || "imsg";
  const dbPath = opts.dbPath?.trim() || account.config.dbPath?.trim();
  const target = parseIMessageTarget(opts.chatId ? formatIMessageChatTarget(opts.chatId) : to);

  // If replyToGuid is set, try sending via BlueBubbles HTTP API for threading
  if (opts.replyToGuid && target.kind === "chat_guid") {
    let message = text ?? "";
    if (message.trim()) {
      const tableMode = resolveMarkdownTableMode({
        cfg,
        channel: "imessage",
        accountId: account.accountId,
      });
      message = convertMarkdownTables(message, tableMode);
    }
    const bbResult = await sendViaBlueBubblesReply(target.chatGuid, message, opts.replyToGuid, cfg);
    if (bbResult) {
      return bbResult;
    }
    // Fall through to normal send if BB reply failed
  }

  const service =
    opts.service ??
    (target.kind === "handle" ? target.service : undefined) ??
    (account.config.service as IMessageService | undefined);
  const region = opts.region?.trim() || account.config.region?.trim() || "US";
  const maxBytes =
    typeof opts.maxBytes === "number"
      ? opts.maxBytes
      : typeof account.config.mediaMaxMb === "number"
        ? account.config.mediaMaxMb * 1024 * 1024
        : 16 * 1024 * 1024;
  let message = text ?? "";
  let filePath: string | undefined;

  if (opts.mediaUrl?.trim()) {
    const resolved = await resolveAttachment(opts.mediaUrl.trim(), maxBytes);
    filePath = resolved.path;
    if (!message.trim()) {
      const kind = mediaKindFromMime(resolved.contentType ?? undefined);
      if (kind) {
        message = kind === "image" ? "<media:image>" : `<media:${kind}>`;
      }
    }
  }

  if (!message.trim() && !filePath) {
    throw new Error("iMessage send requires text or media");
  }
  if (message.trim()) {
    const tableMode = resolveMarkdownTableMode({
      cfg,
      channel: "imessage",
      accountId: account.accountId,
    });
    message = convertMarkdownTables(message, tableMode);
  }

  const params: Record<string, unknown> = {
    text: message,
    service: service || "auto",
    region,
  };
  if (filePath) {
    params.file = filePath;
  }

  if (target.kind === "chat_id") {
    params.chat_id = target.chatId;
  } else if (target.kind === "chat_guid") {
    params.chat_guid = target.chatGuid;
  } else if (target.kind === "chat_identifier") {
    params.chat_identifier = target.chatIdentifier;
  } else {
    params.to = target.to;
  }

  const client = opts.client ?? (await createIMessageRpcClient({ cliPath, dbPath }));
  const shouldClose = !opts.client;
  try {
    const result = await client.request<{ ok?: string }>("send", params, {
      timeoutMs: opts.timeoutMs,
    });
    const resolvedId = resolveMessageId(result);
    return {
      messageId: resolvedId ?? (result?.ok ? "ok" : "unknown"),
    };
  } finally {
    if (shouldClose) {
      await client.stop();
    }
  }
}
