import MagicString from 'magic-string'
import type { Plugin } from 'vite'
import type { Program } from 'acorn'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { getHash } from './utils'
import { LANGUAGES, localeReg, parseLocaleArgs } from './locale'

function isI18nDeclaredInScope(ast: Program) {
  let declared = false

  // 校验顶层作用域下是否有 i18n 变量
  ast.body.forEach((node) => {
    if (node.type === 'ImportDeclaration' && node.specifiers.some(specifier => specifier.local.name === 'i18n'))
      declared = true

    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        if (declaration.id.type === 'Identifier' && declaration.id.name === 'i18n') {
          declared = true
          break
        }
        else if (declaration.id.type === 'ObjectPattern' && declaration.id.properties.some(property => property.type === 'Property' && property.key.type === 'Identifier' && property.key.name === 'i18n')) {
          declared = true
          break
        }
      }
    }
  })

  return declared
}

export function r(): Plugin {
  return {
    name: 'vite-plugin-macros-r',

    async transform(code, id) {
      if (!/\.m?[tj]s$/.test(id))
        return

      // 仅解析 @msgaming/* 包内的文件，其它 node_modules 包不处理
      if (/node_modules/.test(id) && !/node_modules\/@msgaming\//.test(id))
        return

      const list: Array<{
        start: number
        end: number
        content: string
        i18nIdentifier?: string
      }> = []
      const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' })

      simple(ast, {
        CallExpression(node) {
          if (node.callee.type === 'Identifier' && node.callee.name === 'r') {
            if (node.arguments[0].type !== 'Literal')
              return

            list.push({
              start: node.start!,
              end: node.end!,
              content: (node.arguments[0]).value as string,
              i18nIdentifier: node.arguments[1]?.type === 'Identifier' ? node.arguments[1].name : undefined,
            })
          }
        },
      })

      if (!list.length)
        return null

      let needImportI18n = false
      const s = new MagicString(code)
      const imports: string[] = []
      const k = getHash(id)
      let i = 0
      const generateImportKey = () => `r_${k}_${i++}`

      for (let { start, end, content, i18nIdentifier } of list) {
        if (localeReg.test(content)) {
          const objectProps: string[] = []
          let rollbackLanguage: string | null = null
          let rollbackImportKey: string | null = null
          let rollbackId: string | null = null

          const resolveLanguage = async (language: string) => {
            const resolved = await this.resolve(content.replace(localeReg, language), id, { skipSelf: true })
            if (!resolved)
              return null
            const importKey = generateImportKey()
            return {
              id: resolved.id,
              importKey,
            }
          }

          const localeArgs = parseLocaleArgs(content)

          if (typeof localeArgs.rollback !== 'undefined') {
            if (!LANGUAGES.includes(localeArgs.rollback))
              this.error(`invalid rollback language: ${localeArgs.rollback}`)
            const resolved = await resolveLanguage(localeArgs.rollback)
            if (!resolved)
              this.error(`rollback resource not found: ${content}`)
            rollbackLanguage = localeArgs.rollback
            rollbackImportKey = resolved!.importKey
            rollbackId = resolved!.id

            imports.push(`import ${rollbackImportKey} from '${rollbackId}'`)
          }

          for (const language of LANGUAGES) {
            if (language === rollbackLanguage) {
              objectProps.push(`${JSON.stringify(rollbackLanguage)}: ${rollbackImportKey}`)
              continue
            }
            const resolved = await resolveLanguage(language)

            if (!resolved) {
              if (rollbackImportKey)
                objectProps.push(`${JSON.stringify(language)}: ${rollbackImportKey}`)
              continue
            }

            imports.push(`import ${resolved.importKey} from '${resolved.id}'`)
            objectProps.push(`${JSON.stringify(language)}: ${resolved.importKey}`)
          }

          if (!i18nIdentifier) {
            i18nIdentifier = 'i18n'
            needImportI18n = true
          }
          s.overwrite(start, end, `${i18nIdentifier}.tp({${objectProps.join(', ')}})`)
        }
        else {
          const importKey = generateImportKey()
          imports.push(`import ${importKey} from '${content}'`)
          s.overwrite(start, end, importKey)
        }
      }

      if (needImportI18n && !isI18nDeclaredInScope(ast))
        imports.unshift(`import { i18n } from '@msgaming/spinx'`)

      s.prepend(`${imports.join('\n')}\n`)

      return {
        code: s.toString(),
        map: s.generateMap(),
      }
    },
  }
}
