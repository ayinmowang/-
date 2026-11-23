export const NATIVE_GEMINI_BASE = "https://code28.ccwu.cc" as const;
export const NATIVE_GEMINI_MODEL = "gemini-4-carbon" as const;
export const NATIVE_GEMINI_URL =
  "https://code28.ccwu.cc/v1beta/models/gemini-4-carbon:streamGenerateContent?alt=sse" as const;

export interface NativeMediaInput {
  name: string;
  mimeType: string;
  base64: string;
}

export interface NativeInlineDataPart {
  inline_data: {
    mime_type: "image/jpeg" | "video/mp4";
    data: string;
  };
}

const MAX_NATIVE_VIDEO_BYTES = 19 * 1024 * 1024;
const MIN_NATIVE_VIDEO_BYTES = 12;

function assertValidMp4Base64(compact: string): void {
  if (compact.length < 16 || compact.length % 4 !== 0) {
    throw new NativeGeminiError("INVALID_MEDIA", "Malformed MP4 base64 length");
  }
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const decodedBytes = (compact.length / 4) * 3 - padding;
  if (decodedBytes < MIN_NATIVE_VIDEO_BYTES) {
    throw new NativeGeminiError("INVALID_MEDIA", "MP4 payload is too short");
  }
  if (decodedBytes > MAX_NATIVE_VIDEO_BYTES) {
    throw new NativeGeminiError("INVALID_MEDIA", "MP4 payload exceeds the 19MiB limit");
  }
  const head = Buffer.from(compact.slice(0, 16), "base64");
  if (head.length < MIN_NATIVE_VIDEO_BYTES || head.toString("latin1", 4, 8) !== "ftyp") {
    throw new NativeGeminiError("INVALID_MEDIA", "MP4 payload is missing the ftyp box at offset 4");
  }
}

export interface NativeTextPart {
  text: string;
}

export type NativeContentPart = NativeInlineDataPart | NativeTextPart;

export interface BuildNativeRequestArgs {
  apiKey: string;
  userText: string;
  images?: NativeMediaInput[];
  systemText?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface BuiltNativeRequest {
  url: typeof NATIVE_GEMINI_URL;
  method: "POST";
  headers: {
    "Content-Type": "application/json";
    "x-goog-api-key": string;
  };
  body: string;
}

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface ParsedGeminiSseResult {
  ok: boolean;
  text: string;
  finish: string | null;
  usage: GeminiUsage | null;
  usageUnknown: boolean;
  error?: string;
}

export interface PostNativeOnceResult extends ParsedGeminiSseResult {
  status?: number;
  detail?: string;
}

export class NativeGeminiError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "NativeGeminiError";
    this.code = code;
  }
}

const DATA_URI_PREFIX_RE = /^data:[^;,]+;base64,/i;
const BASE64_BODY_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function assertNoForbiddenMediaShape(item: unknown): void {
  if (!item || typeof item !== "object") {
    throw new NativeGeminiError("INVALID_MEDIA", "Media item must be an object");
  }
  const record = item as Record<string, unknown>;
  if ("image_url" in record || "url" in record || "dataUri" in record) {
    throw new NativeGeminiError("INVALID_MEDIA", "OpenAI image_url or URI shapes are forbidden");
  }
}

