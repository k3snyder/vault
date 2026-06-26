# Readwise Plugin User Guide

A complete guide to setting up and using the Readwise plugin for Vault.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Installation](#installation)
3. [Initial Setup](#initial-setup)
4. [Basic Usage](#basic-usage)
5. [Configuration Options](#configuration-options)
6. [Advanced Features](#advanced-features)
7. [Troubleshooting](#troubleshooting)
8. [FAQ](#faq)

---

## Quick Start

Get up and running in 3 minutes:

1. **Install the plugin** from Vault's plugin marketplace
2. **Get your API token** from [readwise.io/access_token](https://readwise.io/access_token)
3. **Configure the plugin** in Settings → Readwise
4. **Run your first sync** with `Cmd/Ctrl + Shift + R`

Your highlights will appear in the `Readwise` folder in your vault!

---

## Installation

### From Plugin Marketplace (Recommended)

1. Open Vault Settings (`Cmd/Ctrl + ,`)
2. Navigate to **Plugins** → **Browse**
3. Search for "Readwise"
4. Click **Install** → **Enable**

### Manual Installation

1. Download the latest release from [GitHub](https://github.com/vault-app/readwise-plugin)
2. Extract to your vault's `.vault/plugins/readwise/` folder
3. Enable the plugin in Settings → Plugins

### System Requirements

- Vault version 1.0.0 or higher
- Active internet connection
- Readwise account (free or premium)

---

## Initial Setup

### Step 1: Get Your Readwise API Token

1. Visit [readwise.io/access_token](https://readwise.io/access_token)
2. Sign in to your Readwise account
3. Copy your access token
4. Keep this page open - you'll need the token shortly

> **Security Note**: Your API token is stored securely in Vault's encrypted keychain. Never share this token with others.

### Step 2: Configure the Plugin

1. Open Vault Settings (`Cmd/Ctrl + ,`)
2. Navigate to **Readwise** in the sidebar
3. Paste your API token in the **API Token** field
4. Click **Test Connection** to verify
5. You should see "✓ Connection successful"

### Step 3: Choose Your Settings

#### Basic Settings

- **Highlights Folder**: Where to save your highlights (default: `Readwise`)
- **Auto Sync**: Enable automatic background syncing
- **Sync Frequency**: How often to sync (5-1440 minutes)

#### Organization

Choose how to organize your highlights:

- **By Book/Article** (default): One file per source
- **By Type**: Separate folders for books vs articles
- **By Category**: Organize by Readwise categories
- **By Date**: Monthly folders (YYYY/MM format)

### Step 4: First Sync

Run your first sync using any of these methods:

- **Keyboard shortcut**: `Cmd/Ctrl + Shift + R`
- **Command palette**: Type "Sync Readwise highlights"
- **Status bar**: Click the Readwise icon

---

## Basic Usage

### Manual Sync

#### Sync All Highlights
Syncs your entire Readwise library:
- Command: `Sync all Readwise highlights`
- Shortcut: `Cmd/Ctrl + Shift + R`

#### Sync New Only
Syncs only highlights added since last sync:
- Command: `Sync new highlights only`
- Faster for regular updates

#### Sync Specific Book
Choose a specific book or article to sync:
- Command: `Sync specific book/article`
- Useful for selective updates

### Automatic Sync

Enable background syncing for hands-free operation:

1. Toggle **Enable automatic sync** in settings
2. Set **Sync Frequency** (recommended: 60 minutes)
3. Optional: Enable **Sync on startup**

The plugin will sync quietly in the background and notify you of new highlights.

### Understanding Your Files

Each synced file contains:

```markdown
---
title: Book Title
author: Author Name
category: books
date: 2025-01-08
highlights: 42
---

# Book Title

Author: Author Name
Category: books

## Highlights

### Location 123
> Your highlighted text appears here

**Note:** Any notes you added in Readwise

---
```

---

## Configuration Options

### Sync Settings

| Setting | Description | Default | Options |
|---------|------------|---------|---------|
| **API Token** | Your Readwise authentication token | - | Required |
| **Auto Sync** | Enable automatic background syncing | Off | On/Off |
| **Sync Frequency** | How often to sync (minutes) | 60 | 5-1440 |
| **Sync on Startup** | Sync when Vault starts | Off | On/Off |

### File Organization

| Setting | Description | Default | Options |
|---------|------------|---------|---------|
| **Highlights Folder** | Base folder for highlights | Readwise | Any folder |
| **Group By** | How to organize files | book | book, article, category, date |
| **Date Format** | Format for dates | YYYY-MM-DD | Custom format |
| **Append to Existing** | Add new highlights to existing files | On | On/Off |

### Content Options

| Setting | Description | Default | Options |
|---------|------------|---------|---------|
| **Include Supplementals** | Include Readwise's supplemental content | On | On/Off |
| **Custom Template** | Custom Mustache template | - | See [Templates](#custom-templates) |

---

## Advanced Features

### Custom Templates

Create your own highlight format using Mustache templates:

```mustache
# {{title}}
{{#author}}By {{author}}{{/author}}

{{#highlights}}
## {{#location}}[{{location}}]{{/location}} {{text}}
{{#note}}
> 💭 {{note}}
{{/note}}
{{/highlights}}
```

#### Available Variables

- `{{title}}` - Book/article title
- `{{author}}` - Author name
- `{{category}}` - Content category
- `{{source}}` - Source platform (Kindle, Instapaper, etc.)
- `{{url}}` - Source URL
- `{{highlights}}` - Array of highlights
  - `{{text}}` - Highlighted text
  - `{{note}}` - Your note
  - `{{location}}` - Location/page
  - `{{date}}` - Highlight date
  - `{{tags}}` - Associated tags

### Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|--------------|-----|
| Sync all | `Ctrl+Shift+R` | `Cmd+Shift+R` |
| Open settings | `Ctrl+Shift+,` | `Cmd+Shift+,` |

### Status Bar

The Readwise icon in your status bar shows:
- **Last sync time** when hovering
- **Click** to trigger manual sync
- **Color indicators**:
  - Gray: Never synced
  - Blue: Syncing
  - Green: Recently synced
  - Yellow: Sync needed

### Filtering & Exclusions

#### Exclude Specific Books

Add tags in Readwise to exclude books:
1. Tag books with `vault-exclude` in Readwise
2. Those books won't sync

#### Filter by Tag

Sync only specific tagged content:
1. Tag content with `vault-sync` in Readwise
2. Enable tag filtering in settings

---

## Troubleshooting

### Common Issues

#### "Invalid API Token"
- **Solution**: Get a new token from [readwise.io/access_token](https://readwise.io/access_token)
- Ensure you copied the entire token
- Try the **Test Connection** button

#### "No highlights to sync"
- **Check**: Do you have highlights in Readwise?
- **Try**: Use "Sync all highlights" instead of "Sync new only"
- **Verify**: Your Readwise account is active

#### "Rate limited"
- **Cause**: Too many API requests
- **Solution**: Wait 2 minutes and try again
- **Prevention**: Reduce sync frequency in settings

#### Files not appearing
- **Check**: Look in the configured highlights folder
- **Verify**: Sync completed successfully (check status bar)
- **Try**: Disable "Append to existing" to create fresh files

### Sync Conflicts

If you edit highlight files manually:

1. **Backup your changes** before syncing
2. **Choose conflict resolution** in settings:
   - "Local first": Keep your edits
   - "Remote first": Overwrite with Readwise
   - "Ask": Prompt for each conflict

### Performance Issues

For large libraries (1000+ highlights):

1. **Initial sync**: May take 5-10 minutes
2. **Enable batching**: Processes in smaller chunks
3. **Increase sync interval**: Reduce frequency to every 2-3 hours
4. **Use incremental sync**: "Sync new only" for regular updates

### Debug Mode

Enable detailed logging:

1. Open Developer Console (`Cmd/Ctrl + Shift + I`)
2. Run command: `Enable Readwise debug mode`
3. Check console for detailed sync information
4. Disable when done: `Disable Readwise debug mode`

---

## FAQ

### General Questions

**Q: Is my Readwise data stored locally?**
A: Yes, all highlights are saved as markdown files in your vault. The plugin only stores your API token (encrypted) and sync metadata.

**Q: Can I edit the generated files?**
A: Yes! Files are standard markdown. Enable "Append to existing" to preserve your edits during syncs.

**Q: Does this work with Readwise Reader?**
A: Yes, Reader highlights sync just like regular Readwise highlights.

**Q: What happens to deleted highlights?**
A: Currently, deleted highlights remain in your vault. Manual cleanup may be needed.

### Sync Questions

**Q: How often should I sync?**
A: Recommended settings:
- Heavy readers: Every 30-60 minutes
- Moderate readers: Every 2-3 hours  
- Light readers: Once daily

**Q: Can I sync multiple Readwise accounts?**
A: Not directly. You'd need separate vaults or manual token switching.

**Q: Why are some highlights missing?**
A: Check if:
- Highlights are marked as "discarded" in Readwise
- Supplemental highlights are disabled in settings
- The source has exporting restrictions

### Technical Questions

**Q: What permissions does the plugin need?**
A: 
- `vault.read/write`: Save highlights to your vault
- `network.fetch`: Connect to Readwise API
- `settings.store`: Save your preferences

**Q: Is my API token secure?**
A: Yes, stored in Vault's encrypted keychain using Tauri's secure storage.

**Q: Can I use custom CSS for highlights?**
A: Yes! Target these classes:
- `.readwise-highlight`: Individual highlights
- `.readwise-note`: User notes
- `.readwise-metadata`: Frontmatter section

### Troubleshooting Questions

**Q: Sync is stuck - what do I do?**
A: 
1. Click status bar icon to check status
2. Restart Vault if needed
3. Check Developer Console for errors
4. Disable/re-enable the plugin

**Q: How do I completely reset the plugin?**
A:
1. Disable plugin in settings
2. Delete `.vault/plugins/readwise/data/`
3. Re-enable and reconfigure

**Q: Where are logs stored?**
A: Check `.vault/plugins/readwise/logs/` for sync history and errors.

---

## Support & Resources

### Getting Help

- **Documentation**: [GitHub Wiki](https://github.com/vault-app/readwise-plugin/wiki)
- **Issues**: [GitHub Issues](https://github.com/vault-app/readwise-plugin/issues)
- **Community**: [Vault Forum](https://forum.vault.app/c/plugins)
- **Email**: support@vault.app

### Useful Links

- [Readwise Dashboard](https://readwise.io/dashboard)
- [Readwise API Documentation](https://readwise.io/api_deets)
- [Vault Plugin Development](https://docs.vault.app/plugins)
- [Mustache Template Syntax](https://mustache.github.io/)

### Contributing

We welcome contributions! See our [Contributing Guide](https://github.com/vault-app/readwise-plugin/blob/main/CONTRIBUTING.md) for:
- Bug reports
- Feature requests
- Pull requests
- Translation help

### Privacy & Security

- **Local first**: All data stored in your vault
- **Encrypted storage**: API tokens in secure keychain
- **No analytics**: Zero tracking or telemetry
- **Open source**: Full code transparency

---

## Changelog

### Version 1.0.0 (2025-01-08)
- Initial release
- Full Readwise API integration
- Automatic and manual sync
- Custom templates
- Background sync
- Conflict resolution

---

## License

MIT - See [LICENSE](https://github.com/vault-app/readwise-plugin/blob/main/LICENSE)

---

*Made with ❤️ for the Vault community*