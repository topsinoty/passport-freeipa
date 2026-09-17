/**
 * Error type and rejection mapping for FreeIPA failures.
 *
 * @packageDocumentation
 */

/**
 * Classification of a {@link FreeipaError}.
 *
 * `AUTH_FAILED` means the credentials were refused and maps to Passport's
 * `fail()`. Every other code is an internal fault and maps to `error()`.
 */
export type FreeipaErrorCode =
  /** FreeIPA refused the supplied credentials. */
  | "AUTH_FAILED"
  /** Server unreachable: DNS, TLS, timeout, or connection reset. */
  | "REQUEST_FAILED"
  /** Server answered outside the protocol. */
  | "PROTOCOL_ERROR"
  /** JSON-RPC call returned an error object. */
  | "RPC_ERROR";

/**
 * Why FreeIPA turned a login away.
 *
 * Mirrors the `X-IPA-Rejection-Reason` header. `unknown` covers servers that
 * omit it and values this package does not recognise.
 */
export type RejectionReason =
  | "invalid-password"
  | "password-expired"
  | "krbprincipal-expired"
  | "denied"
  | "unknown";

/** Message shown for each rejection reason. */
const REJECTION_MESSAGES: Record<RejectionReason, string> = {
  "invalid-password": "Invalid username or password.",
  "password-expired": "Password expired. Please reset your password.",
  "krbprincipal-expired": "Account expired.",
  denied: "Access denied.",
  unknown: "Invalid username or password.",
};

/** Whether a header value is a rejection reason this package recognises. */
const isRejectionReason = (value: string): value is RejectionReason =>
  Object.hasOwn(REJECTION_MESSAGES, value);

/**
 * Translates an `X-IPA-Rejection-Reason` header into a user-safe message.
 *
 * Unrecognised values collapse to `unknown` so a future FreeIPA release
 * cannot leak an unexpected string to a login form.
 *
 * @param reason - Header value, or `null` when absent.
 *
 * @example
 * ```ts
 * describeRejection("password-expired");
 * // { reason: "password-expired", message: "Password expired. Please reset your password." }
 * ```
 */
export const describeRejection = (
  reason: string | null,
): { reason: RejectionReason; message: string } => {
  const known =
    reason !== null && isRejectionReason(reason) ? reason : "unknown";

  return { reason: known, message: REJECTION_MESSAGES[known] };
};

/**
 * An error raised while communicating with FreeIPA.
 *
 * @example
 * ```ts
 * try {
 *   await client.userShow("jdoe", "hunter2");
 * } catch (error) {
 *   if (error instanceof FreeipaError && error.code === "AUTH_FAILED") {
 *     // credentials were wrong
 *   }
 * }
 * ```
 */
export class FreeipaError extends Error {
  public override readonly name = "FreeipaError";

  /** Classification used to choose between `fail()` and `error()`. */
  public readonly code: FreeipaErrorCode;

  /** Why the credentials were rejected. Set only when {@link code} is `AUTH_FAILED`. */
  public readonly reason?: RejectionReason;

  /** Underlying error or response body, retained for logging. */
  public override readonly cause?: unknown;

  /**
   * @param message - User-safe description.
   * @param code - Classification of the failure.
   * @param options - Rejection reason and underlying cause.
   */
  public constructor(
    message: string,
    code: FreeipaErrorCode,
    options?: { reason?: RejectionReason; cause?: unknown },
  ) {
    super(message);
    this.code = code;
    if (options?.reason !== undefined) {
      this.reason = options.reason;
    }
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Whether an error means the credentials were wrong rather than something
 * being broken.
 *
 * @param error - Any caught value.
 */
export const isCredentialRejection = (
  error: unknown,
): error is FreeipaError & { code: "AUTH_FAILED" } =>
  error instanceof FreeipaError && error.code === "AUTH_FAILED";

/**
 * Coerces an unknown thrown value into an `Error`.
 *
 * `catch` binds `unknown`, while Passport's `error()` expects an `Error`.
 *
 * @param value - Any caught value.
 */
export const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));
