import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const required = [
  "README.md", "LICENSE", "NOTICE.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SUPPORT.md", "CHANGELOG.md",
  ".gitignore", ".gitattributes", "docs/safety-model.md", "docs/privacy.md", "docs/compatibility.md", "docs/troubleshooting.md",
  "docs/images/portrait-interface-example.png",
  ".github/workflows/ci.yml", ".github/dependabot.yml", ".github/ISSUE_TEMPLATE/bug_report.yml", ".github/ISSUE_TEMPLATE/feature_request.md",
  ".github/pull_request_template.md", "skills/codex-portrait-interface/SKILL.md", "skills/codex-portrait-interface/package.json",
  "skills/codex-portrait-interface/package-lock.json", "skills/codex-portrait-interface/requirements.txt",
];
const forbiddenSegments = new Set(["node_modules", "__pycache__"]);
const forbiddenExtensions = new Set([".asar", ".exe", ".dll", ".pyc", ".pyo", ".sqlite", ".log", ".dmp"]);
const textExtensions = new Set([".md", ".mjs", ".js", ".py", ".json", ".yml", ".yaml", ".toml", ".txt", ".ps1", ".css"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const privatePngChunks = new Set(["eXIf", "iTXt", "tEXt", "zTXt"]);

async function exists(relative) {
  try { await stat(path.join(root, relative)); return true; } catch { return false; }
}

async function walk(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (!forbiddenSegments.has(entry.name)) results.push(...await walk(absolute));
      else results.push({ relative, forbiddenDirectory: true });
    } else if (entry.isFile()) {
      results.push({ relative, absolute, size: (await stat(absolute)).size });
    }
  }
  return results;
}

async function pngMetadataChunks(absolute) {
  const bytes = await readFile(absolute);
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature) return ["invalid-signature"];
  const chunks = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (offset + 12 + length > bytes.length) return ["truncated-chunk"];
    if (privatePngChunks.has(type)) chunks.push(type);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

const problems = [];
for (const relative of required) if (!(await exists(relative))) problems.push(`Missing required release file: ${relative}`);

const files = await walk(root);
for (const file of files) {
  if (file.forbiddenDirectory) {
    problems.push(`Generated directory must not be released: ${file.relative}`);
    continue;
  }
  const extension = path.extname(file.relative).toLowerCase();
  if (forbiddenExtensions.has(extension)) problems.push(`Forbidden generated or binary artifact: ${file.relative}`);
  if (file.size > 1_000_000) problems.push(`Release file exceeds 1 MB: ${file.relative}`);
  if (imageExtensions.has(extension)) {
    if (!file.relative.startsWith("docs/images/")) problems.push(`Image assets are allowed only under docs/images: ${file.relative}`);
    if (extension === ".png") {
      const metadata = await pngMetadataChunks(file.absolute);
      if (metadata.length) problems.push(`Documentation PNG contains private or invalid metadata (${metadata.join(", ")}): ${file.relative}`);
    }
  }
  if (!textExtensions.has(extension) && !path.basename(file.relative).match(/^(LICENSE)$/)) continue;
  const content = await readFile(file.absolute, "utf8");
  if (/C:\\Users\\/i.test(content) || /C:\/Users\//i.test(content) || /\bInsist\b/i.test(content)) {
    problems.push(`Machine-specific path or username found in: ${file.relative}`);
  }
}

try {
  const packageJson = JSON.parse(await readFile(path.join(root, "skills/codex-portrait-interface/package.json"), "utf8"));
  const packageLock = JSON.parse(await readFile(path.join(root, "skills/codex-portrait-interface/package-lock.json"), "utf8"));
  if (packageJson.dependencies?.["@electron/asar"] !== "4.2.0") problems.push("@electron/asar must be pinned to 4.2.0 in package.json.");
  if (packageLock.packages?.["node_modules/@electron/asar"]?.version !== "4.2.0") problems.push("package-lock.json does not lock @electron/asar 4.2.0.");
} catch (error) {
  problems.push(`Could not validate the dependency lock: ${error.message}`);
}

try {
  const skill = await readFile(path.join(root, "skills/codex-portrait-interface/SKILL.md"), "utf8");
  if (!/^---\r?\nname: codex-portrait-interface\r?\ndescription: .+\r?\n---/s.test(skill)) {
    problems.push("Skill frontmatter is missing the expected name and description.");
  }
} catch (error) {
  problems.push(`Could not validate SKILL.md: ${error.message}`);
}

const result = { status: problems.length ? "failed" : "passed", root, files: files.filter((file) => !file.forbiddenDirectory).length, problems };
console.log(JSON.stringify(result, null, 2));
if (problems.length) process.exitCode = 1;
