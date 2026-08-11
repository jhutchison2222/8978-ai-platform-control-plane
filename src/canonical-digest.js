const textEncoder = new TextEncoder();

export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
  return `{${entries.join(",")}}`;
}

export async function digestCanonicalValue(value) {
  const bytes = textEncoder.encode(canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export async function digestRequestedAction(action) {
  // Review and test evidence bind to this digest and therefore are not part of
  // the executable intent being digested.
  const { review: _review, testEvidence: _testEvidence, ...executableIntent } = action;
  return digestCanonicalValue(executableIntent);
}
