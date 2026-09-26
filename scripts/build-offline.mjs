import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
const root = resolve("dist/client");
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(resolve(directory, entry.name))
          : [resolve(directory, entry.name)],
      ),
    )
  ).flat();
}
const assets = (await files(root))
  .filter(
    (path) =>
      /\.(js|css|woff2?|png|webmanifest)$/.test(path) &&
      !path.endsWith("/sw.js"),
  )
  .sort();
const hash = createHash("sha256");
for (const path of assets) {
  hash.update(relative(root, path));
  hash.update(await readFile(path));
}
const template = await readFile("scripts/service-worker.js", "utf8");
hash.update(template);
const version = hash.digest("hex").slice(0, 16);
const worker = template
  .replace('"__BUILD_VERSION__"', JSON.stringify(version))
  .replace(
    "__BUILD_ASSETS__",
    JSON.stringify(assets.map((path) => "/" + relative(root, path))),
  );
await writeFile(resolve(root, "sw.js"), worker);
await writeFile(
  resolve(root, "offline-version.json"),
  JSON.stringify({ version, assets: assets.length }),
);
const headersPath = resolve(root, "_headers");
const headers = await readFile(headersPath, "utf8").catch(() => "");
await writeFile(
  headersPath,
  headers +
    "\n/sw.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: /\n/manifest.webmanifest\n  Cache-Control: no-cache\n",
);
console.log(`Offline shell ready (${assets.length} assets).`);
