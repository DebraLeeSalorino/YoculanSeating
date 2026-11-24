export type ErrorCode = "forbidden" | "not_found" | "invalid" | "conflict" | "unauthenticated";

/** An error whose message is safe to show to the signed-in user. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (message = "You don't have permission to do that.") => new AppError("forbidden", message);
export const notFound = (what = "That record") => new AppError("not_found", `${what} was not found.`);
export const invalid = (message: string) => new AppError("invalid", message);
export const conflict = (message: string) => new AppError("conflict", message);
