// Docusaurus 3.10.x: @docusaurus/react-loadable injects require.resolveWeak
// calls via a webpack plugin after normal compilation, so webpack never runs
// its RequireResolveWeakDependency transformer on them. The runtime only
// defines __webpack_require__.rW but the injected code calls .resolveWeak.
// This plugin adds a RuntimeModule that aliases .resolveWeak → .rW.
function requireResolveWeakFix() {
  return {
    name: 'require-resolve-weak-fix',
    configureWebpack(_config, isServer) {
      if (!isServer) return {};
      return {
        plugins: [
          {
            apply(compiler) {
              const { RuntimeGlobals, RuntimeModule } = compiler.webpack;
              class ResolveWeakAlias extends RuntimeModule {
                constructor() { super('resolve-weak-alias'); }
                generate() {
                  // Use a getter so ordering vs RequireResolveWeakRuntimeModule
                  // doesn't matter — .rW is resolved lazily at call time.
                  return `Object.defineProperty(${RuntimeGlobals.require},"resolveWeak",{get:function(){return ${RuntimeGlobals.requireResolveWeak};},configurable:true});`;
                }
              }
              compiler.hooks.compilation.tap('ResolveWeakFix', (compilation) => {
                const seen = new WeakSet();
                compilation.hooks.runtimeRequirementInTree
                  .for(RuntimeGlobals.require)
                  .tap('ResolveWeakFix', (chunk, set) => {
                    if (seen.has(chunk)) return;
                    seen.add(chunk);
                    set.add(RuntimeGlobals.requireResolveWeak);
                    compilation.addRuntimeModule(chunk, new ResolveWeakAlias());
                  });
              });
            },
          },
        ],
      };
    },
  };
}

export default {
  title: 'Mindr',
  url: 'https://ai-emart.github.io',
  baseUrl: '/mindr/',
  organizationName: 'ai-emart',
  projectName: 'mindr',
  presets: [['classic', { docs: { routeBasePath: '/', sidebarPath: './sidebars.js' }, blog: false }]],
  plugins: [requireResolveWeakFix],
}
