import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../scripts/json-schema-lite.js";

test("string bounds enforce minLength and maxLength inclusively", () => {
  const schema = { type: "string", minLength: 1, maxLength: 2 };
  assert.deepEqual(validateSchema(schema, "a"), []);
  assert.deepEqual(validateSchema(schema, "ab"), []);
  assert.deepEqual(validateSchema(schema, ""), ["$ is too short"]);
  assert.deepEqual(validateSchema(schema, "abc"), ["$ is too long"]);
});

test("numeric bounds enforce minimum and maximum inclusively", () => {
  const schema = { type: "integer", minimum: 0, maximum: 1 };
  assert.deepEqual(validateSchema(schema, 0), []);
  assert.deepEqual(validateSchema(schema, 1), []);
  assert.deepEqual(validateSchema(schema, -1), ["$ is below minimum"]);
  assert.deepEqual(validateSchema(schema, 2), ["$ is above maximum"]);
});

test("array bounds enforce minItems and maxItems inclusively", () => {
  const schema = { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } };
  assert.deepEqual(validateSchema(schema, ["one"]), []);
  assert.deepEqual(validateSchema(schema, ["one", "two"]), []);
  assert.deepEqual(validateSchema(schema, []), ["$ has too few items"]);
  assert.deepEqual(validateSchema(schema, ["one", "two", "three"]), ["$ has too many items"]);
});
