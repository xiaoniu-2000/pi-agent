import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseEChartsOption } = await jiti.import("./echarts-option.ts");

test("accepts a declarative ECharts option", () => {
  const option = parseEChartsOption(JSON.stringify({
    xAxis: { type: "category", data: ["00:00", "01:00"] },
    yAxis: { type: "value" },
    series: [{ type: "line", data: [-6.8, -5.6] }],
  }));
  assert.equal(option.series[0].type, "line");
});

test("rejects invalid and prototype-polluting input", () => {
  assert.throws(() => parseEChartsOption("{not-json}"), /有效 JSON/);
  assert.throws(
    () => parseEChartsOption('{"series":[],"constructor":{"prototype":{}}}'),
    /不安全字段/,
  );
});
