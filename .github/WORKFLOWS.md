# GitHub Workflows

This directory contains GitHub Actions workflows for building and testing the gpio-fan-rpm package.

## 📋 Available Workflows

### Release Build (`release-build.yml`) ⭐ **PRODUCTION**

The main production workflow for creating releases with built packages for both OpenWRT versions.

**Features:**
- **Automatic Release Creation**: Creates GitHub releases with built packages
- **Dual Version Support**: Builds for both OpenWRT 23.05 and 24.10
- **Cross-Compilation**: Uses x86_64 architecture for universal compatibility
- **Version Verification**: Ensures Makefile version matches git tag
- **Release Assets**: Includes both packages and installation instructions
- **Tag-Based Triggers**: Automatically runs on version tags (v1.0.0, v1.0.1, etc.)

**Usage:**
```bash
# Use the proper release process
./scripts/update-version.sh 1.0.0
git push origin v1.0.0  # Triggers automatic release
```

### Build Test (`build-test.yml`) 🧪 **DEVELOPMENT TESTING**

A build testing workflow for development validation. Tests package compilation without creating releases.

**Features:**
- **Flexible Version Testing**: Test one or both OpenWRT versions
- **Optional Verbose Output**: Toggle detailed build logs
- **Quick Feedback**: Fast execution for development iteration
- **No Release Creation**: Pure build testing only
- **Short Retention**: Artifacts kept for 7 days only

**Usage:**
```bash
# Go to Actions → Build Test → Run workflow
# Choose OpenWRT version: 23.05, 24.10, or both
# Toggle verbose output if needed
```



## 🚀 Release Workflow Guide

### Prerequisites

- GitHub repository with Actions enabled
- Write access to create releases
- Version update script (`scripts/update-version.sh`)

### Release Process

#### 1. Update Version and Create Release

```bash
# Update version, changelog, and create git tag
./scripts/update-version.sh 1.0.0 --message "Release version 1.0.0"

# Push changes and tag to trigger release workflow
git push origin main
git push origin v1.0.0
```

#### 2. Automated Build Process

When you push a version tag (e.g., `v1.0.0`), the workflow automatically:

1. **Extracts version** from the tag
2. **Updates Makefile** with the new version
3. **Builds OpenWRT 23.05 package** (libgpiod v1)
4. **Builds OpenWRT 24.10 package** (libgpiod v2)
5. **Creates GitHub release** with both packages
6. **Uploads release assets** with installation instructions

#### 3. Release Process

The workflow automatically:

1. **Extracts version** from the git tag
2. **Verifies** that Makefile version matches the tag
3. **Builds packages** for both OpenWRT versions
4. **Creates GitHub release** with both packages
5. **Uploads release assets** with installation instructions

**Note**: Manual workflow dispatch is not available. Use the proper release process with `update-version.sh`.

#### 4. Development Testing

For testing builds without releases:

1. Go to **Actions** → **Build Test**
2. Click **Run workflow**
3. Choose OpenWRT version: 23.05, 24.10, or both
4. Toggle verbose output if needed
5. Click **Run workflow**

### Release Output

Each release includes:

#### Packages
- `gpio-fan-rpm_1.0.0-r1_all.ipk` (OpenWRT 23.05)
- `gpio-fan-rpm_1.0.0-r1_all.ipk` (OpenWRT 24.10)

#### Documentation
- Installation instructions
- Usage examples
- Compatibility information

### Compatibility Matrix

| OpenWRT Version | libgpiod Version | Package Name |
|----------------|------------------|--------------|
| 23.05 | v1 | `gpio-fan-rpm_<version>-r1_all.ipk` |
| 24.10 | v2 | `gpio-fan-rpm_<version>-r1_all.ipk` |

### Installation Commands

```bash
# For OpenWRT 23.05
opkg install gpio-fan-rpm_1.0.0-r1_all.ipk

# For OpenWRT 24.10
opkg install gpio-fan-rpm_1.0.0-r1_all.ipk
```

### Workflow Features

#### Cross-Compilation
- Uses x86_64 architecture for universal compatibility
- Single build per OpenWRT version
- Optimized for speed and reliability

#### Version Management
- Verifies `PKG_VERSION` in Makefile matches git tag
- Extracts version from git tags
- Ensures proper release process is followed

#### Quality Assurance
- Builds both OpenWRT versions
- Tests libgpiod v1 and v2 compatibility
- Validates package generation
- Comprehensive error handling

#### Release Process
- **Version Verification**: Ensures Makefile matches git tag
- **Automatic Builds**: Creates packages for both OpenWRT versions
- **Release Creation**: Automatically creates GitHub releases

### Development Workflow

1. **Develop** → Make code changes
2. **Test** → Use quick build workflows for testing
3. **Version** → Use version update script
4. **Release** → Push tag to trigger automated release

### Troubleshooting

#### Build Failures
- Check the workflow logs for specific error messages
- Verify that all dependencies are properly declared
- Ensure the package structure follows OpenWRT conventions

#### Release Issues
- Verify GitHub token permissions
- Check that the tag doesn't already exist
- Ensure the repository has release permissions

#### Version Conflicts
- Use the version update script to ensure consistency
- Check that the version format follows semantic versioning
- Verify that the Makefile version is updated correctly

### Best Practices

1. **Use semantic versioning** (e.g., 1.0.0, 1.0.1, 1.1.0)
2. **Update changelog** before releasing
3. **Test locally** before creating releases
4. **Review release notes** before publishing
5. **Monitor build logs** for any issues

### Related Files

- `.github/workflows/release-build.yml` - Main release workflow
- `.github/workflows/build-test.yml` - Development testing workflow
- `scripts/update-version.sh` - Version update script
- `Makefile` - Package build configuration
- `CHANGELOG.md` - Release history and changes

## 📊 Workflow Comparison

| Workflow | Purpose | Speed | Scope | Output | Analysis |
|----------|---------|-------|-------|--------|----------|
| **Release Build** | Production releases | Medium | Both versions | GitHub release + packages | Full release process |
| **Build Test** | Development testing | Fast | Flexible (1 or 2 versions) | Build artifacts | Basic validation |

## 🎯 Usage Examples

**For Development:**
```bash
# Test one or both versions
Actions → Build Test → Choose version(s) → Run
```

**For Release Testing:**
```bash
# Test the build process with development workflow
Actions → Build Test → Choose version → Run
```

**For Production Release:**
```bash
# Create actual release
./scripts/update-version.sh 1.0.0
git push origin v1.0.0  # Triggers automatic release
```

## 🔧 Workflow Development

### Adding New Workflows

1. Create a new `.yml` file in `.github/workflows/`
2. Follow the existing workflow structure
3. Add appropriate documentation
4. Test with manual triggers first

### Modifying Existing Workflows

1. Update the workflow file
2. Test changes with manual triggers
3. Update this README if needed
4. Consider backward compatibility

### Best Practices

- **Manual Triggers**: Use `workflow_dispatch` for testing workflows
- **Matrix Builds**: Leverage GitHub's matrix strategy for multiple combinations
- **Artifact Management**: Upload and retain build artifacts appropriately
- **Error Handling**: Provide clear error messages and failure information
- **Documentation**: Keep this README updated with workflow changes 