# msgaming-vite-plugins

> [!NOTE]
> 此项目仅为展示的 DEMO，由于其中可能还存在没有完善的地方（且目前不会更新），所以请不要直接使用在生产环境中！

## `r()` 宏

在平时的开发中，如果需要导入一个图片资源，我们可能会这样写：

```ts
import a from 'a.png'
```

`r()` 可以提供“匿名”导入的功能，这在你需要导入大量资源但不关心资源名称时会非常有用，可以省略定义大量变量的麻烦，例如：

```ts
const res = [r('a.png'), r('b.png')]
```

同时，`r()` 还可以处理多语言资源的路径，例如：

```ts
// 在中文环境下，会导入 ./zh_CN/a.png
// 在英文环境下，会导入 ./en_US/a.png
// ...
r('./[locale]/a.png')
```

`r()` 在处理多语言资源时，还可以提供一些参数：

+ `--rollback`：如果在某个语言环境下但没有提供该语言环境的资源，则使用该参数指定的语言环境的资源，例如：`r('./[locale --rollback en_US]/a.png')`

## 导入 sprite 资源

通常一个 sprite 资源由一个 JSON 文件和一张 PNG 图片组成，在 PIXI 开发中，可以通过以下方式加载：

```ts
import a from './a.json'

PIXI.Assets.load(a).then()
```

但此种做法在 vite 项目中，vite 只会将 JSON 文件构建，而不知这个 sprite 资源的 PNG 文件的存在。为了解决这个问题，我们可以使用 `sprite()` 插件

```ts
// vite.config.ts

export default defineConfig({
  plugins: [
    sprite()
  ]
})
```

该插件会将 sprite 资源的 PNG 文件一并构建，同时还会将 JSON 文件中的路径替换为构建后的路径。