// Type definitions for Vault Plugin API
// This is a local copy until the official @vault/plugin-api package is available

declare module '@vault/plugin-api' {
  export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    author: string;
    description: string;
    permissions: string[];
    main: string;
    styles?: string;
  }

  export interface VaultAPI {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    append(path: string, content: string): Promise<void>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    list(path: string): Promise<string[]>;
    search(query: string): Promise<string[]>;
    getMetadata(path: string): Promise<Record<string, string>>;
    setMetadata(path: string, metadata: Record<string, string>): Promise<void>;
    createNote(path: string, content: string): Promise<void>;
    updateNote(path: string, content: string): Promise<void>;
    deleteNote(path: string): Promise<void>;
    getNote(path: string): Promise<string>;
    listNotes(folder?: string): Promise<string[]>;
    searchNotes(query: string): Promise<string[]>;
  }

  export interface WorkspaceAPI {
    showNotice(message: string, type?: 'info' | 'warning' | 'error' | 'success'): Promise<void>;
    showProgress(message: string): Promise<string>;
    hideProgress(id: string): Promise<void>;
    openFile(path: string): Promise<void>;
    openExternal(url: string): Promise<boolean>;
    getActiveFile(): Promise<string | null>;
    registerCommand(command: Command): Promise<void>;
    registerStatusBarItem(item: StatusBarItemConfig): Promise<StatusBarItem>;
    registerSettingsTab(tab: SettingsTabConfig): Promise<void>;
    on(event: string, callback: (data: any) => void): void;
    off(event: string, callback: (data: any) => void): void;
    emit(event: string, data: any): Promise<void>;
  }

  export interface SettingsAPI {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
    list(): Promise<string[]>;
    onChange(key: string, callback: (value: any) => void): void;
    offChange(key: string, callback: (value: any) => void): void;
  }

  export interface NetworkAPI {
    fetch(url: string, options?: RequestInit): Promise<Response>;
    download(url: string, path: string): Promise<void>;
    upload(url: string, file: File): Promise<Response>;
  }

  export interface Command {
    id: string;
    name: string;
    callback: () => void | Promise<void>;
    hotkey?: string;
  }

  export interface StatusBarItemConfig {
    id: string;
    text: string;
    tooltip?: string;
    position?: 'left' | 'right';
    onClick?: () => void | Promise<void>;
  }

  export interface StatusBarItem {
    setText(text: string): void;
    setTooltip(tooltip: string): void;
    hide(): void;
    show(): void;
  }

  export interface SettingsTabConfig {
    id: string;
    name: string;
    component: (container: HTMLElement) => any;
  }

  export interface SettingsTab {
    id: string;
    name: string;
    container: HTMLElement;
  }

  export interface PluginContext {
    vault: VaultAPI;
    workspace: WorkspaceAPI;
    settings: SettingsAPI;
    network: NetworkAPI;
    manifest: PluginManifest;
  }

  export interface Plugin {
    onload(context: PluginContext): Promise<void>;
    onunload(): Promise<void>;
  }
}