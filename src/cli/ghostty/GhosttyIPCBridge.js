import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { GhosttyProcess } from './GhosttyProcess.js';
import { GhosttyIntegration } from './GhosttyIntegration.js';

export class GhosttyIPCBridge {
  constructor() {
    this.integration = new GhosttyIntegration();
    this.ghosttyProcess = new GhosttyProcess(this.integration);
    this.listeners = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    // Register backend commands with Tauri
    await invoke('register_ghostty_commands');

    // Set up IPC event listeners
    this.listeners.push(
      await listen('ghostty:spawn', async (event) => {
        try {
          const options = event.payload || {};
          const success = await this.ghosttyProcess.spawn(options);
          
          if (success) {
            await emit('ghostty:spawned', { success: true });
          } else {
            await emit('ghostty:spawned', { 
              success: false, 
              error: 'Failed to spawn Ghostty process' 
            });
          }
        } catch (error) {
          await emit('ghostty:spawned', { 
            success: false, 
            error: error.message 
          });
        }
      })
    );

    this.listeners.push(
      await listen('ghostty:stop', async (event) => {
        try {
          const force = event.payload?.force || false;
          const success = this.ghosttyProcess.stop(force);
          await emit('ghostty:stopped', { success });
        } catch (error) {
          await emit('ghostty:stopped', { 
            success: false, 
            error: error.message 
          });
        }
      })
    );

    this.listeners.push(
      await listen('ghostty:write', async (event) => {
        try {
          const data = event.payload?.data;
          
          if (!data) {
            await emit('ghostty:write-complete', { 
              success: false, 
              error: 'No data provided' 
            });
            return;
          }
          
          const success = this.ghosttyProcess.write(data);
          await emit('ghostty:write-complete', { success });
        } catch (error) {
          await emit('ghostty:write-complete', { 
            success: false, 
            error: error.message 
          });
        }
      })
    );

    this.listeners.push(
      await listen('ghostty:status', async () => {
        try {
          const installation = await this.integration.getInstallationStatus();
          const process = this.ghosttyProcess.getProcessInfo();
          
          await emit('ghostty:status-response', {
            installation,
            process
          });
        } catch (error) {
          await emit('ghostty:status-response', { 
            error: error.message 
          });
        }
      })
    );

    // Set up process event forwarding
    this.ghosttyProcess.on('stdout', (data) => {
      emit('ghostty:stdout', { data: data.toString() });
    });

    this.ghosttyProcess.on('stderr', (data) => {
      emit('ghostty:stderr', { data: data.toString() });
    });

    this.ghosttyProcess.on('exit', (code, signal) => {
      emit('ghostty:exit', { code, signal });
    });

    this.ghosttyProcess.on('error', (error) => {
      emit('ghostty:error', { error: error.message });
    });

    this.initialized = true;
  }

  // Frontend API methods
  async spawnGhostty(options = {}) {
    return await this.ghosttyProcess.spawn(options);
  }

  stopGhostty(force = false) {
    return this.ghosttyProcess.stop(force);
  }

  writeToGhostty(data) {
    return this.ghosttyProcess.write(data);
  }

  async getGhosttyStatus() {
    const installation = await this.integration.getInstallationStatus();
    const process = this.ghosttyProcess.getProcessInfo();
    
    return {
      installation,
      process
    };
  }

  async destroy() {
    // Clean up event listeners
    for (const unlisten of this.listeners) {
      if (typeof unlisten === 'function') {
        unlisten();
      }
    }
    
    this.listeners = [];
    this.initialized = false;
    
    // Clean up process
    if (this.ghosttyProcess) {
      this.ghosttyProcess.destroy();
    }
  }
}