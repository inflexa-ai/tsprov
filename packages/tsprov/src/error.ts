// PROV error hierarchy and the warning callback.
//
// Port of the exception classes (`Error` in `__init__.py`, `ProvException`
// model.py:229, `ProvExceptionInvalidQualifiedName` model.py:241,
// `ProvElementIdentifierRequired` model.py:259) onto native `Error` subclasses.
//
// Python's `ProvWarning(Warning)` (model.py:235) has no TS analogue and is, in
// practice, never raised — the library emits diagnostics via `logger.warning`
// /`logger.debug`. We replace it with a settable warning callback (default
// `console.warn`), per 03-dependency-analysis §3. This is the one home for both
// errors and warnings (diagnostics).

/** Base class for all errors raised by this package (was `prov.Error`, `__init__.py`). */
export class ProvError extends Error {
  override readonly name: string = "ProvError";
}

/** Base class for PROV model exceptions (`model.py:229`). */
export class ProvException extends ProvError {
  override readonly name: string = "ProvException";
}

/** Raised when a qualified name cannot be resolved/validated (`model.py:241`). */
export class ProvExceptionInvalidQualifiedName extends ProvException {
  override readonly name: string = "ProvExceptionInvalidQualifiedName";
  /** The offending qualified-name candidate. */
  readonly qname: unknown;

  /** @param qname The invalid qualified-name candidate. */
  constructor(qname: unknown) {
    super(`Invalid Qualified Name: ${String(qname)}`);
    this.qname = qname;
  }
}

/** Raised when a PROV element is created without an identifier (`model.py:259`). */
export class ProvElementIdentifierRequired extends ProvException {
  override readonly name: string = "ProvElementIdentifierRequired";

  constructor() {
    super(
      "An identifier is missing. All PROV elements require a valid identifier.",
    );
  }
}

/** A handler invoked for non-fatal PROV warnings (e.g. an overridden datatype). */
export type WarningHandler = (message: string) => void;

let warningHandler: WarningHandler = (message) => console.warn(message);

/**
 * Replaces the process-wide warning handler. Pass a no-op to silence warnings,
 * or a collector to capture them. Replaces Python's `ProvWarning`/`logger`
 * coupling with an injectable callback (03-dependency-analysis §3).
 *
 * @param handler The new handler; receives the warning message.
 */
export function setWarningHandler(handler: WarningHandler): void {
  warningHandler = handler;
}

/**
 * Emits a non-fatal warning through the current {@link WarningHandler}.
 *
 * @param message The warning message.
 */
export function warn(message: string): void {
  warningHandler(message);
}
