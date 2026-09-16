const SECRET_KEY = /^(?:authorization|api[_-]?token|apiToken|access[_-]?token|accessToken|client[_-]?secret|clientSecret|secret|private[_-]?key|privateKey|signature|cookie|text|key_base64|key_jwk)$/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const EMBEDDED_SECRET = /\b(client[_-]?secret|api[_-]?token|access[_-]?token)=([^\s&]+)/gi;

export function redactSensitive(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.replace(BEARER_VALUE, "Bearer [REDACTED]").replace(EMBEDDED_SECRET, "$1=[REDACTED]");
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      redactSensitive(child, childKey),
    ]));
  }
  return value;
}

export function secretMetadataOnly(bindings) {
  if (!Array.isArray(bindings)) return [];
  return bindings
    .filter((binding) => binding && (binding.type === "secret_text" || binding.type === "secret_key"))
    .map((binding) => ({ name: String(binding.name ?? ""), type: String(binding.type) }))
    .filter(({ name }) => name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
