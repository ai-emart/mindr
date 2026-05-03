const path = require('node:path');

const siteDir = __dirname;

// Docusaurus emits `require.resolveWeak(...)` calls in the server bundle that
// are evaluated by Node's outer `require`, not Webpack's runtime require.
// Build an alias map from Webpack's module graph and rewrite them to module IDs.
function requireResolveWeakFix() {
  const jsString = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
  const jsRequireCall = new RegExp(String.raw`require\((` + jsString + String.raw`)\)`, 'g');
  const jsResolveWeakCall = new RegExp(
    String.raw`require\.resolveWeak\((` + jsString + String.raw`)\)`,
    'g',
  );

  function unquoteJsString(value) {
    return JSON.parse(value.replace(/^'/, '"').replace(/'$/, '"'));
  }

  function toPosix(value) {
    return value.split(path.sep).join('/');
  }

  function aliasForResource(resource) {
    if (!resource) return undefined;
    const normalized = toPosix(resource);
    const normalizedSiteDir = toPosix(siteDir);
    const docsPrefix = `${normalizedSiteDir}/docs/`;
    const generatedPrefix = `${normalizedSiteDir}/.docusaurus/`;
    const themePrefix = '/node_modules/@docusaurus/theme-classic/lib/theme/';

    if (normalized.startsWith(docsPrefix)) {
      return `@site/docs/${normalized.slice(docsPrefix.length)}`;
    }

    if (normalized.startsWith(generatedPrefix)) {
      return `@generated/${normalized.slice(generatedPrefix.length)}`;
    }

    const themeIndex = normalized.indexOf(themePrefix);
    if (themeIndex !== -1) {
      const themePath = normalized
        .slice(themeIndex + themePrefix.length)
        .replace(/\/index\.[cm]?js$/, '')
        .replace(/\.[cm]?js$/, '');
      return `@theme/${themePath}`;
    }

    return undefined;
  }

  return {
    name: 'require-resolve-weak-fix',
    configureWebpack(_config, isServer) {
      if (!isServer) return {};
      return {
        plugins: [
          {
            apply(compiler) {
              const { Compilation, sources } = compiler.webpack;
              compiler.hooks.thisCompilation.tap('RequireResolveWeakFix', (compilation) => {
                compilation.hooks.processAssets.tap(
                  {
                    name: 'RequireResolveWeakFix',
                    stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY,
                  },
                  (assets) => {
                    const moduleIds = new Map();
                    let fallbackModuleId;
                    for (const module of compilation.modules) {
                      const id = compilation.chunkGraph.getModuleId(module);
                      if (id === null || id === undefined) continue;
                      const encodedId = JSON.stringify(id);
                      fallbackModuleId ??= encodedId;
                      for (const key of [
                        module.rawRequest,
                        module.userRequest,
                        module.request,
                        module.resource,
                        aliasForResource(module.resource),
                      ]) {
                        if (key) moduleIds.set(key, encodedId);
                      }
                    }

                    const toModuleId = (match, requestLiteral) => {
                      const request = unquoteJsString(requestLiteral);
                      return moduleIds.get(request) ?? fallbackModuleId ?? match;
                    };

                    for (const [assetName, asset] of Object.entries(assets)) {
                      if (!assetName.endsWith('.js')) continue;
                      const source = asset.source().toString();
                      if (!source.includes('require')) {
                        continue;
                      }
                      compilation.updateAsset(
                        assetName,
                        new sources.RawSource(
                          source
                            .replace(jsResolveWeakCall, toModuleId)
                            .replace(/require\((['"])[^'"]+\.css\1\)/g, 'undefined')
                            .replace(
                              /require\((['"])[^'"]+@docusaurus[\\/]+theme-classic[\\/]+lib[\\/]+(?:prism-include-languages|nprogress)\1\)/g,
                              'undefined',
                            )
                            .replace(jsRequireCall, (match, requestLiteral) => {
                              const request = unquoteJsString(requestLiteral);
                              const moduleId = moduleIds.get(request);
                              return request.startsWith('@') && moduleId
                                ? `__webpack_require__(${moduleId})`
                                : match;
                            })
                        ),
                      );
                    }
                  },
                );
              });
            },
          },
        ],
      };
    },
  };
}

module.exports = {
  title: 'Mindr',
  url: 'https://ai-emart.github.io',
  baseUrl: '/mindr/',
  organizationName: 'ai-emart',
  projectName: 'mindr',
  presets: [['classic', { docs: { routeBasePath: '/', sidebarPath: './sidebars.js' }, blog: false }]],
  plugins: [requireResolveWeakFix],
}
