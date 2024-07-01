import { createHash } from 'node:crypto'
import type { Buffer } from 'node:buffer'
import path from 'node:path'
import process from 'node:process'
import type { InternalModuleFormat, OutputOptions } from 'rollup'
import type { ResolvedConfig } from 'vite'

export function getHash(text: Buffer | string, length = 8): string {
  const h = createHash('sha256').update(text).digest('hex').substring(0, length)
  if (length <= 64)
    return h
  return h.padEnd(length, '_')
}

const postfixRE = /[?#].*$/
export function cleanUrl(url: string): string {
  return url.replace(postfixRE, '')
}

export function replaceExtname(id: string, extname: string) {
  let [path, query] = id.split('?')
  path = path.replace(/\.[^\.]+$/, extname)
  return query ? `${path}?${query}` : path
}

/**
 * Forked from rollup src/utils/renderNamePattern.ts
 *
 * 其中移除了一些错误处理
 */
export function renderNamePattern(
  pattern: string,
  replacements: { [name: string]: (size?: number) => string },
): string {
  return pattern.replace(
    /\[(\w+)(:\d+)?]/g,
    (_match, type: string, size: `:${string}` | undefined) => {
      const replacement = replacements[type](size && Number.parseInt(size.slice(1)))
      return replacement
    },
  )
}

export function getAssetFileNamePattern(name: string, source: string | Buffer, resolvedConfig: ResolvedConfig) {
  // 提供 rollupOptions.output.assetFileNames 是必要的
  const assetFileNames = (resolvedConfig.build.rollupOptions.output as OutputOptions).assetFileNames!
  return typeof assetFileNames === 'function'
    ? assetFileNames({ name, source, type: 'asset' })
    : assetFileNames
}

export function generateAssetFileName(
  name: string,
  source: string | Buffer,
  resolvedConfig: ResolvedConfig,
) {
  return renderNamePattern(
    getAssetFileNamePattern(name, source, resolvedConfig),
    {
      ext: () => path.extname(name).slice(1),
      extname: () => path.extname(name),
      hash: size => getHash(source).slice(0, Math.max(0, size || 8)),
      name: () => name.slice(0, Math.max(0, name.length - path.extname(name).length)),
    },
  )
}

export function createNonceStr() {
  return Math.random().toString(36).substring(2, 15)
}

export function resolveFileUrl(
  opts: {
    fileName: string
    format: InternalModuleFormat
    relativePath: string
    query: string
  },
) {
  if (!process.env.BUILD_LIB)
    // 以下配置仅在构建 @msgaming/* 包时生效，宿主环境在通过构建时使用默认处理即可
    return

  if (opts.format === 'es')
    // 约定：若输出格式为 es，则表示当前库将作为第三方包（node_modules）提供给宿主环境使用
    // 因此携带 query 参数，以便再构建（宿主环境）中能够正确引用到资源
    return `r('${ensureRelativePath(opts.relativePath)}${opts.query}')`
  else if (opts.format === 'iife')
    // iife 通过 script 标签引入，可以使用 document.currentScript.src
    return `new URL('${opts.fileName}', document.currentScript && document.currentScript.src || document.baseURI).href`
  else if (opts.format === 'system')
    return `new URL('${opts.fileName}', module.meta.url).href`
}

export function callAsyncSequential<Arg extends any[]>(callbacks: Array<(...args: Arg) => void>, ...args: Arg) {
  return callbacks.reduce((prev, cb) => prev.then(() => cb(...args)), Promise.resolve())
}

export function ensureRelativePath(path: string) {
  if (!path.startsWith('.'))
    return `./${path}`
  return path
}

export function match(matcher: string | RegExp, id: string) {
  return typeof matcher === 'string' ? matcher === id : matcher.test(id)
}