export function buildNativeVisionParts(
  userText: string,
  images?: NativeMediaInput[]
): NativeContentPart[] {
  if (typeof userText !== "string" || userText.trim().length === 0) {
    throw new NativeGeminiError("INVALID_PROMPT", "userText must be a non-empty string");
  }

  const parts: NativeContentPart[] = [];
  const mediaList = images ?? [];

  if (!Array.isArray(mediaList)) {
    throw new NativeGeminiError("INVALID_MEDIA", "images must be an array");
  }

  for (const rawItem of mediaList) {
    assertNoForbiddenMediaShape(rawItem);

    const mimeType = typeof rawItem.mimeType === "string" ? rawItem.mimeType.trim().toLowerCase() : "";
    if (mimeType !== "image/jpeg" && mimeType !== "video/mp4") {
      throw new NativeGeminiError(
        "UNSUPPORTED_MIME",
        `Only image/jpeg is supported, got: ${mimeType || "empty"} (video/mp4 is accepted only as a complete MP4)`
      );
    }

    const base64 = typeof rawItem.base64 === "string" ? rawItem.base64.trim() : "";
    if (!base64) {
      throw new NativeGeminiError("INVALID_MEDIA", "Missing base64 payload");
    }
    if (DATA_URI_PREFIX_RE.test(base64) || base64.startsWith("http://") || base64.startsWith("https://")) {
      throw new NativeGeminiError("INVALID_MEDIA", "Data URI or URL is forbidden in base64 field");
    }
    const compactBase64 = base64.replace(/\s+/g, "");
    if (!BASE64_BODY_RE.test(compactBase64)) {
      throw new NativeGeminiError("INVALID_MEDIA", "Malformed base64 payload");
    }

    const wireMime: "image/jpeg" | "video/mp4" = mimeType === "video/mp4" ? "video/mp4" : "image/jpeg";
    if (wireMime === "video/mp4") {
      if (base64 !== compactBase64) {
        throw new NativeGeminiError("INVALID_MEDIA", "MP4 base64 must not contain whitespace");
      }
      assertValidMp4Base64(compactBase64);
    }

    parts.push({
      inline_data: {
        mime_type: wireMime,
        data: compactBase64,
      },
    });
  }

  parts.push({ text: userText });
  return parts;
}

export function buildNativeRequest(args: BuildNativeRequestArgs): BuiltNativeRequest {
  const apiKey = typeof args?.apiKey === "string" ? args.apiKey.trim() : "";
  if (!apiKey) {
    throw new NativeGeminiError("MISSING_API_KEY", "apiKey is required");
  }

  const parts = buildNativeVisionParts(args.userText, args.images);

  const payload: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
  };

  if (typeof args.systemText === "string" && args.systemText.trim().length > 0) {
    payload.systemInstruction = {
      parts: [{ text: args.systemText }],
    };
  }

  const generationConfig: Record<string, number> = {};
  if (typeof args.temperature === "number" && Number.isFinite(args.temperature)) {
    generationConfig.temperature = args.temperature;
  }
  if (typeof args.maxOutputTokens === "number" && Number.isFinite(args.maxOutputTokens)) {
    generationConfig.maxOutputTokens = args.maxOutputTokens;
  }
  if (Object.keys(generationConfig).length > 0) {
    payload.generationConfig = generationConfig;
  }

  return {
    url: NATIVE_GEMINI_URL,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  };
}

function decodeInputToUtf8(raw: string | Uint8Array | Buffer): string {
  if (typeof raw === "string") {
    return raw;
  }
  return new TextDecoder("utf-8").decode(raw);
}

function extractUsage(meta: unknown): GeminiUsage | null {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const m = meta as Record<string, unknown>;
  const usage: GeminiUsage = {};
  let hasAny = false;

  if (typeof m.promptTokenCount === "number" && Number.isFinite(m.promptTokenCount)) {
    usage.promptTokenCount = m.promptTokenCount;
    hasAny = true;
  }
  if (typeof m.candidatesTokenCount === "number" && Number.isFinite(m.candidatesTokenCount)) {
    usage.candidatesTokenCount = m.candidatesTokenCount;
    hasAny = true;
  }
  if (typeof m.thoughtsTokenCount === "number" && Number.isFinite(m.thoughtsTokenCount)) {
    usage.thoughtsTokenCount = m.thoughtsTokenCount;
    hasAny = true;
  }
  if (typeof m.totalTokenCount === "number" && Number.isFinite(m.totalTokenCount)) {
    usage.totalTokenCount = m.totalTokenCount;
    hasAny = true;
  }

  return hasAny ? usage : null;
}

function mergeUsage(prev: GeminiUsage | null, next: GeminiUsage | null): GeminiUsage | null {
  if (!next) return prev;
  if (!prev) return { ...next };
  return {
    ...prev,
    ...next,
  };
}

