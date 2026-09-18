/**
 * Client for the FreeIPA session API, and readers for the entries it returns.
 *
 * Password authentication uses two endpoints:
 * `/ipa/session/login_password` trades credentials for session cookies, and
 * `/ipa/session/json` accepts JSON-RPC calls carrying them. Both
 * require a `Referer` under the server's own `/ipa` path.
 *
 * @packageDocumentation
 */

import { parse as parseSetCookie } from "set-cookie-parser";
import { FreeipaError, describeRejection } from "./errors";
import type { FreeipaOptions, FreeipaUser } from "./types";

/** Endpoint trading credentials for a session cookie. */
const LOGIN_PATH = "/ipa/session/login_password";

/** Endpoint accepting authenticated JSON-RPC calls. */
const JSON_PATH = "/ipa/session/json";

/** API version claimed when none is configured. */
const DEFAULT_CLIENT_VERSION = "2.156";

/** Request timeout in milliseconds when none is configured. */
const DEFAULT_TIMEOUT = 10_000;

/**
 * JSON-RPC error code for `ACIError`: authenticated but not authorised.
 * Treated as a credential rejection, since the login granted no access.
 */
const ACI_ERROR_CODE = 2100;

/** Narrows a parsed JSON body to an object. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A FreeIPA JSON-RPC response. */
interface RpcResponse {
  error?: {
    code?: number;
    name?: string;
    message?: string;
  } | null;
  result?: {
    count?: number;
    result?: FreeipaUser;
  };
}

/**
 * The subset of FreeIPA this package uses.
 *
 * Declared as an interface so the strategy depends on a contract rather than
 * a concrete implementation.
 */
/**
 * Whether a parsed JSON body has the shape of a JSON-RPC response.
 *
 * Every field is optional, so any object qualifies; this rules out a body
 * that parsed to a string, number, or null.
 */
const isRpcResponse = (value: unknown): value is RpcResponse =>
  isRecord(value);

export interface FreeipaClient {
  /**
   * Authenticates credentials and returns that user's directory entry.
   *
   * @param username - FreeIPA login name.
   * @param password - The user's password.
   * @throws {@link FreeipaError} — `AUTH_FAILED` when the credentials are
   * refused, otherwise `REQUEST_FAILED`, `PROTOCOL_ERROR`, or `RPC_ERROR`.
   */
  userShow(username: string, password: string): Promise<FreeipaUser>;
}

/**
 * Normalises a configured server into an absolute origin, upgrading a bare
 * hostname to HTTPS.
 *
 * @throws {@link FreeipaError} — `REQUEST_FAILED` when `server` is unparseable.
 */
const resolveOrigin = (server: string): URL => {
  try {
    return new URL(server.includes("://") ? server : `https://${server}`);
  } catch (cause) {
    throw new FreeipaError(
      `Invalid FreeIPA server: ${server}`,
      "REQUEST_FAILED",
      { cause },
    );
  }
};

/**
 * POSTs to the FreeIPA server.
 *
 * Network failures become `REQUEST_FAILED`; HTTP status codes are left to the
 * caller, since a 401 means something different per endpoint.
 */
