/**
 * Public types, grouped by concern. Ambient declarations live in `./d`.
 *
 * @packageDocumentation
 */

export type { PassportRequest } from "./request";

export type { FreeipaOptions, FreeipaUser } from "./freeipa";

export type {
  AnyVerifyCallback,
  VerifyCallback,
  VerifyCallbackWithRequest,
  VerifyDone,
} from "./verify";

export type {
  AuthenticateOptions,
  BaseStrategyOptions,
  StrategyOptions,
  StrategyOptionsWithRequest,
  StrategyOptionsWithoutRequest,
} from "./options";
