import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

export class GhosttyIntegration {
  constructor(options = {}) {
    this.possiblePaths = [
      '/Applications/Ghostty.app/Contents/MacOS/ghostty',
      join(homedir(), 'Applications/Ghostty.app/Contents/MacOS/ghostty')
    ];
    this.detectedPath = null;
    
    // Logging and error handling
    this.logger = options.logger || null;
    this.errorHandler = options.errorHandler || null;
  }

  async detectBinary() {
    const startTime = performance.now();
    
    if (this.logger) {
      this.logger.debug('GhosttyIntegration: Starting binary detection');
    }
    
    // Check common installation paths
    for (const path of this.possiblePaths) {
      if (this.logger) {
        this.logger.debug('GhosttyIntegration: Checking path', path);
      }
      
      if (existsSync(path)) {
        this.detectedPath = path;
        
        if (this.logger) {
          this.logger.info('GhosttyIntegration: Binary found at', path);
          
          // Warn about user-specific locations
          if (path.includes(homedir())) {
            this.logger.warn('GhosttyIntegration: Binary found in user-specific location', path);
          }
        }
        
        return true;
      }
    }

    // Check if ghostty is in PATH
    if (this.logger) {
      this.logger.debug('GhosttyIntegration: Checking system PATH');
    }
    
    try {
      const result = execSync('which ghostty', { encoding: 'utf8' });
      const trimmedResult = result.toString().trim();
      
      if (trimmedResult) {
        this.detectedPath = trimmedResult;
        
        if (this.logger) {
          this.logger.info('GhosttyIntegration: Binary found in PATH', trimmedResult);
          this.logger.debug('GhosttyIntegration: Normalized path', trimmedResult);
        }
        
        return true;
      }
    } catch (error) {
      // ghostty not found in PATH - this is expected, not an error
      if (this.logger) {
        this.logger.debug('GhosttyIntegration: Binary not found in PATH');
      }
    }
    
    // Log detection time if it was slow
    const elapsed = performance.now() - startTime;
    if (this.logger && elapsed > 50) {
      this.logger.warn('GhosttyIntegration: Slow detection', { elapsed });
    }
    
    if (this.logger) {
      this.logger.warn('GhosttyIntegration: Binary not found in any location');
      this.logger.info('GhosttyIntegration: Installation hint', 'Install Ghostty from https://github.com/mitchellh/ghostty');
    }

    return false;
  }

  async validateBinary() {
    const path = await this.getBinaryPath();
    if (!path) {
      if (this.logger) {
        this.logger.warn('GhosttyIntegration: Cannot validate - no binary path');
      }
      return false;
    }
    
    if (this.logger) {
      this.logger.debug('GhosttyIntegration: Validating binary', path);
    }

    try {
      const result = execSync(`${path} --version`, { encoding: 'utf8' });
      const resultStr = result.toString();
      
      if (resultStr.includes('ghostty')) {
        if (this.logger) {
          this.logger.info('GhosttyIntegration: Binary validation successful');
        }
        return true;
      }
      
      return false;
    } catch (error) {
      if (this.logger) {
        this.logger.error('GhosttyIntegration: Binary validation failed', error);
        
        // Special handling for permission errors
        if (error.message && error.message.includes('EACCES')) {
          this.logger.error('GhosttyIntegration: Permission denied accessing binary');
          if (this.errorHandler) {
            this.errorHandler.handleError(
              new Error(`Permission denied accessing Ghostty binary at ${path}`),
              'GhosttyIntegration.permissions'
            );
          }
        }
      }
      
      if (this.errorHandler) {
        this.errorHandler.handleError(error, 'GhosttyIntegration.validateBinary');
      }
      
      return false;
    }
  }

  async getBinaryPath() {
    if (this.detectedPath) {
      return this.detectedPath;
    }

    // Try to detect if not already done
    const detected = await this.detectBinary();
    return detected ? this.detectedPath : null;
  }

  async getInstallationStatus() {
    if (this.logger) {
      this.logger.info('GhosttyIntegration: Checking installation status');
    }
    
    const installed = await this.detectBinary();
    const path = await this.getBinaryPath();
    
    if (!installed) {
      const status = {
        installed: false,
        path: null,
        version: null,
        valid: false
      };
      
      if (this.logger) {
        this.logger.info('GhosttyIntegration: Installation status', status);
      }
      
      return status;
    }

    let version = null;
    let valid = false;

    try {
      const versionOutput = execSync(`${path} --version`, { encoding: 'utf8' });
      const versionStr = versionOutput.toString().trim();
      const versionMatch = versionStr.match(/ghostty\s+(\d+\.\d+\.\d+)/i);
      
      if (versionMatch) {
        version = versionMatch[1];
        valid = true;
      } else if (this.logger) {
        this.logger.warn('GhosttyIntegration: Could not extract version from output', versionStr);
      }
    } catch (error) {
      // Binary exists but failed validation
      if (this.logger) {
        this.logger.error('GhosttyIntegration: Error checking version', error);
      }
      if (this.errorHandler) {
        this.errorHandler.handleWarning('Failed to get Ghostty version', 'GhosttyIntegration.getInstallationStatus');
      }
    }

    const status = {
      installed: true,
      path,
      version,
      valid
    };
    
    if (this.logger) {
      this.logger.info('GhosttyIntegration: Installation status', status);
    }
    
    return status;
  }
}