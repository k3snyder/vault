# Readwise Plugin - Troubleshooting Guide

## 🔍 Diagnostic Checklist

Before troubleshooting, run through this checklist:

- [ ] Plugin is enabled in Settings → Plugins
- [ ] API token is configured in Settings → Readwise
- [ ] "Test Connection" shows success
- [ ] Internet connection is active
- [ ] Readwise account has highlights
- [ ] Vault has write permissions to highlights folder

---

## 🚨 Common Issues & Solutions

### Authentication Issues

#### ❌ "Invalid API Token"

**Symptoms:**
- Test connection fails
- Sync returns authentication error

**Solutions:**
1. Get a fresh token:
   ```
   1. Visit readwise.io/access_token
   2. Sign in to Readwise
   3. Copy the ENTIRE token (it's long!)
   4. Paste in Settings → Readwise → API Token
   5. Click "Test Connection"
   ```

2. Check for hidden characters:
   - Delete any spaces before/after token
   - Re-copy without selecting extra whitespace

3. Verify account status:
   - Ensure Readwise subscription is active
   - Check if API access is enabled for your account

#### 🔒 "Token not saving"

**Solutions:**
1. Check Vault permissions:
   ```bash
   # Make sure .vault folder is writable
   ls -la .vault/
   ```

2. Clear plugin data:
   ```
   1. Disable plugin
   2. Delete: .vault/plugins/readwise/data/
   3. Re-enable and reconfigure
   ```

---

### Sync Issues

#### ⏳ "Sync never completes"

**Symptoms:**
- Status bar shows "Syncing..." indefinitely
- No error messages appear

**Solutions:**
1. Check library size:
   ```
   Large libraries (1000+ highlights) can take 5-10 minutes
   Watch status bar for progress updates
   ```

2. Enable debug logging:
   ```javascript
   // Open Console (Cmd/Ctrl + Shift + I)
   vault.plugins.readwise.enableDebug()
   ```

3. Interrupt and retry:
   ```
   1. Restart Vault
   2. Try "Sync new only" instead of full sync
   3. Reduce batch size in settings
   ```

#### 📭 "No highlights to sync"

**Symptoms:**
- Sync completes but no files created
- "0 highlights synced" message

