/**
 * FreeIPA username and password authentication for Passport.
 *
 * @example
 * ```ts
 * import passport from "passport";
 * import { FreeipaStrategy } from "@topsinoty/passport-freeipa";
 *
 * passport.use(new FreeipaStrategy({ freeipa: { server: "ipa.example.com" } }));
 * ```
 *
 * @packageDocumentation
 */

export { FreeipaStrategy } from "./strategy";

/**
 * Alias for {@link FreeipaStrategy}, matching the `Strategy` name Passport
 * strategies conventionally export.
 */
export { FreeipaStrategy as Strategy } from "./strategy";

export { allValues, createFreeipaClient, firstValue } from "./client";
export type { FreeipaClient } from "./client";

export {
  FreeipaError,
  describeRejection,
  isCredentialRejection,
} from "./errors";
export type { FreeipaErrorCode, RejectionReason } from "./errors";

export type {
  AnyVerifyCallback,
  AuthenticateOptions,
  BaseStrategyOptions,
  FreeipaOptions,
  FreeipaUser,
  PassportRequest,
  StrategyOptions,
  StrategyOptionsWithRequest,
  StrategyOptionsWithoutRequest,
  VerifyCallback,
  VerifyCallbackWithRequest,
  VerifyDone,
} from "./types";
