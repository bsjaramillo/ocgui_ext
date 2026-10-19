const esbuild = require("esbuild")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(extensionConfig)
    await ctx.watch()
    console.log("[esbuild] watching...")
    return
  }
  await esbuild.build(extensionConfig)
  console.log("[esbuild] build complete")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
