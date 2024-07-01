import fsp from 'node:fs/promises'
import path from 'node:path'
import { type Plugin, type ResolvedConfig, normalizePath } from 'vite'
import { load } from 'cheerio'
import { cleanUrl, generateAssetFileName, resolveFileUrl } from './utils'

const fontReg = /(\?|&)font(&|$)/

export function xmlFont(): Plugin {
  let config: ResolvedConfig
  const referenceIds = new Set<string>()

  return {
    name: 'vite-plugin-import-font',
    enforce: 'pre',

    configResolved(_config) {
      config = _config
    },

    async resolveId(id, importer) {
      if (!fontReg.test(id))
        return

      if (config.command === 'serve')
        return this.resolve(id.replace(fontReg, '$1url$2'), importer, { skipSelf: true })
    },

    async load(id) {
      if (!fontReg.test(id))
        return

      id = cleanUrl(normalizePath(id))
      this.addWatchFile(id)

      let xml = await fsp.readFile(id, 'utf-8')
      // 生成模拟的 xml 输出文件名，便于后面输出其它资源时做相对路径处理
      let xmlFileName = generateAssetFileName(path.basename(id), 'xml content', config)
      const $ = load(xml, { xmlMode: true })

      await Promise.all(
        $('pages page').map(async (_, page) => {
          const file = $(page).attr('file')
          if (!file)
            return
          const fileId = path.resolve(path.dirname(id), file)
          this.addWatchFile(fileId)
          const source = await fsp.readFile(fileId)
          const fileName = generateAssetFileName(path.basename(fileId), source, config)
          this.emitFile({
            type: 'asset',
            fileName,
            source,
          })
          // 与 xml 文件同级
          $(page).attr('file', path.relative(path.dirname(xmlFileName), fileName))
        }),
      )

      xml = $.xml()
      xmlFileName = generateAssetFileName(path.basename(id), xml, config)

      const referenceId = this.emitFile({
        type: 'asset',
        fileName: xmlFileName,
        source: xml,
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
        query: '?font',
      })
    },
  }
}
