const textEncoder = new TextEncoder();

function assertUnicodeScalarString(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError(`${path} contains a lone surrogate`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${path} contains a lone surrogate`);
    }
  }
}

function serialize(value, path, seen) {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertUnicodeScalarString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not an I-JSON number`);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not JSON data`);
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path} is a sparse array`);
        entries.push(serialize(value[index], `${path}[${index}]`, seen));
      }
      return `[${entries.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} is not a plain JSON object`);
    }
    const entries = [];
    for (const key of Object.keys(value).sort()) {
      assertUnicodeScalarString(key, `${path} key`);
      entries.push(`${JSON.stringify(key)}:${serialize(value[key], `${path}.${key}`, seen)}`);
    }
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

// RFC 8785 JSON Canonicalization Scheme for already-parsed I-JSON values.
export function canonicalize(value) {
  return serialize(value, "$", new Set());
}

export function parseJsonStrict(text) {
  let index = 0;
  const whitespace = () => { while (/[\u0009\u000a\u000d\u0020]/.test(text[index] ?? "")) index += 1; };
  const string = () => {
    const start = index++; let escaped = false;
    while (index < text.length) {
      const char = text[index++];
      if (!escaped && char === '"') return JSON.parse(text.slice(start, index));
      if (!escaped && char === "\\") escaped = true; else escaped = false;
    }
    throw new SyntaxError("Unterminated JSON string");
  };
  const value = () => {
    whitespace(); const char = text[index];
    if (char === '"') return string();
    if (char === "{") {
      index += 1; const result = Object.create(null); const keys = new Set(); whitespace();
      if (text[index] === "}") { index += 1; return result; }
      while (true) {
        whitespace(); if (text[index] !== '"') throw new SyntaxError("Expected JSON object key");
        const key = string(); if (keys.has(key)) throw new SyntaxError(`Duplicate JSON object key: ${key}`); keys.add(key);
        whitespace(); if (text[index++] !== ":") throw new SyntaxError("Expected colon"); result[key] = value(); whitespace();
        const separator = text[index++]; if (separator === "}") return result; if (separator !== ",") throw new SyntaxError("Expected comma or object end");
      }
    }
    if (char === "[") {
      index += 1; const result = []; whitespace(); if (text[index] === "]") { index += 1; return result; }
      while (true) { result.push(value()); whitespace(); const separator = text[index++]; if (separator === "]") return result; if (separator !== ",") throw new SyntaxError("Expected comma or array end"); }
    }
    for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, index)) { index += literal.length; return parsed; }
    }
    const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new SyntaxError("Invalid JSON value"); index += match[0].length; const number = Number(match[0]);
    if (!Number.isFinite(number)) throw new SyntaxError("JSON number is outside I-JSON range"); return number;
  };
  const parsed = value(); whitespace(); if (index !== text.length) throw new SyntaxError("Trailing JSON content"); canonicalize(parsed); return parsed;
}

export async function digestCanonicalValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(canonicalize(value)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function executableIntent(action) {
  const { evidence: _evidence, review: _review, testEvidence: _legacyTests, rollbackPlan: _legacyRollback, ...intent } = action;
  return intent;
}

export async function digestRequestedAction(action, resolvedTarget) {
  return digestCanonicalValue({ intent: executableIntent(action), resolvedTarget });
}
