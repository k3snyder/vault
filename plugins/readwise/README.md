# Readwise Plugin for Vault

Sync your Readwise highlights, notes, and articles directly to your Vault.

## Features

- 📚 **Full Sync**: Import all your highlights from books, articles, and supplemental content
- 🔄 **Automatic Sync**: Set up periodic syncing at custom intervals
- 📁 **Smart Organization**: Group highlights by book, article type, category, or date
- ✏️ **Custom Templates**: Use Mustache templates to format your highlights
- 🔐 **Secure**: API tokens stored securely using Tauri's keychain integration
- ⚡ **Incremental Updates**: Only sync new highlights since last sync
- 🎯 **Selective Sync**: Choose specific books or articles to sync

## Installation

1. Install the plugin from Vault's plugin marketplace
2. Enable the plugin in Settings → Plugins
3. Configure your Readwise API token

## Setup

### Getting Your API Token

1. Go to [readwise.io/access_token](https://readwise.io/access_token)
2. Copy your access token
3. Open Vault Settings → Readwise
4. Paste your token and click "Test Connection"

### Configuration Options

- **Sync Frequency**: How often to automatically sync (5-1440 minutes)
- **Highlights Folder**: Where to save your highlights
- **Group By**: Organize by book, article type, category, or date
- **Date Format**: Customize date formatting
- **Append Mode**: Add new highlights to existing files
- **Custom Templates**: Create your own highlight format

## Commands

- `Sync all Readwise highlights` - Full sync of all highlights
- `Sync new highlights only` - Incremental sync since last update
- `Sync specific book/article` - Choose what to sync
- `Open Readwise settings` - Configure the plugin
- `Export reading statistics` - Generate reading stats

## Template Variables

When creating custom templates, you can use these variables:

- `{{title}}` - Book/article title
- `{{author}}` - Author name
- `{{category}}` - Content category
- `{{url}}` - Source URL
- `{{highlights}}` - Array of highlights
- `{{syncDate}}` - Current sync date
- `{{highlightCount}}` - Number of highlights

## Permissions

This plugin requires the following permissions:
- `vault.read/write` - Save highlights to your vault
- `network.fetch` - Connect to Readwise API
- `settings.store` - Save plugin settings

## Support

- Report issues: [GitHub Issues](https://github.com/vault-app/readwise-plugin)
- Documentation: [Wiki](https://github.com/vault-app/readwise-plugin/wiki)

## License

MIT