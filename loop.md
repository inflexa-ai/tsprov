If the time is greater than 15:00 (using my computer's time), stop looping.

Read ./docs/migration/ fully. It contains documents about migrating a python codebase to typescript, and also progress reports done by other agents.

The migration should be mostly implemented in ./src/ .

I want you to read the codebase and determine if it's typescript idiomatic. For example, there is a case in document:

```
  /**
   * Serializes the document in the given format (`model.py:2707`).
   *
   * @param format Registered format name (default `"json"`).
   * @returns The serialized text.
   * @throws {DoNotExist} If the format has no registered serializer.
   */
  serialize(format = "json"): string {
    const result = getSerializer(format).serialize(this);
    return typeof result === "string"
      ? result
      : new TextDecoder().decode(result);
  }
```

where the format is a string, defaulting to "json". Why not have a union type that can allow the caller to have LSP niceties?

Things like that I don't necessarily love, and I believe there can be many of them in the codebase.

Your goal is to make it more typescript idiomatic, without changing features, or breaking tests, or giving up on the python3 impl (from ./reference/prov/) feature-parity and fidelity

Do your best!
