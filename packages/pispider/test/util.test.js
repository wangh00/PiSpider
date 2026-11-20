import assert from "node:assert/strict";
import test from "node:test";
import { findUserEntries } from "../src/rewind.js";
import { parseFrontmatter, splitArgs, validateId } from "../src/util.js";

test("splitArgs keeps quoted paths and subcommand words intact", () => {
  assert.deepEqual(splitArgs('skills import "C:\\work\\my skill" js-trace'), [
    "skills",
    "import",
    "C:\\work\\my skill",
    "js-trace",
  ]);
  assert.deepEqual(splitArgs("  rules   use  evidence-first "), ["rules", "use", "evidence-first"]);
});

test("frontmatter parses scalar values and leaves the body untouched", () => {
  const parsed = parseFrontmatter("---\nname: demo\nversion: 2\nflag: true\n---\n\n# Body\n");
  assert.equal(parsed.data.name, "demo");
  assert.equal(parsed.data.version, 2);
  assert.equal(parsed.data.flag, true);
  assert.equal(parsed.body, "# Body\n");
});

test("rewind discovery ignores assistant and tool entries", () => {
  const entries = [
    { id: "u1", type: "message", message: { role: "user", content: "first" } },
    { id: "a1", type: "message", message: { role: "assistant", content: [] } },
    { id: "u2", type: "message", message: { role: "user", content: [{ type: "text", text: "second" }] } },
    { id: "t1", type: "message", message: { role: "toolResult", content: [] } },
  ];
  assert.deepEqual(findUserEntries(entries), [
    { id: "u1", text: "first", timestamp: undefined },
    { id: "u2", text: "second", timestamp: undefined },
  ]);
});

test("validateId rejects traversal, separators, and malformed ids", () => {
  assert.equal(validateId("valid-rule-1"), "valid-rule-1");
  for (const value of ["../x", "a/b", "Upper", "-bad", "bad-", "two--hyphens", ""]) {
    assert.throws(() => validateId(value));
  }
});
