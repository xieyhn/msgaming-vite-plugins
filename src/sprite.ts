import fsp from 'node:fs/promises'
import path from 'node:path'
import { type Plugin, type ResolvedConfig, normalizePath } from 'vite'
import { cleanUrl, generateAssetFileName, replaceExtname, resolveFileUrl } from './utils'

const spriteReg = /(\?|&)sprite(&|$)/

export function sprite(): Plugin {
  let config: ResolvedConfig
  const referenceIds = new Set<string>()

  return {
    name: 'vite-plugin-sprite',
    enforce: 'pre',

    configResolved(_config) {
      config = _config
    },

    async resolveId(id, importer) {
      if (!spriteReg.test(id))
        return

      if (config.command === 'serve')
        return this.resolve(id.replace(spriteReg, '$1url$2'), importer, { skipSelf: true })

      if (path.extname(cleanUrl(id)) === '.sprite')
        return id
      const resolved = await this.resolve(id, importer, { skipSelf: true })
      if (resolved) {
        // 更换后缀名，避免其它插件处理这个文件
        return replaceExtname(resolved.id, '.sprite')
      }
    },

    async load(id) {
      if (!spriteReg.test(id))
        return

      id = replaceExtname(cleanUrl(normalizePath(id)), '.json')
      this.addWatchFile(id)

      const json = JSON.parse(await fsp.readFile(id, 'utf-8')) as Record<string, any>
      // 生成模拟的 json 输出文件名，便于后面输出其它资源时做相对路径处理
      let jsonFileName = generateAssetFileName(path.basename(id), 'json content', config)

      const imageId = path.resolve(path.dirname(id), json.meta.image)
      this.addWatchFile(imageId)
      const imageContent = await fsp.readFile(imageId)
      const imageFileName = generateAssetFileName(path.basename(imageId), imageContent, config)
      json.meta.image = path.relative(path.dirname(jsonFileName), imageFileName)

      this.emitFile({
        type: 'asset',
        source: imageContent,
        fileName: imageFileName,
      })

      const jsonString = JSON.stringify(json)
      jsonFileName = generateAssetFileName(path.basename(id), jsonString, config)

      const referenceId = this.emitFile({
        type: 'asset',
        source: jsonString,
        fileName: jsonFileName,
      })

      referenceIds.add(referenceId)

      return `export default import.meta.ROLLUP_FILE_URL_${referenceId}`
    },

    resolveFileUrl({ fileName, referenceId, format, relativePath }) {
      if (!referenceIds.has(referenceId))
        return

      return resolveFileUrl({
        format,
        relativePath,
        fileName,
        query: '?sprite',
      })
    },
  }
}
