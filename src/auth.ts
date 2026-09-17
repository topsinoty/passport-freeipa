/**
 * The authentication flow: credential extraction, the FreeIPA call, and the
 * verify callback.
 *
 * @packageDocumentation
 */

import { isCredentialRejection, toError } from "./errors";
import type { FreeipaClient } from "./client";
import type {
  AnyVerifyCallback,
  AuthenticateOptions,
  FreeipaUser,
  PassportRequest,
  VerifyCallbackWithRequest,
  VerifyDone,
} from "./types";

/** Challenge message used when a request carries no usable credentials. */
const MISSING_CREDENTIALS = "Missing credentials.";

/** Narrows an unknown value to an indexable object. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Reads a credential from a parsed body or query string.
 *
 * Field names may use bracket notation, matching how HTML forms serialise
 * grouped inputs. Only string values are returned: a field resolving to an
 * object, array, number, or boolean is treated as absent rather than
 * coerced, so a body such as `{"password": {"$ne": null}}` is rejected.
 * Prototype properties are not reachable.
 *
 * @param source - Parsed body or query object.
 * @param field - Field name, optionally using bracket notation.
 * @returns The value, or `null` when absent or not a string.
 *
 * @example
 * ```ts
 * resolveField({ username: "jdoe" }, "username");         // "jdoe"
 * resolveField({ user: { name: "jdoe" } }, "user[name]"); // "jdoe"
 * resolveField({ username: ["jdoe"] }, "username");       // null
 * ```
 */
export const resolveField = (source: unknown, field: string): string | null => {
  const segments = field.replaceAll("]", "").split("[");
  let current: unknown = source;

  for (const segment of segments) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return null;
    }

    current = current[segment];
  }

  return typeof current === "string" ? current : null;
};

/**
 * A verify callback normalised to always take the request.
 *
 * Callbacks that do not want it have it dropped during binding, keeping the
 * call site free of branching and type assertions.
 */
export type BoundVerify<TRequest extends PassportRequest = PassportRequest> = (
  request: TRequest,
  user: FreeipaUser,
  done: VerifyDone,
) => void;

/**
 * Narrows a verify callback using the option that selects its shape.
 *
 * The strategy's constructor overloads let `passReqToCallback: true` accept
 * only a {@link VerifyCallbackWithRequest}, so this is the one place that
 * pairing is resolved.
 */
const takesRequest = <TRequest extends PassportRequest>(
  verify: AnyVerifyCallback<TRequest>,
  passReqToCallback: boolean,
): verify is VerifyCallbackWithRequest<TRequest> => passReqToCallback;

/**
 * Converts either verify callback shape into a {@link BoundVerify}.
 *
 * @param verify - The application-supplied callback.
 * @param passReqToCallback - Which shape the callback has.
 * @param context - `this` for the callback, by Passport convention the
 * strategy instance.
 */
export const bindVerify = <TRequest extends PassportRequest>(
  verify: AnyVerifyCallback<TRequest>,
  passReqToCallback: boolean,
  context: unknown,
): BoundVerify<TRequest> => {
  if (takesRequest(verify, passReqToCallback)) {
    return (request, user, done) => {
      verify.call(context, request, user, done);
    };
  }

  return (_request, user, done) => {
    verify.call(context, user, done);
  };
};

/**
 * The three outcomes a Passport strategy can report.
 *
 * Passport attaches these to the strategy instance at call time; modelling
 * them explicitly keeps {@link authenticateRequest} free of that mechanism.
 */
export interface PassportActions {
  /** The user is authenticated. */
  success(user: FreeipaUser, info?: unknown): void;
  /** The credentials were refused. */
  fail(challenge: unknown, status: number): void;
  /** Something broke that is not the user's fault. */
  error(error: Error): void;
}

/** Collaborators {@link authenticateRequest} needs to service one request. */
export interface AuthenticationContext<
  TRequest extends PassportRequest = PassportRequest,
> {
  /** The incoming request. */
  request: TRequest;
  /** Options from `passport.authenticate()`. */
  options: AuthenticateOptions;
  /** Field holding the username. */
  usernameField: string;
  /** Field holding the password. */
  passwordField: string;
  /** Callback normalised by {@link bindVerify}. Absent when none was supplied. */
  verify?: BoundVerify<TRequest>;
  /** Client used to reach FreeIPA. */
  client: FreeipaClient;
  /** Outcome reporters. */
  actions: PassportActions;
}

/**
 * Authenticates one request against FreeIPA.
 *
 * Reads the credentials from the body, falling back to the query string;
 * asks FreeIPA to authenticate them and return the directory entry; then
 * hands that entry to the verify callback, if any.
 *
 * Failures split along Passport's contract: anything caused by the submitted
 * credentials reports `fail()`, so the application's failure handler runs,
 * while anything caused by the deployment reports `error()`.
 *
 * @returns A promise settling once an outcome has been reported. Passport
 * ignores it; it exists so tests can await the flow.
 */
export const authenticateRequest = async <TRequest extends PassportRequest>({
  request,
  options,
  usernameField,
  passwordField,
  verify,
  client,
  actions,
}: AuthenticationContext<TRequest>): Promise<void> => {
  const username =
    resolveField(request.body, usernameField) ??
    resolveField(request.query, usernameField);
  const password =
    resolveField(request.body, passwordField) ??
    resolveField(request.query, passwordField);

  if (!username || !password) {
    actions.fail(
      { message: options.badRequestMessage ?? MISSING_CREDENTIALS },
      400,
    );
    return;
  }

  let user: FreeipaUser;
  try {
    user = await client.userShow(username, password);
  } catch (error) {
    if (isCredentialRejection(error)) {
      actions.fail({ message: error.message, reason: error.reason }, 401);
    } else {
      actions.error(toError(error));
    }
    return;
  }

  if (!verify) {
    actions.success(user);
    return;
  }

  let settled = false;

  /**
   * Bridges the verify callback's node-style callback onto Passport.
   *
   * Guarded against a second call so a misbehaving callback cannot make
   * Passport report two outcomes for one request.
   */
  const done: VerifyDone = (error, verifiedUser, info) => {
    if (settled) {
      return;
    }
    settled = true;

    if (error) {
      actions.error(error);
    } else if (!verifiedUser) {
      actions.fail(info, 401);
    } else {
      actions.success(verifiedUser, info);
    }
  };

  try {
    verify(request, user, done);
  } catch (error) {
    done(toError(error));
  }
};
