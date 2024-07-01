export interface ExternalModule {
  module: string | RegExp
  global: string
  path: string
}

export interface ExternalLibModule {
  module: string
  global?: string
  path: string
  style?: boolean
}

export const VENDOR_EXTERNALS: ExternalModule[] = [
  { module: 'vue', global: 'Vue', path: 'libs/vue/3.4.21/vue.global.prod.min.js' },
]


export const COMMON_LIBS: ExternalLibModule[] = []

const modules = [VENDOR_EXTERNALS, COMMON_LIBS].flat()

export const externals = modules.map(i => i.module)

export const isLibStyle = (name: string) => (modules.find(i => i.module === name) as ExternalLibModule)?.style ?? false

export function getGlobal(name: string) {
  return modules.find(
    i => typeof i.module === 'string'
      ? i.module === name
      : i.module.test(name),
  )?.global ?? ''
}
