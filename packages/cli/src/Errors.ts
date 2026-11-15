import * as Schema from "effect/Schema";

/** A failure the user can act on. The message is printed as is. */
export class CliFailure extends Schema.TaggedError<CliFailure>()("CliFailure", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
