import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { GhosttyIPCBridge } from './GhosttyIPCBridge.js';

// This is an integration test that requires Ghostty to be installed
// It tests the full communication flow between frontend and backend
// Skip these tests in CI environments where Ghostty might not be available

const INTEGRATION_TEST_TIMEOUT = 10000; // 10 seconds

describe('Ghostty Integration Tests', () => {
  let bridge;
  let isGhosttyInstalled = false;

  beforeAll(async () => {
    bridge = new GhosttyIPCBridge();
    
    // Check if Ghostty is installed
    try {
      const status = await bridge.getGhosttyStatus();
      isGhosttyInstalled = status.installation.installed;
    } catch (e) {
      console.log('Ghostty not installed, skipping integration tests');
    }

    if (isGhosttyInstalled) {
      await bridge.init();
    }
  });

  afterAll(async () => {
    if (isGhosttyInstalled && bridge) {
      await bridge.destroy();
    }
  });

  describe('Installation Detection', () => {
    it('should detect Ghostty installation', async () => {
      if (!isGhosttyInstalled) {
        console.log('Skipping: Ghostty not installed');
        return;
      }

      const status = await bridge.getGhosttyStatus();
      
      expect(status.installation).toBeDefined();
      expect(status.installation.installed).toBe(true);
      expect(status.installation.path).toBeTruthy();
      expect(status.installation.version).toBeTruthy();
      expect(status.installation.valid).toBe(true);
    });
  });

  describe('Process Lifecycle', () => {
    it('should spawn and stop Ghostty process', async () => {
      if (!isGhosttyInstalled) {
        console.log('Skipping: Ghostty not installed');
        return;
      }

      // Start with no process running
      let status = await bridge.getGhosttyStatus();
      expect(status.process.running).toBe(false);

      // Spawn process
      const spawnResult = await bridge.spawnGhostty({
        cwd: process.env.HOME
      });
      expect(spawnResult).toBe(true);

      // Wait a bit for process to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check process is running
      status = await bridge.getGhosttyStatus();
      expect(status.process.running).toBe(true);
      expect(status.process.pid).toBeGreaterThan(0);

      // Stop process
      const stopResult = bridge.stopGhostty();
      expect(stopResult).toBe(true);

      // Wait a bit for process to stop
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check process is stopped
      status = await bridge.getGhosttyStatus();
      expect(status.process.running).toBe(false);
    }, INTEGRATION_TEST_TIMEOUT);

    it('should write to Ghostty process', async () => {
      if (!isGhosttyInstalled) {
        console.log('Skipping: Ghostty not installed');
        return;
      }

      // Set up output capture
      const outputData = [];
      const outputHandler = (event) => {
        outputData.push(event.data);
      };

      bridge.ghosttyProcess.on('stdout', outputHandler);

      // Spawn process
      await bridge.spawnGhostty();
      
      // Wait for process to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Write a command
      const writeResult = bridge.writeToGhostty('echo "Hello from integration test"\n');
      expect(writeResult).toBe(true);

      // Wait for output
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Clean up
      bridge.ghosttyProcess.off('stdout', outputHandler);
      bridge.stopGhostty();

      // Verify we got some output (exact output may vary based on shell)
      expect(outputData.length).toBeGreaterThan(0);
    }, INTEGRATION_TEST_TIMEOUT);
  });

  describe('Event Communication', () => {
    it('should emit events on process lifecycle', async () => {
      if (!isGhosttyInstalled) {
        console.log('Skipping: Ghostty not installed');
        return;
      }

      const events = [];
      
      // Set up event listeners
      const spawnHandler = () => events.push('spawn');
      const exitHandler = () => events.push('exit');
      
      bridge.ghosttyProcess.on('spawn', spawnHandler);
      bridge.ghosttyProcess.on('exit', exitHandler);

      // Spawn and stop process
      await bridge.spawnGhostty();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      bridge.stopGhostty();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Clean up listeners
      bridge.ghosttyProcess.off('spawn', spawnHandler);
      bridge.ghosttyProcess.off('exit', exitHandler);

      // Verify events were emitted
      expect(events).toContain('spawn');
      expect(events).toContain('exit');
    }, INTEGRATION_TEST_TIMEOUT);
  });

  describe('Error Handling', () => {
    it('should handle invalid spawn options gracefully', async () => {
      if (!isGhosttyInstalled) {
        console.log('Skipping: Ghostty not installed');
        return;
      }

      // Try to spawn with invalid working directory
      const result = await bridge.spawnGhostty({
        cwd: '/nonexistent/directory'
      });

      // Should fail gracefully
      expect(result).toBe(false);
    });

    it('should handle write to non-running process', async () => {
      if (!isGhosttyInstalled) {
        console.log('Skipping: Ghostty not installed');
        return;
      }

      // Ensure no process is running
      const status = await bridge.getGhosttyStatus();
      if (status.process.running) {
        bridge.stopGhostty();
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Try to write
      const result = bridge.writeToGhostty('echo "test"\n');
      expect(result).toBe(false);
    });
  });
});