function isSafetyReason(reason: string): boolean {
  const upper = reason.toUpperCase();
  return (
    upper.includes("SAFETY") ||
    upper.includes("BLOCK") ||
    upper === "PROHIBITED_CONTENT" ||
    upper === "SPII" ||
    upper === "RECITATION"
  );
}

export function parseGeminiSse(raw: string | Uint8Array | Buffer): ParsedGeminiSseResult {
  const normalized = decodeInputToUtf8(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const eventBlocks = normalized.split(/\n\n+/);

  const textChunks: string[] = [];
  let finishReason: string | null = null;
  let blockReason: string | null = null;
  let usage: GeminiUsage | null = null;
  let sawParseError = false;

  for (const block of eventBlocks) {
    if (!block.trim()) {
      continue;
    }

    const lines = block.split("\n");
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(":")) {
        continue;
      }
      if (line.startsWith("data:")) {
        const value = line.slice(5);
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    const joinedData = dataLines.join("\n").trim();
    if (!joinedData || joinedData === "[DONE]") {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(joinedData) as Record<string, unknown>;
    } catch {
      sawParseError = true;
      continue;
    }

    const promptFeedback = parsed.promptFeedback as Record<string, unknown> | undefined;
    if (promptFeedback && typeof promptFeedback.blockReason === "string" && promptFeedback.blockReason) {
      blockReason = promptFeedback.blockReason;
    }

    const nextUsage = extractUsage(parsed.usageMetadata);
    usage = mergeUsage(usage, nextUsage);

    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    for (const cand of candidates) {
      if (!cand || typeof cand !== "object") continue;
      const candidate = cand as Record<string, unknown>;

      if (typeof candidate.finishReason === "string" && candidate.finishReason.trim()) {
        finishReason = candidate.finishReason.trim();
      }

      const content = candidate.content as Record<string, unknown> | undefined;
      const parts = Array.isArray(content?.parts) ? content.parts : [];
      for (const part of parts) {
        if (!part || typeof part !== "object") continue;
        const partObj = part as Record<string, unknown>;
        if (partObj.thought === true) {
          continue;
        }
        if (typeof partObj.text === "string" && partObj.text.length > 0) {
          textChunks.push(partObj.text);
        }
      }
    }
  }

  const text = textChunks.join("");
  const usageUnknown = usage === null;

  if (blockReason || (finishReason && isSafetyReason(finishReason))) {
    return {
      ok: false,
      text,
      finish: finishReason ?? blockReason,
      usage,
      usageUnknown,
      error: "SAFETY_BLOCKED",
    };
  }

  if (finishReason === "MAX_TOKENS") {
    return {
      ok: false,
      text,
      finish: finishReason,
      usage,
      usageUnknown,
      error: "OUTPUT_TRUNCATED",
    };
  }

  if (finishReason && finishReason !== "STOP") {
    return {
      ok: false,
      text,
      finish: finishReason,
      usage,
      usageUnknown,
      error: "OUTPUT_TRUNCATED",
    };
  }

  if (!finishReason && usageUnknown) {
    return {
      ok: false,
      text,
      finish: null,
      usage: null,
      usageUnknown: true,
      error: sawParseError ? "SSE_PARSE_ERROR" : "STREAM_TRUNCATED",
    };
  }

  if (!finishReason) {
    return {
      ok: false,
      text,
      finish: null,
      usage,
      usageUnknown,
      error: "STREAM_TRUNCATED",
    };
  }

  if (text.trim().length === 0) {
    return {
      ok: false,
      text,
      finish: finishReason,
      usage,
      usageUnknown,
      error: "EMPTY_RESPONSE",
    };
  }

  return {
    ok: true,
    text,
    finish: finishReason,
    usage,
    usageUnknown,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactErrorText(text: string, extraSecrets: string[] = []): string {
  if (typeof text !== "string" || text.length === 0) {
    return "";
  }

  let sanitized = text;

  for (const secret of extraSecrets) {
    if (typeof secret === "string" && secret.trim().length >= 4) {
      sanitized = sanitized.replace(new RegExp(escapeRegExp(secret.trim()), "g"), "[REDACTED]");
    }
  }

  sanitized = sanitized.replace(
    /data:[^;\s"']+;base64,[A-Za-z0-9+/=\s]+/gi,
    "[REDACTED_DATA_URI]"
  );

  sanitized = sanitized.replace(
    /(["']?x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+(["']?)/gi,
    "$1[REDACTED]$2"
  );

  sanitized = sanitized.replace(
    /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
    "$1[REDACTED]"
  );

  sanitized = sanitized.replace(/\bAIza[0-9A-Za-z_-]{16,}\b/g, "[REDACTED_KEY]");
  sanitized = sanitized.replace(/\bsk-[0-9A-Za-z_-]{16,}\b/g, "[REDACTED_KEY]");
  sanitized = sanitized.replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]");

  sanitized = sanitized.replace(/[A-Za-z0-9+/]{64,}={0,2}/g, "[REDACTED_BASE64]");

  if (sanitized.length > 240) {
    sanitized = `${sanitized.slice(0, 240)}...[TRUNCATED]`;
  }

  return sanitized;
}

export type NativePhase =
  | "payload_prepare"
  | "request_start"
  | "response_headers"
  | "response_body"
  | "first_chunk"
  | "body_complete"
  | "parse"
  | "complete";

export async function postNativeOnce(
  args: BuildNativeRequestArgs,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  onPhase?: (phase: NativePhase, status?: number) => void
): Promise<PostNativeOnceResult> {
  const mark = (phase: NativePhase, status?: number) => {
    if (!onPhase) return;
    try {
      onPhase(phase, status);
    } catch {
      // diagnostics must never affect transport
    }
  };
  mark("payload_prepare");
  const req = buildNativeRequest(args);
  const secretsToRedact: string[] = [args.apiKey];
  if (typeof args.userText === "string" && args.userText.trim().length > 0) {
    secretsToRedact.push(args.userText);
  }
  if (typeof args.systemText === "string" && args.systemText.trim().length > 0) {
    secretsToRedact.push(args.systemText);
  }
  for (const img of args.images ?? []) {
    if (img && typeof img.base64 === "string" && img.base64.trim().length > 0) {
      secretsToRedact.push(img.base64.trim());
    }
  }

  let response: Response;
  try {
    mark("request_start");
    response = await fetchImpl(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      text: "",
      finish: null,
      usage: null,
      usageUnknown: true,
      error: "REQUEST_FAILED",
      detail: redactErrorText(rawMsg, secretsToRedact),
    };
  }

  mark("response_headers", response.status);
  if (!response.ok) {
    let rawErrorBody = "";
    try {
      rawErrorBody = await response.text();
    } catch {
      rawErrorBody = "";
    }
    const statusHint = `HTTP ${response.status}`;
    const safeHint = redactErrorText(
      rawErrorBody ? `${statusHint}: ${rawErrorBody}` : statusHint,
      secretsToRedact
    );
    return {
      ok: false,
      status: response.status,
      text: "",
      finish: null,
      usage: null,
      usageUnknown: true,
      error: "HTTP_ERROR",
      detail: safeHint,
    };
  }

  let rawStream = "";
  let sawChunk = false;
  mark("response_body");
  try {
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      const chunks: string[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (!sawChunk && value.byteLength > 0) {
            sawChunk = true;
            mark("first_chunk");
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
      }
      chunks.push(decoder.decode());
      rawStream = chunks.join("");
    } else {
      rawStream = await response.text();
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: response.status,
      text: "",
      finish: null,
      usage: null,
      usageUnknown: true,
      error: "STREAM_READ_FAILED",
      detail: redactErrorText(rawMsg, secretsToRedact),
    };
  }

  if (!sawChunk && rawStream.length > 0) mark("first_chunk");
  mark("body_complete");
  mark("parse");
  const parsed = parseGeminiSse(rawStream);
  mark("complete", response.status);
  return {
    ...parsed,
    status: response.status,
  };
}
