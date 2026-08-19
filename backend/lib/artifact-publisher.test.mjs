import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const subject = await jiti.import("./artifact-publisher.ts");

test("finds only new or modified user-facing artifacts", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-web-artifacts-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(join(workspace, "input.csv"), "time,value\n00:00,1\n");
  const before = subject.snapshotWorkspaceArtifacts(workspace);

  writeFileSync(join(workspace, "input.csv"), "time,value\n00:00,2\n00:05,3\n");
  writeFileSync(join(workspace, "plot one.png"), "png");
  writeFileSync(join(workspace, "report.docx"), "docx");
  writeFileSync(join(workspace, "analysis.py"), "print('not a published result')\n");
  mkdirSync(join(workspace, ".cache"));
  writeFileSync(join(workspace, ".cache", "hidden.json"), "{}");
  symlinkSync(join(workspace, "report.docx"), join(workspace, "report-link.docx"));

  const changed = subject.findChangedWorkspaceArtifacts(before, workspace);
  assert.deepEqual(changed.map((file) => file.split("/").pop()), [
    "plot one.png",
    "input.csv",
    "report.docx",
  ]);
  const markdown = subject.buildArtifactPublicationMarkdown(changed, workspace);
  assert.match(markdown, /!\[plot one\.png\]\(file:\/\/\/.*plot%20one\.png\)/);
  assert.match(markdown, /\[下载 report\.docx\]\(file:\/\/\//);
  assert.doesNotMatch(markdown, /analysis\.py|hidden\.json|report-link/);
});

test("returns no publication when nothing changed", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-web-artifacts-empty-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(join(workspace, "existing.pdf"), "pdf");
  const before = subject.snapshotWorkspaceArtifacts(workspace);
  assert.deepEqual(subject.findChangedWorkspaceArtifacts(before, workspace), []);
  assert.equal(subject.buildArtifactPublicationMarkdown([], workspace), null);
});
