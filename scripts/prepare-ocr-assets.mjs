import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "public", "ocr");
const coreSource = resolve(projectRoot, "node_modules", "tesseract.js-core");
const languageSource = resolve(
  projectRoot,
  "node_modules",
  "@tesseract.js-data",
  "por",
  "4.0.0_best_int",
);

mkdirSync(resolve(outputDirectory, "core"), { recursive: true });
mkdirSync(resolve(outputDirectory, "lang"), { recursive: true });

copyFileSync(
  resolve(projectRoot, "node_modules", "tesseract.js", "dist", "worker.min.js"),
  resolve(outputDirectory, "worker.min.js"),
);

for (const file of readdirSync(coreSource)) {
  if (/^tesseract-core(?:-(?:simd|relaxedsimd))?-lstm\.wasm(?:\.js)?$/.test(file)) {
    copyFileSync(resolve(coreSource, file), resolve(outputDirectory, "core", file));
  }
}

copyFileSync(
  resolve(languageSource, "por.traineddata.gz"),
  resolve(outputDirectory, "lang", "por.traineddata.gz"),
);
