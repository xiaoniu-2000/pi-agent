"use client";

import { useMemo, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { apiDownloadUrl, apiUrl } from "@/lib/runtime-api";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { EChartsBlock } from "./EChartsBlock";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, sessionId }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={{
          code({ className, children, ...props }) {
            const lang = className?.replace("language-", "").toLowerCase() ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              if (lang === "mermaid") {
                return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
              }
              if (lang === "echarts" || lang === "echarts-json") {
                return <EChartsBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
              }
              return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
            }
            return (
              <code
                className="markdown-inline-code"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
          a({ href, children, ...props }) {
            // `node` is react-markdown metadata, not a DOM attribute.
            delete props.node;
            const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
            const openFile = onOpenFile;
            if (!filePath || !openFile) {
              return (
                <a href={href} {...props} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            }

            const handleClick = (event: MouseEvent<HTMLElement>) => {
              if (event.defaultPrevented || event.button !== 0) return;
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              const target = event.currentTarget.getAttribute("target");
              if (target && target !== "_self") return;
              event.preventDefault();
              openFile(filePath);
            };

            const encodedPath = encodeFilePathForApi(filePath);
            const fileName = filePath.split(/[\\/]/).pop() || "文件";
            return (
              <span className="artifact-link">
                <button type="button" className="artifact-link-open" onClick={handleClick} title={`预览 ${fileName}`}>
                  <span aria-hidden="true">📄</span>
                  <span>{children}</span>
                </button>
                <a
                  className="artifact-link-download"
                  href={apiDownloadUrl(encodedPath, sessionId)}
                  download={fileName}
                  title={`下载 ${fileName}`}
                >
                  下载
                </a>
              </span>
            );
          },
          img({ src, alt, ...props }) {
            delete props.node;
            const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
            const imageSrc = filePath
              ? apiUrl(`/api/files/${encodeFilePathForApi(filePath)}?type=read${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`)
              : src;
            // Dynamic local paths are served directly by the file API.
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
          },
          table({ children }) {
            return (
              <div className="markdown-table-wrap">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
