import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../scripts/json-schema-lite.js";

test("date-time requires an explicit valid calendar time and timezone", () => {
  const schema = { type: "string", format: "date-time" };
  for (const value of [
    "2026-08-19T21:00:00Z",
    "2024-02-29t23:59:59.123+05:30",
  ]) assert.deepEqual(validateSchema(schema, value), []);
  for (const value of [
    "2026-08-19",
    "2026-08-19T21:00:00",
    "2026-02-30T00:00:00Z",
    "2026-08-19T24:00:00Z",
    "2026-08-19T21:00:00+24:00",
  ]) assert.deepEqual(validateSchema(schema, value), ["$ is not date-time"]);
});

test("string bounds enforce minLength and maxLength inclusively", () => {
  const schema = { type: "string", minLength: 1, maxLength: 2 };
  assert.deepEqual(validateSchema(schema, "a"), []);
  assert.deepEqual(validateSchema(schema, "ab"), []);
  assert.deepEqual(validateSchema(schema, ""), ["$ is too short"]);
  assert.deepEqual(validateSchema(schema, "abc"), ["$ is too long"]);
});

test("string bounds count Unicode characters instead of UTF-16 code units", () => {
  const schema = { type: "string", minLength: 2, maxLength: 2 };
  assert.deepEqual(validateSchema(schema, "😀a"), []);
  assert.deepEqual(validateSchema(schema, "😀"), ["$ is too short"]);
  assert.deepEqual(validateSchema(schema, "😀ab"), ["$ is too long"]);
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
