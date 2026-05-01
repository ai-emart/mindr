# Releasing Mindr

## Adding NPM_TOKEN to GitHub Secrets

To publish packages to npm, you need to add your npm authentication token to GitHub Secrets:

1. Go to https://www.npmjs.com/settings/tokens
2. Create a new automation token with read and write permissions
3. Copy the token
4. Go to your GitHub repository Settings → Secrets and variables → Actions
5. Click "New repository secret"
6. Name it `NPM_TOKEN` and paste the token value
7. Click "Add secret"

## Tagging a Release

When you're ready to release a new version:

1. Update version numbers in:
   - `packages/cli/package.json`
   - `packages/sdk/package.json`
   - `packages/cli/src/index.ts` (VERSION constant)

2. Commit the version changes:
   ```bash
   git add packages/cli/package.json packages/sdk/package.json packages/cli/src/index.ts
   git commit -m "Release v1.0.0"
   ```

3. Create and push the tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

## What the Release Workflow Does Automatically

When you push a version tag (e.g., `v1.0.0`), the `.github/workflows/release.yml` workflow automatically:

1. **Runs full test suite** on all three OS platforms (Ubuntu, macOS, Windows)
2. **Publishes CLI package** to npm (`mindr`)
3. **Publishes SDK package** to npm (`@ai-emart/mindr`)
4. **Creates a GitHub Release** with auto-generated release notes

The release is only created if all tests pass on all platforms.

## Post-Release Checklist

After the release is complete:

- [ ] Verify packages are published on npm
- [ ] Verify GitHub Release is created with notes
- [ ] Update CHANGELOG.md (if applicable)
- [ ] Announce the release (Discord, Twitter, etc.)