const post = async (
  options: FreeipaOptions,
  path: string,
  body: string,
  headers: Record<string, string>,
): Promise<Response> => {
  const origin = resolveOrigin(options.server);
  const request = options.fetch ?? globalThis.fetch;

  try {
    return await request(new URL(path, origin.origin), {
      method: "POST",
      headers: { Referer: `${origin.origin}/ipa`, ...headers },
      body,
      signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT),
      redirect: "manual",
    });
  } catch (cause) {
    throw new FreeipaError(
      `Could not reach FreeIPA at ${origin.host}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "REQUEST_FAILED",
      { cause },
    );
  }
};

/**
 * Extracts every cookie returned by the login response, returning the
 * `name=value` pairs so the complete session can be replayed. Some FreeIPA
 * deployments and reverse proxies set more than just `ipa_session`.
 *
 * @returns The cookie header, or `null` when the response sets no cookies.
 */
const readSessionCookies = (response: Response): string | null => {
  const cookies = parseSetCookie(response.headers.getSetCookie());
  if (cookies.length === 0) {
    return null;
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
};

/** Keeps protocol diagnostics useful without retaining an entire HTML page. */
const bodyPreview = (body: string): string => body.replace(/\s+/g, " ").trim().slice(0, 500);

/**
 * Exchanges credentials for a session cookie.
 *
 * @throws {@link FreeipaError} — `AUTH_FAILED` on 401, `PROTOCOL_ERROR` on
 * any other non-OK status or a 200 carrying no session cookies.
 */
const login = async (
  options: FreeipaOptions,
  username: string,
  password: string,
): Promise<string> => {
  const response = await post(
    options,
    LOGIN_PATH,
    new URLSearchParams({ user: username, password }).toString(),
    {
      Accept: "text/plain",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  );

  if (response.status === 401) {
    const { reason, message } = describeRejection(
      response.headers.get("x-ipa-rejection-reason"),
    );
    throw new FreeipaError(message, "AUTH_FAILED", { reason });
  }

  if (!response.ok) {
    throw new FreeipaError(
      `FreeIPA login returned HTTP ${String(response.status)}.`,
      "PROTOCOL_ERROR",
      { cause: response.status },
    );
  }

  const cookie = readSessionCookies(response);
  if (cookie === null) {
    throw new FreeipaError(
      "FreeIPA login succeeded but returned no session cookies.",
      "PROTOCOL_ERROR",
      {
        cause: {
          status: response.status,
          contentType: response.headers.get("content-type"),
        },
      },
    );
  }

  return cookie;
};

/**
 * Invokes a JSON-RPC method against an authenticated session.
 *
 * @throws {@link FreeipaError} — `AUTH_FAILED` for `ACIError`, `RPC_ERROR`
 * for any other RPC error, `PROTOCOL_ERROR` for a non-JSON or non-OK reply.
 */
const call = async (
  options: FreeipaOptions,
  cookie: string,
  method: string,
  params: [unknown[], Record<string, unknown>],
): Promise<RpcResponse> => {
  const response = await post(
    options,
    JSON_PATH,
    JSON.stringify({ id: 0, method, params }),
    {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
  );

  const contentType = response.headers.get("content-type");
  const rawBody = await response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (cause) {
    throw new FreeipaError(
      `FreeIPA returned a non-JSON response to ${method} (HTTP ${String(response.status)}).`,
      "PROTOCOL_ERROR",
      {
        cause: {
          status: response.status,
          contentType,
          location: response.headers.get("location"),
          bodyPreview: bodyPreview(rawBody),
          parseError: cause,
        },
      },
    );
  }

  if (!isRpcResponse(parsed)) {
    throw new FreeipaError(
      `FreeIPA returned a malformed response to ${method}.`,
      "PROTOCOL_ERROR",
      {
        cause: {
          status: response.status,
          contentType,
          bodyPreview: bodyPreview(rawBody),
          response: parsed,
        },
      },
    );
  }

  const body = parsed;

  if (body.error) {
    const message = body.error.message ?? `FreeIPA rejected ${method}.`;
    throw body.error.code === ACI_ERROR_CODE
      ? new FreeipaError(message, "AUTH_FAILED", {
          reason: "denied",
          cause: body.error,
        })
      : new FreeipaError(message, "RPC_ERROR", { cause: body.error });
  }

  if (!response.ok) {
    throw new FreeipaError(
      `FreeIPA returned HTTP ${String(response.status)} for ${method}.`,
      "PROTOCOL_ERROR",
      { cause: response.status },
    );
  }

  return body;
};

/**
 * Creates a client bound to one FreeIPA server.
 *
 * The client is stateless: each call logs in afresh, since the password is
 * only available per authentication attempt and sharing sessions across users
 * would be unsafe.
 *
 * @param options - Connection settings.
 *
 * @example
 * ```ts
 * const client = createFreeipaClient({ server: "ipa.example.com" });
 * const user = await client.userShow("jdoe", "hunter2");
 * ```
 */
export const createFreeipaClient = (
  options: FreeipaOptions,
): FreeipaClient => ({
  async userShow(username, password) {
    const cookie = await login(options, username, password);
    const body = await call(options, cookie, "user_show", [
      [username],
      { version: options.clientVersion ?? DEFAULT_CLIENT_VERSION },
    ]);

    const user = body.result?.result;
    if (!user) {
      throw new FreeipaError(
        `FreeIPA authenticated ${username} but returned no directory entry.`,
        "PROTOCOL_ERROR",
        { cause: body.result },
      );
    }

    return user;
  },
});

/** Narrows an unknown value to an array without introducing `any`. */
const isArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

/**
 * Reads the first string value of an attribute.
 *
 * Accepts both the array form FreeIPA normally returns and the bare-string
 * form some attributes use.
 *
 * @param user - A FreeIPA directory entry.
 * @param attribute - Attribute name.
 * @returns The value, or `null` when absent or not a string.
 *
 * @example
 * ```ts
 * firstValue({ uid: ["jdoe"] }, "uid"); // "jdoe"
 * firstValue({ uid: "jdoe" }, "uid");   // "jdoe"
 * firstValue({}, "uid");                // null
 * ```
 */
export const firstValue = (
  user: FreeipaUser,
  attribute: string,
): string | null => {
  const value = user[attribute];

  if (typeof value === "string") {
    return value;
  }
  if (isArray(value)) {
    const [first] = value;
    return typeof first === "string" ? first : null;
  }

  return null;
};

/**
 * Reads every string value of an attribute. Non-string values are dropped.
 *
 * @param user - A FreeIPA directory entry.
 * @param attribute - Attribute name.
 * @returns The values, or an empty array when absent.
 *
 * @example
 * ```ts
 * const groups = allValues(entry, "memberof_group");
 * if (!groups.includes("staff")) {
 *   done(null, false, { message: "Staff only." });
 * }
 * ```
 */
export const allValues = (user: FreeipaUser, attribute: string): string[] => {
  const value = user[attribute];

  if (typeof value === "string") {
    return [value];
  }
  if (isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
};
