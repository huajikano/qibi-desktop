// 把 server/src 打包成单文件，供 Electron 主进程内联加载。
// node:sqlite 等内置模块由 esbuild(platform:"node") 自动保留为 require，不会被打包进产物。
import { build } from "esbuild";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

await build({
  entryPoints: [path.join(root, "server", "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: path.join(here, "server-bundle.mjs"),
  // server 的依赖都是纯 JS（express/helmet/bcryptjs 等），一并打进单文件，
  // Electron 安装包里就不需要再带一份 server/node_modules。
  external: [],
  banner: {
    // esbuild 的 ESM 输出默认不提供 require/__dirname；bcryptjs 等 CJS 依赖内部会用到 require。
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});

// 同步一份前端构建产物，供主进程以 WEB_DIST 指向。
const webDistSrc = path.join(root, "web", "dist");
const webDistDest = path.join(here, "web-dist");
if (!fs.existsSync(webDistSrc)) {
  throw new Error(`未找到前端构建产物：${webDistSrc}，请先执行 npm run build -w web`);
}
fs.rmSync(webDistDest, { recursive: true, force: true });
fs.cpSync(webDistSrc, webDistDest, { recursive: true });
console.log(`[desktop] 已复制前端产物 -> ${webDistDest}`);

// 同步 cloudflared 可执行文件（若存在）
const cfCandidates = [
  path.join(root, "cloudflared-windows-amd64.exe"),
  path.join(root, "cloudflared", "cloudflared-windows-amd64.exe"),
];
for (const src of cfCandidates) {
  if (fs.existsSync(src)) {
    const dest = path.join(here, "cloudflared-windows-amd64.exe");
    fs.copyFileSync(src, dest);
    console.log(`[desktop] 已打包 Cloudflare 隧道文件 -> ${dest}`);
    break;
  }
}
