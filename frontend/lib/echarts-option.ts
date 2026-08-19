const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_OPTION_NODES = 20_000;
const MAX_OPTION_DEPTH = 40;

export type SafeEChartsOption = Record<string, unknown>;

function validateJsonValue(value: unknown, depth: number, state: { nodes: number }): void {
  state.nodes += 1;
  if (state.nodes > MAX_OPTION_NODES) throw new Error("图表配置过大");
  if (depth > MAX_OPTION_DEPTH) throw new Error("图表配置嵌套过深");

  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("图表配置包含无效数字");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => validateJsonValue(item, depth + 1, state));
    return;
  }
  if (typeof value !== "object") throw new Error("图表配置只能使用 JSON 数据");

  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key)) throw new Error(`图表配置包含不安全字段：${key}`);
    validateJsonValue(child, depth + 1, state);
  }
}

export function parseEChartsOption(source: string): SafeEChartsOption {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("ECharts 配置不是有效 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ECharts 配置必须是一个 JSON 对象");
  }
  validateJsonValue(parsed, 0, { nodes: 0 });
  return parsed as SafeEChartsOption;
}
