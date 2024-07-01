import fsp from 'node:fs/promises'
import path from 'node:path'
import { type Plugin, type ResolvedConfig, normalizePath } from 'vite'
import type { PluginContext } from 'rollup'
import { cleanUrl, ensureRelativePath, generateAssetFileName, replaceExtname, resolveFileUrl } from './utils'
import { LANGUAGES, localeReg, parseLocaleArgs } from './locale'

const spineReg = /(\?|&)spine(&|$)/

export function spine(): Plugin {
  let config: ResolvedConfig
  const referenceIds = new Set<string>()
  // 用于记录已经 emit 的文件名，避免重复 emit
  const outputFileNames = new Set<string>()

  const loadAtlas = async (id: string, outputDir: string, pluginContext: PluginContext) => {
    const atlasContent = await fsp.readFile(id, 'utf-8')
    const lines = atlasContent.split(/\r\n|\r|\n/)
    let index = 0
    const newLines: string[] = []
    // 生成当前 atlas 文件的输出文件名，便于解析后续相对资源的路径
    const outputFileName = generateAssetFileName(outputDir, 'virtual', config)

    const parseAsset = async (id: string) => {
      const source = await fsp.readFile(id)
      const fileName = generateAssetFileName(path.basename(id), source, config)
      if (!outputFileNames.has(fileName)) {
        pluginContext.emitFile({
          type: 'asset',
          source,
          fileName,
        })
        outputFileNames.add(fileName)
      }
      return path.relative(path.dirname(outputFileName), fileName)
    }

    const parseLocaleLine = async (importer: string) => {
      const line = ensureRelativePath(lines[index++])
      let rollbackLanguage: string | null = null
      let rollbackLine: string | null = null

      newLines.push('[locale block]')

      const resolveLanguage = async (language: string) => {
        const resolved = await pluginContext.resolve(line.replace(localeReg, language), importer, { skipSelf: true })
        if (!resolved)
          return null
        let langLine = ''
        if (/\.atlas$/.test(resolved.id)) {
          const source = await loadAtlas(resolved.id, `${language}/`, pluginContext)
          const fileName = generateAssetFileName(path.join(language, path.basename(resolved.id)), source, config)
          if (!outputFileNames.has(fileName)) {
            pluginContext.emitFile({
              type: 'asset',
              source,
              fileName,
            })
            outputFileNames.add(fileName)
          }
          langLine = path.relative(path.dirname(outputFileName), fileName)
        }
        else {
          langLine = await parseAsset(resolved.id)
        }

        return {
          id: resolved.id,
          langLine,
        }
      }

      const localeArgs = parseLocaleArgs(line)

      if (typeof localeArgs.rollback !== 'undefined') {
        if (!LANGUAGES.includes(localeArgs.rollback))
          pluginContext.error(`invalid rollback language: ${localeArgs.rollback}`)
        const resolved = await resolveLanguage(localeArgs.rollback)
        if (!resolved)
          pluginContext.error(`rollback resource not found: ${line}`)
        rollbackLanguage = localeArgs.rollback
        rollbackLine = resolved.langLine
        pluginContext.addWatchFile(resolved.id)
      }

      for (const language of LANGUAGES) {
        if (language === rollbackLanguage) {
          newLines.push(`${language} ${rollbackLine}`)
          continue
        }

        const resolved = await resolveLanguage(language)

        if (!resolved) {
          if (rollbackLine)
            newLines.push(`${language} ${rollbackLine}`)
          continue
        }

        pluginContext.addWatchFile(resolved.id)
        newLines.push(`${language} ${resolved.langLine}`)
      }

      newLines.push('[/locale block]')
    }

    const parseNormalLine = async (importer: string) => {
      const line = ensureRelativePath(lines[index++])
      const resolved = await pluginContext.resolve(line, importer, { skipSelf: true })

      if (!resolved)
        return

      pluginContext.addWatchFile(resolved.id)

      if (/\.atlas$/.test(resolved.id)) {
        const atlasContent = await loadAtlas(resolved.id, '', pluginContext)
        newLines.push('')
        newLines.push(atlasContent)
      }
      else {
        newLines.push(await parseAsset(resolved.id))
      }
    }

    const parseLocalBlock = async (importer: string) => {
      // skip [locale block]
      newLines.push(lines[index++])
      while (index < lines.length) {
        const langLine = lines[index]
        if (langLine.includes('[/locale block]'))
          break
        const [lang, assetPath] = langLine.split(' ')
        const resolved = await pluginContext.resolve(ensureRelativePath(assetPath), importer, { skipSelf: true })
        if (resolved)
          newLines.push(`${lang} ${await parseAsset(resolved.id)}`)
        index++
      }
      // skip [/locale block]
      newLines.push(lines[index++])
    }

    while (index < lines.length) {
      const line = lines[index]

      if (line.includes('[locale block]')) {
        await parseLocalBlock(id)
      }
      else if (/\.(png|jpe?g|atlas)$/.test(line)) {
        localeReg.test(line)
          ? await parseLocaleLine(id)
          : await parseNormalLine(id)
      }
      else {
        newLines.push(line)
        index++
      }
    }

    return newLines.join('\n')
  }

  return {
    name: 'vite-plugin-spine',
    enforce: 'pre',

    configResolved(_config) {
      config = _config
    },

    async resolveId(id, importer) {
      if (!spineReg.test(id))
        return

      if (config.command === 'serve')
        return this.resolve(id.replace(spineReg, '$1url$2'), importer, { skipSelf: true })

      if (path.extname(cleanUrl(id)) === '.spine')
        return id
      const resolved = await this.resolve(id, importer, { skipSelf: true })
      if (resolved) {
        // 更换后缀名，避免其它插件处理这个文件
        return replaceExtname(resolved.id, '.spine')
      }
    },

    async load(id) {
      if (!spineReg.test(id))
        return

      const jsonId = replaceExtname(cleanUrl(normalizePath(id)), '.json')
      const atlasId = replaceExtname(jsonId, '.atlas')
      this.addWatchFile(jsonId)
      this.addWatchFile(atlasId)

      const jsonSource = await fsp.readFile(jsonId)
      const atlasSource = await loadAtlas(atlasId, '', this)

      // 由于 pixi-spine 将 json 作为入口加载动画相关的文件时，会加载与 json 同名的 atlas 文件，且无法从 json 中改变这个行为
      // 因此将 json 和 atlas 内容 hash 合并，以确保它们的文件名一致
      const jsonFileName = generateAssetFileName(path.basename(jsonId), `${jsonSource}${atlasSource}`, config)

      // emit json
      const referenceId = this.emitFile({
        type: 'asset',
        source: jsonSource,
        fileName: jsonFileName,
      })

      // emit atlas
      this.emitFile({
        type: 'asset',
        source: atlasSource,
        fileName: replaceExtname(jsonFileName, '.atlas'),
      })

      referenceIds.add(referenceId)

      return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`
    },

    resolveFileUrl({ fileName, referenceId, format, relativePath }) {
      if (!referenceIds.has(referenceId))
        return

      return resolveFileUrl({
        format,
        relativePath,
        fileName,
        query: '?spine',
      })
    },
  }
}
