import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Shield, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PermissionRequest {
  pluginId: string;
  pluginName: string;
  capability: string;
  reason: string;
  consequences: string[];
}

interface PluginPermissionDialogProps {
  request: PermissionRequest | null;
  onResponse: (granted: boolean, remember: boolean) => void;
}

export function PluginPermissionDialog({
  request,
  onResponse,
}: PluginPermissionDialogProps) {
  const [rememberChoice, setRememberChoice] = useState(false);

  if (!request) return null;

  const handleDeny = () => {
    onResponse(false, rememberChoice);
  };

  const handleGrantOnce = () => {
    onResponse(true, false);
  };

  const handleGrantAlways = () => {
    onResponse(true, true);
  };

  const getCapabilityIcon = () => {
    if (request.capability.startsWith('vault:write') || 
        request.capability.startsWith('vault:delete')) {
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    }
    if (request.capability.startsWith('network:')) {
      return <AlertTriangle className="h-5 w-5 text-orange-500" />;
    }
    return <Shield className="h-5 w-5 text-blue-500" />;
  };

  const getCapabilityDescription = () => {
    const cap = request.capability;
    
    if (cap === 'vault:read') return 'Read files from your vault';
    if (cap === 'vault:write') return 'Create and modify files in your vault';
    if (cap === 'vault:delete') return 'Delete files from your vault';
    if (cap === 'workspace:read') return 'Access workspace information';
    if (cap === 'workspace:write') return 'Modify workspace layout';
    if (cap === 'settings:read') return 'Read plugin settings';
    if (cap === 'settings:write') return 'Modify plugin settings';
    if (cap === 'graph:read') return 'Query knowledge graph';
    if (cap === 'graph:write') return 'Modify knowledge graph';
    if (cap === 'clipboard:read') return 'Read clipboard contents';
    if (cap === 'clipboard:write') return 'Write to clipboard';
    if (cap === 'notifications') return 'Show system notifications';
    if (cap.startsWith('network:')) {
      const domain = cap.substring(8);
      return `Connect to ${domain}`;
    }
    if (cap.startsWith('mcp:')) {
      const tool = cap.substring(4);
      return `Use MCP tool: ${tool}`;
    }
    if (cap.startsWith('vault:read:')) {
      const path = cap.substring(11);
      return `Read files from ${path}`;
    }
    if (cap.startsWith('vault:write:')) {
      const path = cap.substring(12);
      return `Write files to ${path}`;
    }
    
    return cap;
  };

  const isDangerousPermission = () => {
    return request.capability.includes('write') || 
           request.capability.includes('delete') ||
           request.capability.startsWith('network:') ||
           request.capability === 'clipboard:write';
  };

  return (
    <Dialog open={!!request}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getCapabilityIcon()}
            Plugin Permission Request
          </DialogTitle>
          <DialogDescription className="pt-2">
            <span className="font-semibold">{request.pluginName}</span> is requesting permission to:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-4">
            <h4 className="font-medium mb-1">{getCapabilityDescription()}</h4>
            {request.reason && (
              <p className="text-sm text-muted-foreground mt-2">
                <span className="font-medium">Reason:</span> {request.reason}
              </p>
            )}
          </div>

          {request.consequences && request.consequences.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-sm font-medium">
                <Info className="h-4 w-4" />
                What this permission allows:
              </div>
              <ul className="text-sm text-muted-foreground space-y-1 ml-5">
                {request.consequences.map((consequence, idx) => (
                  <li key={idx} className="list-disc">
                    {consequence}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isDangerousPermission() && (
            <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                <div className="text-sm text-yellow-800 dark:text-yellow-200">
                  <p className="font-medium">Security Warning</p>
                  <p className="mt-1">
                    This permission allows the plugin to perform potentially dangerous operations. 
                    Only grant this permission if you trust the plugin developer.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleDeny}
            className="w-full sm:w-auto"
          >
            Deny
          </Button>
          <Button
            variant="secondary"
            onClick={handleGrantOnce}
            className="w-full sm:w-auto"
          >
            Allow This Time
          </Button>
          <Button
            variant="default"
            onClick={handleGrantAlways}
            className={cn(
              "w-full sm:w-auto",
              isDangerousPermission() && "bg-yellow-600 hover:bg-yellow-700"
            )}
          >
            Always Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Hook to manage permission requests
export function usePluginPermissions() {
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);

  const requestPermission = async (
    pluginId: string,
    pluginName: string,
    capability: string,
    reason: string,
  ): Promise<boolean> => {
    try {
      // First try to get permission from backend
      const granted = await invoke<boolean>('plugin_request_permission', {
        pluginId,
        pluginName,
        capability,
        reason,
      });
      
      return granted;
    } catch (error) {
      console.error('Failed to request permission:', error);
      return false;
    }
  };

  const handlePermissionResponse = async (granted: boolean, remember: boolean) => {
    if (!permissionRequest) return;

    try {
      // Send response to backend
      await invoke('plugin_handle_consent_response', {
        pluginId: permissionRequest.pluginId,
        capability: permissionRequest.capability,
        granted,
        remember,
      });
    } catch (error) {
      console.error('Failed to handle permission response:', error);
    }

    setPermissionRequest(null);
  };

  const getPermissions = async (pluginId: string) => {
    try {
      return await invoke('plugin_get_permissions', { pluginId });
    } catch (error) {
      console.error('Failed to get permissions:', error);
      return [];
    }
  };

  const revokePermission = async (pluginId: string, capability: string) => {
    try {
      await invoke('plugin_revoke_permission', { pluginId, capability });
    } catch (error) {
      console.error('Failed to revoke permission:', error);
    }
  };

  const clearAllPermissions = async (pluginId: string) => {
    try {
      await invoke('plugin_clear_permissions', { pluginId });
    } catch (error) {
      console.error('Failed to clear permissions:', error);
    }
  };

  return {
    permissionRequest,
    setPermissionRequest,
    requestPermission,
    handlePermissionResponse,
    getPermissions,
    revokePermission,
    clearAllPermissions,
  };
}