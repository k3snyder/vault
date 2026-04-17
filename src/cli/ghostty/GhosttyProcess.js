import { EventEmitter } from 'events';
import { spawn } from 'child_process';

export class GhosttyProcess extends EventEmitter {
  constructor(integration) {
    super();
    this.integration = integration;
    this.process = null;
    this.startTime = null;
    this.options = null;
  }

  async spawn(options = {}) {
    // Check if binary is available
    const detected = await this.integration.detectBinary();
    if (!detected) {
      return false;
    }

    const binaryPath = await this.integration.getBinaryPath();
    if (!binaryPath) {
      return false;
    }

    try {
      const spawnOptions = {
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...options
      };

      const args = options.args || [];
      
      this.process = spawn(binaryPath, args, spawnOptions);
      this.startTime = new Date();
      this.options = options;

      // Set up event handlers
      this.process.on('exit', (code, signal) => {
        this.emit('exit', code, signal);
        this.process = null;
        this.startTime = null;
      });

      this.process.on('error', (error) => {
        this.emit('error', error);
      });

      this.process.stdout.on('data', (data) => {
        this.emit('stdout', data);
      });

      this.process.stderr.on('data', (data) => {
        this.emit('stderr', data);
      });

      this.emit('spawn', this.process.pid);
      return true;
    } catch (error) {
      return false;
    }
  }

  stop(force = false) {
    if (!this.process) {
      return false;
    }

    const signal = force ? 'SIGKILL' : 'SIGTERM';
    const result = this.process.kill(signal);
    
    if (result) {
      this.process = null;
      this.startTime = null;
    }
    
    return result;
  }

  async restart() {
    const options = this.options || {};
    this.stop();
    return await this.spawn(options);
  }

  write(data) {
    if (!this.process || !this.process.stdin) {
      return false;
    }

    try {
      this.process.stdin.write(data);
      return true;
    } catch (error) {
      return false;
    }
  }

  isRunning() {
    return this.process !== null;
  }

  getPid() {
    return this.process ? this.process.pid : null;
  }

  getProcessInfo() {
    if (!this.process) {
      return {
        running: false,
        pid: null,
        uptime: 0,
        startTime: null
      };
    }

    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;

    return {
      running: true,
      pid: this.process.pid,
      uptime,
      startTime: this.startTime
    };
  }

  destroy() {
    if (this.process) {
      this.stop();
    }
    this.removeAllListeners();
  }
}