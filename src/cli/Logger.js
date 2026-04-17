import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../../logs');
        this.logPath = null;
        this.writeStream = null;
        
        try {
            // Create logs directory if it doesn't exist
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
            
            // Create log file with timestamp
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const filename = `cli-${year}${month}${day}-${hours}${minutes}${seconds}.log`;
            this.logPath = path.join(this.logDir, filename);
            
            // Create write stream
            this.writeStream = fs.createWriteStream(this.logPath, { flags: 'a' });
        } catch (error) {
            console.error('Failed to create log file:', error);
        }
    }
    
    _formatMessage(level, ...args) {
        const timestamp = new Date().toISOString();
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (error) {
                    // Handle circular references
                    return '[Circular Reference]';
                }
            }
            return String(arg);
        }).join(' ');
        
        return `[${timestamp}] [${level}] ${message}\n`;
    }
    
    _write(level, ...args) {
        if (!this.writeStream) return;
        
        try {
            const formattedMessage = this._formatMessage(level, ...args);
            this.writeStream.write(formattedMessage);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }
    
    info(...args) {
        this._write('INFO', ...args);
    }
    
    error(...args) {
        this._write('ERROR', ...args);
    }
    
    warn(...args) {
        this._write('WARN', ...args);
    }
    
    debug(...args) {
        this._write('DEBUG', ...args);
    }
    
    close() {
        if (this.writeStream) {
            try {
                this.writeStream.end();
            } catch (error) {
                // Silently handle close errors
            }
        }
    }
    
    getLogPath() {
        return this.logPath;
    }
}

export default Logger;