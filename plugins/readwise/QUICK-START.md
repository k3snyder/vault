# Readwise Plugin - Quick Start Guide

Get your Readwise highlights into Vault in under 3 minutes!

## 🚀 Setup in 4 Steps

### 1️⃣ Install Plugin
- Open Vault Settings → Plugins → Browse
- Search "Readwise" → Install → Enable

### 2️⃣ Get Your API Token
- Go to: [readwise.io/access_token](https://readwise.io/access_token)
- Sign in and copy your token

### 3️⃣ Configure
- Settings → Readwise
- Paste your API token
- Click "Test Connection" ✓

### 4️⃣ Sync!
- Press `Cmd/Ctrl + Shift + R`
- Your highlights appear in `/Readwise` folder

---

## ⚙️ Essential Settings

### Auto-Sync (Recommended)
```
☑️ Enable automatic sync
⏱️ Sync frequency: 60 minutes
☑️ Sync on startup
```

### Organization
```
📁 Highlights folder: Readwise
🗂️ Group by: Book/Article
📝 Append to existing: Yes
```

---

## ⌨️ Key Commands

| Action | Shortcut |
|--------|----------|
| **Sync all highlights** | `Cmd/Ctrl + Shift + R` |
| **Sync new only** | Open command palette → "Sync new" |
| **Open settings** | Click Readwise in status bar |

---

## 📁 File Structure

Your highlights will be organized like this:

```
Readwise/
├── Books/
│   ├── Atomic Habits.md
│   ├── Deep Work.md
│   └── The Almanack of Naval.md
├── Articles/
│   ├── How to Take Smart Notes.md
│   └── The Ultimate Guide to Writing.md
└── Tweets/
    └── Interesting Threads.md
```

Each file contains:
- 📚 Book metadata (title, author, tags)
- 🔖 All your highlights with locations
- 💭 Your personal notes
- 📅 Sync timestamps

---

## 🎯 Pro Tips

### For Power Users
1. **Custom Templates**: Create your own format in Settings → Custom Template
2. **Keyboard Warrior**: Assign custom hotkeys in Settings → Hotkeys
3. **Tag Filtering**: Use Readwise tags to control what syncs

### For Large Libraries
1. **First Sync**: Run during a break (can take 5-10 min for 1000+ highlights)
2. **Use Incremental**: After initial sync, use "Sync new only"
3. **Batch Size**: Large libraries process in batches automatically

### For Organization
1. **Smart Folders**: Use "Group by Category" for topic-based organization
2. **Date-Based**: Use "Group by Date" for chronological reading log
3. **Custom Path**: Change folder to integrate with existing structure

---

## ❓ Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| **"Invalid token"** | Get fresh token from readwise.io/access_token |
| **"No highlights"** | Check Readwise dashboard has content |
| **"Rate limited"** | Wait 2 minutes, reduce sync frequency |
| **Missing highlights** | Disable "supplementals" filter |
| **Sync stuck** | Restart Vault, check console |

---

## 🔗 Quick Links

- 📖 [Full User Guide](./USER-GUIDE.md)
- 🐛 [Report Issues](https://github.com/vault-app/readwise-plugin/issues)
- 💡 [Feature Requests](https://github.com/vault-app/readwise-plugin/discussions)
- 🔑 [Get API Token](https://readwise.io/access_token)

---

**Need help?** Check the [full guide](./USER-GUIDE.md) or ask in [Vault Forums](https://forum.vault.app)

*Happy reading! 📚*