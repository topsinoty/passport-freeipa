/**
 * The Passport strategy.
 *
 * @packageDocumentation
 */

import { authenticateRequest, bindVerify } from "./auth";
import { createFreeipaClient } from "./client";
import type { BoundVerify } from "./auth";
import type { FreeipaClient } from "./client";
import type {
  AnyVerifyCallback,
  AuthenticateOptions,
  FreeipaOptions,
  FreeipaUser,
  PassportRequest,
  StrategyOptionsWithRequest,
  StrategyOptionsWithoutRequest,
  VerifyCallback,
  VerifyCallbackWithRequest,
} from "./types";

/**
 * Raised when an action method is called outside an authentication attempt.
 *
 * Passport replaces `success`, `fail` and `error` on a per-request copy of
 * the strategy. Reaching these definitions means the strategy was driven
 * without Passport having done so.
 */
const notAuthenticating = (method: string): Error =>
  new Error(
    `passport-freeipa: ${method}() is provided by Passport during authenticate(); it cannot be called directly.`,
  );

/** Per-request options when `passport.authenticate()` supplies none. */
const NO_OPTIONS: AuthenticateOptions = Object.freeze({});

/**
 * Constructor input as it arrives at runtime, where a JavaScript caller may
 * pass anything. The overloads above are what TypeScript callers see.
 */
interface StrategyOptionsInput {
  freeipa?: FreeipaOptions;
  usernameField?: string;
  passwordField?: string;
  passReqToCallback?: boolean;
}

/**
 * Authenticates a username and password against FreeIPA.
 *
 * Posts the submitted credentials to FreeIPA's session login endpoint and, on
 * success, fetches the user's directory entry. That entry goes to the verify
 * callback for mapping onto an application user; without a callback it
 * becomes `req.user` directly.
 *
 * A refused credential reports `fail()`, so Passport runs the failure
 * handler; an unreachable or misbehaving server reports `error()`.
 *
 * Does not extend `passport-strategy`: that base class is an empty
 * constructor whose only method is an `authenticate` that throws, and
 * Passport requires nothing of a strategy beyond `name` and `authenticate`.
 * Omitting it keeps the published declarations free of untyped imports.
 *
 * @typeParam TRequest - Framework request type seen by a
 * `passReqToCallback` verify callback.
 *
 * @example Minimal setup
 * ```ts
 * import passport from "passport";
 * import { FreeipaStrategy } from "@topsinoty/passport-freeipa";
 *
 * passport.use(new FreeipaStrategy({ freeipa: { server: "ipa.example.com" } }));
 *
 * app.post(
 *   "/login",
 *   passport.authenticate("freeipa", { failureRedirect: "/login" }),
 * );
 * ```
 *
 * @example Mapping entries onto local accounts
 * ```ts
 * import { FreeipaStrategy, firstValue } from "@topsinoty/passport-freeipa";
 *
 * passport.use(
 *   new FreeipaStrategy(
 *     { freeipa: { server: "ipa.example.com" } },
 *     (entry, done) => {
 *       const uid = firstValue(entry, "uid");
 *       if (uid === null) {
 *         done(null, false, { message: "Entry has no uid." });
 *         return;
 *       }
 *       User.findOrCreate({ uid }).then((user) => { done(null, user); }, done);
 *     },
 *   ),
 * );
 * ```
 */
export class FreeipaStrategy<
  TRequest extends PassportRequest = PassportRequest,
> {
  /** Name registered with Passport: `passport.authenticate("freeipa")`. */
  public readonly name = "freeipa";

  /** FreeIPA connection settings this strategy was built with. */
  public readonly freeipa: FreeipaOptions;

  /** Field the username is read from. */
  public readonly usernameField: string;

  /** Field the password is read from. */
  public readonly passwordField: string;

  /** Whether the verify callback receives the request. */
  public readonly passReqToCallback: boolean;

  /** Verify callback normalised to one shape. Unset when none was supplied. */
  private readonly verify?: BoundVerify<TRequest>;

  /** Client used to reach FreeIPA. */
  private readonly client: FreeipaClient;

  /**
   * Authenticates against FreeIPA. Without a verify callback the directory
   * entry becomes `req.user` unchanged.
   *
   * @param options - Strategy configuration.
   * @param verify - Receives the entry and reports the decision.
   */
  public constructor(
    options: StrategyOptionsWithoutRequest,
    verify?: VerifyCallback,
  );

  /**
   * As above, with the request passed to the verify callback.
   *
   * @param options - Strategy configuration with `passReqToCallback: true`.
   * @param verify - Receives the request, the entry, and `done`.
   */
  public constructor(
    options: StrategyOptionsWithRequest,
    verify: VerifyCallbackWithRequest<TRequest>,
  );

  /**
   * @throws {TypeError} When no FreeIPA server is configured, or when
   * `passReqToCallback` is set without a verify callback to receive the
   * request.
   */
  public constructor(
    options?: StrategyOptionsInput,
    verify?: AnyVerifyCallback<TRequest>,
  ) {
    if (!options?.freeipa?.server) {
      throw new TypeError(
        "passport-freeipa: options.freeipa.server is required.",
      );
    }
    if (!verify && options.passReqToCallback) {
      throw new TypeError(
        "passport-freeipa: passReqToCallback is set but no verify callback was provided.",
      );
    }

    this.freeipa = options.freeipa;
    this.usernameField = options.usernameField ?? "username";
    this.passwordField = options.passwordField ?? "password";
    this.passReqToCallback = options.passReqToCallback ?? false;
    this.client = createFreeipaClient(this.freeipa);

    if (verify) {
      this.verify = bindVerify<TRequest>(verify, this.passReqToCallback, this);
    }
  }

  /**
   * Authenticates a request. Called by Passport, not by application code.
   *
   * The promise from the flow is deliberately not returned: Passport's
   * contract is callback-driven, and every outcome is reported through
   * `success`, `fail`, or `error`.
   *
   * @param request - The incoming request.
   * @param options - Options from `passport.authenticate()`.
   */
  public authenticate(
    request: TRequest,
    options: AuthenticateOptions = NO_OPTIONS,
  ): void {
    void authenticateRequest({
      request,
      options,
      usernameField: this.usernameField,
      passwordField: this.passwordField,
      ...(this.verify ? { verify: this.verify } : {}),
      client: this.client,
      actions: {
        success: (user, info) => {
          this.success(user, info);
        },
        fail: (challenge, status) => {
          this.fail(challenge, status);
        },
        error: (error) => {
          this.error(error);
        },
      },
    });
  }

  /**
   * Reports a successful authentication.
   *
   * Replaced by Passport for the duration of {@link authenticate}.
   *
   * @param user - The authenticated user.
   * @param info - Info attached to the success.
   */
  public success(user: FreeipaUser, info?: unknown): void {
    throw notAuthenticating("success");
  }

  /**
   * Reports a failed authentication.
   *
   * Replaced by Passport for the duration of {@link authenticate}.
   *
   * @param challenge - Challenge describing the failure.
   * @param status - HTTP status to respond with.
   */
  public fail(challenge: unknown, status: number): void {
    throw notAuthenticating("fail");
  }

  /**
   * Reports an internal error.
   *
   * Replaced by Passport for the duration of {@link authenticate}.
   *
   * @param error - The error that occurred.
   */
  public error(error: Error): void {
    throw notAuthenticating("error");
  }
}
