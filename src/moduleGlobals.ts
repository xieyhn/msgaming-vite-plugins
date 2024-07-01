import type { Plugin } from 'vite'
import MagicString from 'magic-string'
import type { Identifier, ImportSpecifier, Property } from 'acorn'
import { parse } from 'acorn'
import { ancestor } from 'acorn-walk'
import type { AttachedScope } from '@rollup/pluginutils'
import { attachScopes } from '@rollup/pluginutils'
import { getGlobal, isLibStyle } from './constants'

declare module 'acorn' {
  interface Node {
    scope?: AttachedScope
  }
}

const VUE_DEMI_MODULE = 'vue-demi'
// vue-demi 除了重导出的 vue 成员外，还导出了以下其他成员，以下成员不应该当做 Vue 全局变量处理
const VUE_DEMI_EXPORTS = ['Vue', 'Vue2', 'isVue2', 'isVue3', 'install']

function makeGlobalIdentifier(prop: string, global: string) {
  if (prop === 'default')
    return global

  return `${global}.${prop}`
}

/**
 * 在 rollup output format 是 es / systemjs 时，output.globals 不会生效（https://github.com/rollup/rollup/issues/2374），
 * 这个插件可以解决这个问题，但存在一些缺陷：
 *
 * 1. 不要在模块顶级作用域声明与 global 同名的变量名，这样会导致与 global 变量名冲突，例如
 *  ```ts
 *  // 在我们项目中，配置了 'pixi.js' -> PIXI， 'vue' -> Vue 则不要这样写
 *  const PIXI = 1
 *  const Vue = 2
 *  ```
 *
 */
export function moduleGlobals(): Plugin {
  return {
    name: 'vite-plugin-module-globals',
    enforce: 'post',
    apply: 'build',

    transform(code, id) {
      if (!/\.m?[tj]s|vue$/.test(id))
        return

      const s = new MagicString(code)
      const ast = parse(code, { sourceType: 'module', ecmaVersion: 'latest' })
      const scope = attachScopes(ast, 'scope')
      const bindings = new Map<string, string>()

      ast.body.forEach((node) => {
        // 将 global 模块导出直接移除，因为这个导出是是没有意义的，在任意模块都能直接使用全局变量
        if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
          if (node.source && getGlobal(node.source.value as string) !== '')
            s.overwrite(node.start, node.end, '')
        }
        else if (node.type === 'ImportDeclaration') {
          // 如果是库样式文件，直接移除，因为在 html 文件中会导入库的 css 文件
          if (isLibStyle(node.source.value as string)) {
            s.overwrite(node.start, node.end, '')
          }
          // 转换 global 模块导入
          else if (getGlobal(node.source.value as string) !== '') {
            node.specifiers.forEach((specifier) => {
              switch (specifier.type) {
                case 'ImportDefaultSpecifier':
                case 'ImportNamespaceSpecifier': {
                  bindings.set(specifier.local.name, getGlobal(node.source.value as string)!)
                  break
                }
                case 'ImportSpecifier': {
                  bindings.set(specifier.local.name, makeGlobalIdentifier((specifier.imported as Identifier).name, getGlobal(node.source.value as string)!))
                  break
                }
              }
            })
            s.overwrite(node.start, node.end, '')
          }
          // 在 @vueuse/core 中，内部使用了依赖 'vue-demi'，这个依赖中重导出的 vue 的所有成员，因此针对此模块做特殊处理，
          // 将 'vue-demi' 中导入的 vue 成员转换为 Vue 的全局变量，如 `import { createApp } from 'vue-demi'` -> `Vue.createApp`
          else if (node.source.value === VUE_DEMI_MODULE) {
            const props: string[] = []

            node.specifiers.forEach((specifier: ImportSpecifier) => {
              const imported = specifier.imported as Identifier
              const local = specifier.local

              if (VUE_DEMI_EXPORTS.includes(imported.name))
                props.push(`${imported.name} as ${local.name}`)
              else
                bindings.set(specifier.local.name, makeGlobalIdentifier(imported.name, 'Vue'))
            })

            if (props.length)
              s.overwrite(node.start, node.end, `import { ${props.join(', ')} } from '${VUE_DEMI_MODULE}'`)
            else
              s.overwrite(node.start, node.end, '')
          }
        }
      })

      ancestor(ast, {
        Identifier(node, state, ancestors) {
          if (bindings.has(node.name) && !(ancestors.find(ancestor => !!ancestor.scope)?.scope ?? scope).contains(node.name)) {
            const parent = ancestors[ancestors.length - 2]
            // 处理对象缩写的情况，如 `import { createApp } from 'vue'; console.log({ createApp })` -> `console.log({ createApp: Vue.createApp })`
            if (parent.type === 'Property' && (parent as Property).key.start === (parent as Property).value.start)
              s.appendLeft(node.end, `: ${bindings.get(node.name)}`)
            else
              s.overwrite(node.start, node.end, bindings.get(node.name)!)
          }
        },
      })

      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: s.generateMap(),
        }
      }
    },
  }
}
