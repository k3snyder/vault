import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { PluginHub } from './PluginHub';
import { PluginProvider } from './contexts/PluginContext';

// Mock Tauri API
jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn()
}));

describe('PluginHub Container', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Component Rendering', () => {
    test('should render PluginHub container', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      expect(screen.getByTestId('plugin-hub-container')).toBeInTheDocument();
    });

    test('should render navigation sidebar', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      expect(screen.getByTestId('navigation-sidebar')).toBeInTheDocument();
      expect(screen.getByText('Discover')).toBeInTheDocument();
      expect(screen.getByText('Installed')).toBeInTheDocument();
      expect(screen.getByText('Permissions')).toBeInTheDocument();
      expect(screen.getByText('Resources')).toBeInTheDocument();
    });

    test('should render search bar', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      expect(screen.getByPlaceholderText('Search plugins...')).toBeInTheDocument();
    });

    test('should render default view (Installed)', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      expect(screen.getByTestId('installed-view')).toBeInTheDocument();
    });
  });

  describe('View Routing', () => {
    test('should switch to Discover view when clicked', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      const discoverTab = screen.getByText('Discover');
      fireEvent.click(discoverTab);
      
      expect(screen.getByTestId('discover-view')).toBeInTheDocument();
      expect(screen.queryByTestId('installed-view')).not.toBeInTheDocument();
    });

    test('should switch to Permissions view when clicked', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      const permissionsTab = screen.getByText('Permissions');
      fireEvent.click(permissionsTab);
      
      expect(screen.getByTestId('permissions-view')).toBeInTheDocument();
    });

    test('should switch to Resources view when clicked', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      const resourcesTab = screen.getByText('Resources');
      fireEvent.click(resourcesTab);
      
      expect(screen.getByTestId('resources-view')).toBeInTheDocument();
    });

    test('should highlight active view tab', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      const discoverTab = screen.getByText('Discover');
      fireEvent.click(discoverTab);
      
      expect(discoverTab.parentElement).toHaveClass('active');
    });
  });

  describe('Keyboard Navigation', () => {
    test('should switch to Discover view with "1" key', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      fireEvent.keyDown(document, { key: '1' });
      
      expect(screen.getByTestId('discover-view')).toBeInTheDocument();
    });

    test('should switch to Installed view with "2" key', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      // Start on a different view
      fireEvent.keyDown(document, { key: '1' });
      
      // Switch to Installed
      fireEvent.keyDown(document, { key: '2' });
      
      expect(screen.getByTestId('installed-view')).toBeInTheDocument();
    });

    test('should switch to Permissions view with "3" key', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      fireEvent.keyDown(document, { key: '3' });
      
      expect(screen.getByTestId('permissions-view')).toBeInTheDocument();
    });

    test('should switch to Resources view with "4" key', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      fireEvent.keyDown(document, { key: '4' });
      
      expect(screen.getByTestId('resources-view')).toBeInTheDocument();
    });

    test('should focus search bar with "/" key', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      const searchInput = screen.getByPlaceholderText('Search plugins...');
      
      fireEvent.keyDown(document, { key: '/' });
      
      expect(document.activeElement).toBe(searchInput);
    });

    test('should close Plugin Hub with Escape key', () => {
      const onClose = jest.fn();
      
      render(
        <PluginProvider>
          <PluginHub onClose={onClose} />
        </PluginProvider>
      );
      
      fireEvent.keyDown(document, { key: 'Escape' });
      
      expect(onClose).toHaveBeenCalled();
    });

    test('should not trigger keyboard shortcuts when input is focused', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      const searchInput = screen.getByPlaceholderText('Search plugins...');
      searchInput.focus();
      
      fireEvent.keyDown(searchInput, { key: '1' });
      
      // Should stay on default view (Installed)
      expect(screen.getByTestId('installed-view')).toBeInTheDocument();
      expect(screen.queryByTestId('discover-view')).not.toBeInTheDocument();
    });
  });

  describe('State Management', () => {
    test('should persist view selection', () => {
      const { rerender } = render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      // Switch to Discover view
      fireEvent.keyDown(document, { key: '1' });
      expect(screen.getByTestId('discover-view')).toBeInTheDocument();
      
      // Re-render component
      rerender(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      // Should still be on Discover view
      expect(screen.getByTestId('discover-view')).toBeInTheDocument();
    });

    test('should maintain search query across view switches', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      const searchInput = screen.getByPlaceholderText('Search plugins...');
      
      // Enter search query
      fireEvent.change(searchInput, { target: { value: 'readwise' } });
      expect(searchInput.value).toBe('readwise');
      
      // Switch views
      fireEvent.keyDown(document, { key: '1' });
      fireEvent.keyDown(document, { key: '2' });
      
      // Search query should be maintained
      expect(searchInput.value).toBe('readwise');
    });

    test('should show loading state while fetching plugins', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
      
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
      
      await waitFor(() => {
        expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
      });
    });

    test('should show error state on plugin fetch failure', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockRejectedValue(new Error('Failed to fetch plugins'));
      
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      await waitFor(() => {
        expect(screen.getByText(/Failed to fetch plugins/)).toBeInTheDocument();
      });
    });
  });

  describe('Search Functionality', () => {
    test('should filter plugins based on search query', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValue([
        { id: 'readwise', name: 'Readwise', description: 'Sync highlights' },
        { id: 'daily-notes', name: 'Daily Notes', description: 'Create daily notes' }
      ]);
      
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      await waitFor(() => {
        expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
      });
      
      const searchInput = screen.getByPlaceholderText('Search plugins...');
      fireEvent.change(searchInput, { target: { value: 'readwise' } });
      
      await waitFor(() => {
        expect(screen.getByText('Readwise')).toBeInTheDocument();
        expect(screen.queryByText('Daily Notes')).not.toBeInTheDocument();
      });
    });

    test('should clear search with Escape key when search is focused', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      const searchInput = screen.getByPlaceholderText('Search plugins...');
      
      fireEvent.change(searchInput, { target: { value: 'test search' } });
      searchInput.focus();
      
      fireEvent.keyDown(searchInput, { key: 'Escape' });
      
      expect(searchInput.value).toBe('');
    });

    test('should show "No results" message when search has no matches', async () => {
      const { invoke } = require('@tauri-apps/api/core');
      invoke.mockResolvedValue([
        { id: 'readwise', name: 'Readwise', description: 'Sync highlights' }
      ]);
      
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      await waitFor(() => {
        expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
      });
      
      const searchInput = screen.getByPlaceholderText('Search plugins...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
      
      await waitFor(() => {
        expect(screen.getByText('No plugins found')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    test('should have proper ARIA labels', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      expect(screen.getByRole('navigation', { name: 'Plugin views' })).toBeInTheDocument();
      expect(screen.getByRole('search', { name: 'Search plugins' })).toBeInTheDocument();
      expect(screen.getByRole('main', { name: 'Plugin content' })).toBeInTheDocument();
    });

    test('should support Tab navigation', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      const searchInput = screen.getByPlaceholderText('Search plugins...');
      const discoverTab = screen.getByText('Discover');
      
      // Tab from search to first navigation item
      searchInput.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      
      expect(document.activeElement).toBe(discoverTab);
    });

    test('should announce view changes to screen readers', () => {
      render(
        <PluginProvider>
          <PluginHub />
        </PluginProvider>
      );
      
      fireEvent.keyDown(document, { key: '1' });
      
      const announcement = screen.getByRole('status');
      expect(announcement).toHaveTextContent('Switched to Discover view');
    });
  });
});