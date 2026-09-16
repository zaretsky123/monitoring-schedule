import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const projectRoot = process.cwd();
const outputDir = path.join(projectRoot, "public", "workers");
const sources = [
  ["lib/schedule/calendar.ts", "calendar.js"],
  ["lib/schedule/validator.ts", "validator.js"],
  ["lib/schedule/solver.ts", "solver.js"],
  ["workers/schedule.worker.ts", "schedule-worker.js"],
];

await fs.mkdir(outputDir, { recursive: true });

for (const [sourcePath, outputName] of sources) {
  const source = await fs.readFile(path.join(projectRoot, sourcePath), "utf8");
  let javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;
  javascript = javascript
    .replace(/from "\.\.\/lib\/schedule\/solver"/g, 'from "./solver.js"')
    .replace(/from "(\.\/[^".]+)"/g, 'from "$1.js"');
  await fs.writeFile(path.join(outputDir, outputName), javascript, "utf8");
}
