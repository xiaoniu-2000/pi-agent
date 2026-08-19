import { lstatSync, readdirSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isImagePath } from "./file-types";

export interface WorkspaceFileState {
  size: number;
  mtimeMs: number;
}

export type WorkspaceArtifactSnapshot = Map<string, WorkspaceFileState>;

const MAX_SCANNED_ENTRIES = 20_000;
const MAX_DEPTH = 16;
const MAX_PUBLISHED_FILES = 40;
const MAX_IMAGE_PREVIEWS = 10;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".venv",
  "__pycache__",
  "node_modules",
  "venv",
]);
const PUBLISHABLE_EXTENSIONS = new Set([
  "7z", "avif", "bmp", "csv", "doc", "docx", "feather", "gif", "geojson",
  "grb", "grib", "gz", "h5", "hdf", "hdf5", "htm", "html", "ico", "jpeg",
  "jpg", "json", "md", "mp3", "mp4", "nc", "nc4", "ods", "ogg", "parquet",
  "pdf", "png", "ppt", "pptx", "rar", "svg", "tar", "tgz", "tif", "tiff",
  "tsv", "txt", "wav", "webm", "webp", "xls", "xlsm", "xlsx", "xml", "yaml",
  "yml", "zip",
]);

function isPublishableFile(filePath: string): boolean {
  const fileName = basename(filePath);
  if (!fileName || fileName.startsWith(".")) return false;
  const extension = extname(fileName).slice(1).toLowerCase();
  return PUBLISHABLE_EXTENSIONS.has(extension);
}

/** Collect bounded metadata only; file contents are never read. */
export function snapshotWorkspaceArtifacts(workspace: string): WorkspaceArtifactSnapshot {
  const root = resolve(workspace);
  const snapshot: WorkspaceArtifactSnapshot = new Map();
  let visited = 0;

  const walk = (directory: string, depth: number) => {
    if (depth > MAX_DEPTH || visited >= MAX_SCANNED_ENTRIES) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (visited >= MAX_SCANNED_ENTRIES) break;
      visited += 1;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const filePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(filePath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isPublishableFile(filePath)) continue;
      try {
        const stat = lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        snapshot.set(resolve(filePath), { size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // A concurrently replaced file is simply considered on the next scan.
      }
    }
  };

  walk(root, 0);
  return snapshot;
}

export function findChangedWorkspaceArtifacts(
  before: WorkspaceArtifactSnapshot,
  workspace: string,
): string[] {
  const after = snapshotWorkspaceArtifacts(workspace);
  const changed: string[] = [];
  for (const [filePath, state] of after) {
    const previous = before.get(filePath);
    if (!previous || previous.size !== state.size || previous.mtimeMs !== state.mtimeMs) {
      changed.push(filePath);
    }
  }
  return changed
    .sort((left, right) => {
      const imageOrder = Number(isImagePath(right)) - Number(isImagePath(left));
      if (imageOrder !== 0) return imageOrder;
      return left.localeCompare(right, "zh-CN");
    })
    .slice(0, MAX_PUBLISHED_FILES);
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, "\\$1");
}

function displayPath(filePath: string, workspace: string): string {
  const rel = relative(resolve(workspace), resolve(filePath));
  return (rel || basename(filePath)).split(sep).join("/");
}

/** Build UI-native image previews and download links without model cooperation. */
export function buildArtifactPublicationMarkdown(files: string[], workspace: string): string | null {
  if (files.length === 0) return null;
  const images = files.filter(isImagePath);
  const otherFiles = files.filter((filePath) => !isImagePath(filePath));
  const lines = [
    "本轮生成的产物已由系统自动发布，无需 Agent 读取前端源码。",
  ];

  if (images.length > 0) {
    lines.push("", "### 图片");
    images.forEach((filePath, index) => {
      const label = escapeMarkdownLabel(displayPath(filePath, workspace));
      const url = pathToFileURL(filePath).href;
      if (index < MAX_IMAGE_PREVIEWS) lines.push(`![${label}](${url})`);
      lines.push(`[下载 ${label}](${url})`);
    });
  }

  if (otherFiles.length > 0) {
    lines.push("", "### 可下载文件");
    for (const filePath of otherFiles) {
      const label = escapeMarkdownLabel(displayPath(filePath, workspace));
      lines.push(`- [下载 ${label}](${pathToFileURL(filePath).href})`);
    }
  }

  return lines.join("\n");
}
