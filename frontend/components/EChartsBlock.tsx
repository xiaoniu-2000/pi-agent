"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsType } from "echarts/core";
import { parseEChartsOption } from "@/lib/echarts-option";

export function EChartsBlock({ code, isStreaming = false }: { code: string; isStreaming?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const parsed = useMemo(() => {
    try {
      return { option: parseEChartsOption(code), error: null };
    } catch (error) {
      return { option: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [code]);

  useEffect(() => {
    if (!containerRef.current || !parsed.option) return;
    const element = containerRef.current;
    let chart: EChartsType | null = null;
    let resizeObserver: ResizeObserver | null = null;

    try {
      const theme = document.documentElement.classList.contains("dark") ? "dark" : undefined;
      chart = echarts.init(element, theme, { renderer: "canvas" });
      chart.setOption(parsed.option, { notMerge: true, lazyUpdate: false });
      resizeObserver = new ResizeObserver(() => chart?.resize());
      resizeObserver.observe(element);
      setRenderError(null);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error));
    }

    return () => {
      resizeObserver?.disconnect();
      chart?.dispose();
    };
  }, [parsed.option]);

  if (!parsed.option) {
    if (isStreaming) return <div className="echarts-loading">正在接收图表数据…</div>;
    return (
      <div className="echarts-error" role="alert">
        <strong>图表配置无法解析</strong>
        <span>{parsed.error}</span>
        <pre>{code}</pre>
      </div>
    );
  }

  return (
    <figure className="echarts-block">
      <div ref={containerRef} className="echarts-canvas" role="img" aria-label="交互式数据图表" />
      {renderError && <figcaption className="echarts-error">图表渲染失败：{renderError}</figcaption>}
    </figure>
  );
}