**Solutions:**
1. Verify Readwise has content:
   - Visit [readwise.io/library](https://readwise.io/library)
   - Ensure you have highlights

2. Check filters:
   ```
   Settings → Readwise:
   - ☑️ Include supplementals
   - Check date range isn't limiting results
   ```

3. Try force refresh:
   ```
   Command Palette → "Readwise: Force full sync"
   ```

#### 🔄 "Duplicate highlights"

**Symptoms:**
- Same highlights appear multiple times
- Files grow with repeated content

**Solutions:**
1. Enable deduplication:
   ```
   Settings → Readwise:
   - ☑️ Append to existing (should be ON)
   - ☑️ Detect duplicates (should be ON)
   ```

2. Clean existing files:
   ```
   1. Backup your Readwise folder
   2. Delete duplicate entries manually
   3. Re-sync with "Append to existing" ON
   ```

---

### Performance Issues

#### 🐌 "Sync is very slow"

**Solutions:**
1. Optimize settings:
   ```
   For large libraries (1000+ highlights):
   - Sync frequency: 120+ minutes
   - Enable incremental sync
   - Use "Sync new only" after initial sync
   ```

2. Check network:
   ```bash
   # Test Readwise API speed
   curl -H "Authorization: Token YOUR_TOKEN" \
        https://readwise.io/api/v2/books/
   ```

3. Reduce memory usage:
   ```
   Settings → Advanced:
   - Batch size: 10 (default: 50)
   - Cache size: Small
   ```

#### 💾 "High memory usage"

**Solutions:**
1. Clear cache:
   ```
   Command: "Readwise: Clear cache"
   ```

2. Limit concurrent operations:
   ```
   Settings → Performance:
   - Max concurrent: 1
   - Disable preview generation
   ```

---

### File & Folder Issues

#### 📁 "Files not appearing"

**Symptoms:**
- Sync says successful but no files visible

**Solutions:**
1. Check folder location:
   ```
   Default: /Readwise/
   Settings → Highlights folder
   ```

2. Refresh file explorer:
   ```
   1. Close folder in sidebar
   2. Reopen folder
   3. Or restart Vault
   ```

3. Check permissions:
   ```bash
   # Ensure Vault can write to folder
   ls -la Readwise/
   ```

#### 🔄 "Files being overwritten"

**Solutions:**
1. Enable append mode:
   ```
   Settings → Readwise:
   ☑️ Append to existing files
   ```

2. Use stable IDs:
   ```
   Settings → Advanced:
   ☑️ Use stable block IDs
   ```

3. Backup before sync:
   ```
   Settings → Backup:
   ☑️ Auto-backup before sync
   ```

---

### Network & API Issues

#### ⚠️ "Rate limited"

**Symptoms:**
- "429 Too Many Requests" error
- "Rate limited. Try again in X seconds"

**Solutions:**
1. Wait and retry:
   ```
   Typical wait time: 2-5 minutes
   Don't spam retry - makes it worse
   ```

2. Reduce frequency:
   ```
   Settings → Sync frequency: 120+ minutes
   Disable "Sync on startup"
   ```

3. Use incremental sync:
   ```
   After initial sync, use "Sync new only"
   Uses fewer API calls
   ```

#### 🌐 "Network error"

**Solutions:**
1. Check connection:
   ```bash
   ping readwise.io
   ```

2. Check proxy/firewall:
   ```
   May need to whitelist:
   - readwise.io
   - *.readwise.io
   ```

3. Try manual test:
   ```bash
   curl https://readwise.io/api/v2/auth \
        -H "Authorization: Token YOUR_TOKEN"
   ```

---

## 🛠️ Advanced Debugging

### Enable Debug Mode

```javascript
// Open Developer Console (Cmd/Ctrl + Shift + I)

// Enable verbose logging
vault.plugins.readwise.enableDebug()

// Check current state
vault.plugins.readwise.getState()

// Force sync with logging
vault.plugins.readwise.syncWithDebug()

// Disable when done
vault.plugins.readwise.disableDebug()
```

### Check Logs

Log locations:
```
.vault/plugins/readwise/logs/
├── sync-history.log     # All sync attempts
├── errors.log          # Error details
└── debug.log          # Verbose debug info
```

### Manual API Test

Test your token directly:
```bash
# Test authentication
curl -I https://readwise.io/api/v2/auth \
     -H "Authorization: Token YOUR_TOKEN_HERE"

# Should return: HTTP/2 204 (No Content)

# Get recent highlights
curl https://readwise.io/api/v2/highlights?page_size=1 \
     -H "Authorization: Token YOUR_TOKEN_HERE"
```

### Reset Plugin Completely

```bash
# 1. Backup your data
cp -r Readwise/ Readwise-backup/

# 2. Disable plugin in UI

# 3. Remove all plugin data
rm -rf .vault/plugins/readwise/

# 4. Reinstall plugin

# 5. Reconfigure from scratch
```

---

## 📊 Diagnostic Report

Generate a diagnostic report for support:

```
Command Palette → "Readwise: Generate diagnostic report"
```

This creates a file with:
- Plugin version
- Settings (token hidden)
- Recent sync history
- Error logs
- System info

Share this when requesting help (sensitive data is redacted).

---

## 🆘 Still Need Help?

### Before Asking for Help

1. **Try the Quick Fixes**:
   - Restart Vault
   - Disable/re-enable plugin
   - Test with small sync (single book)

2. **Gather Information**:
   - Error messages (exact text)
   - Console logs (F12 → Console)
   - Diagnostic report

3. **Check Known Issues**:
   - [GitHub Issues](https://github.com/vault-app/readwise-plugin/issues)
   - [Forum Discussions](https://forum.vault.app/c/plugins/readwise)

### Getting Support

**GitHub Issues** (for bugs):
```markdown
**Describe the bug:**
[Clear description]

**To Reproduce:**
1. Go to...
2. Click on...
3. Error appears...

**Expected behavior:**
[What should happen]

**Diagnostic Report:**
[Attach report.json]

**Environment:**
- Vault version: 
- Plugin version:
- OS:
```

**Forum** (for questions):
- [Vault Forum - Readwise Plugin](https://forum.vault.app/c/plugins/readwise)

**Email** (for private issues):
- support@vault.app
- Include diagnostic report

---

## 🔄 Recovery Procedures

### Corrupted Sync State

```bash
# Reset sync state while preserving files
rm .vault/plugins/readwise/data/sync-state.json
# Restart Vault and sync
```

### Partial Sync Recovery

```javascript
// Resume interrupted sync
vault.plugins.readwise.resumeSync()

// Skip problematic items
vault.plugins.readwise.syncWithSkip(['book_id_123'])
```

### Emergency Stop

```javascript
// Stop all plugin operations
vault.plugins.readwise.emergencyStop()
```

---

## 📚 Additional Resources

- [Readwise API Status](https://status.readwise.io)
- [Vault Plugin Docs](https://docs.vault.app/plugins)
- [Community Discord](https://discord.gg/vault)
- [Video Tutorials](https://youtube.com/vault)

---

*Last updated: 2025-01-08 | Plugin v1.0.0*