import fsp from 'node:fs/promises'
import path from 'node:path'
import { type Plugin, type ResolvedConfig, normalizePath } from 'vite'
import { cleanUrl, generateAssetFileName, replaceExtname, resolveFileUrl } from './utils'

const lottieReg = /(\?|&)lottie(&|$)/

export function lottie(): Plugin {
  let config: ResolvedConfig
  const referenceIds = new Set<string>()

  return {
    name: 'vite-plugin-lottie',
    enforce: 'pre',

    configResolved(_config) {
      config = _config
    },

    async resolveId(id, importer) {
      if (!lottieReg.test(id))
        return

      if (config.command === 'serve')
        return this.resolve(id.replace(lottieReg, '$1url$2'), importer, { skipSelf: true })

      if (path.extname(cleanUrl(id)) === '.lottie')
        return id

      const resolved = await this.resolve(id, importer, { skipSelf: true })
      if (resolved) {
        // 更换后缀名，避免其它插件处理这个文件
        return replaceExtname(resolved.id, '.lottie')
      }
    },

    async load(id) {
      if (!lottieReg.test(id))
        return
      id = replaceExtname(cleanUrl(normalizePath(id)), '.json')
      this.addWatchFile(id)
      const json = JSON.parse(await fsp.readFile(id, 'utf-8')) as Record<string, any>

      // 生成模拟的 json 输出文件名，便于后面输出其它资源时做相对路径处理
      let jsonFileName = generateAssetFileName(path.basename(id), 'json content', config)

      if (json.assets) {
        for (const asset of json.assets) {
          if (asset.p && /\.png|jpe?g$/.test(asset.p)) {
            const assetId = path.resolve(path.dirname(id), path.join(asset.u || '', asset.p))
            this.addWatchFile(assetId)
            const assetContent = await fsp.readFile(assetId)
            const fileName = generateAssetFileName(path.basename(assetId), assetContent, config)

            this.emitFile({
              type: 'asset',
              source: assetContent,
              fileName,
            })

            Reflect.deleteProperty(asset, 'u')
            // 保持与 json 相对路径
            asset.p = path.relative(path.dirname(jsonFileName), fileName)
          }
        }
      }

      jsonFileName = generateAssetFileName(path.basename(id), JSON.stringify(json), config)

      const referenceId = this.emitFile({
        type: 'asset',
        source: JSON.stringify(json),
        fileName: jsonFileName,
      })

      referenceIds.add(referenceId)

      return `export default import.meta.ROLLUP_FILE_URL_${referenceId}`
    },

    resolveFileUrl({ referenceId, format, relativePath, fileName }) {
      if (!referenceIds.has(referenceId))
        return

      return resolveFileUrl({
        format,
        relativePath,
        fileName,
        query: '?lottie',
      })
    },
  }
}
