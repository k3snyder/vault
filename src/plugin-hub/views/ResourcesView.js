import LoadingStates from '../components/LoadingStates.js';

class ResourcesView {
    constructor(context) {
        this.context = context;
        this.element = null;
        this.updateInterval = null;
        this.chartData = {
            memory: [],
            cpu: [],
            storage: []
        };
        this.maxDataPoints = 30;
        this.selectedTimeRange = '5m'; // 5m, 15m, 1h
    }

    render() {
        const container = document.createElement('div');
        container.className = 'view-container resources-view';
        container.innerHTML = `
            <div class="view-header">
                <h2 class="view-title">Resource Usage</h2>
                <div class="view-controls">
                    <div class="time-range-selector">
                        <button class="time-range-btn ${this.selectedTimeRange === '5m' ? 'active' : ''}" data-range="5m">5m</button>
                        <button class="time-range-btn ${this.selectedTimeRange === '15m' ? 'active' : ''}" data-range="15m">15m</button>
                        <button class="time-range-btn ${this.selectedTimeRange === '1h' ? 'active' : ''}" data-range="1h">1h</button>
                    </div>
                    <button class="pause-button" aria-label="Pause monitoring">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <rect x="5" y="4" width="2" height="8" fill="currentColor"/>
                            <rect x="9" y="4" width="2" height="8" fill="currentColor"/>
                        </svg>
                    </button>
                </div>
            </div>
            
            <div class="resources-overview">
                <div class="resource-summary">
                    ${this.renderResourceSummary()}
                </div>
                
                <div class="resource-charts">
                    <div class="chart-container">
                        <h3 class="chart-title">Memory Usage</h3>
                        <div class="chart-wrapper">
                            <canvas id="memory-chart" width="400" height="200"></canvas>
                        </div>
                        <div class="chart-legend">
                            <span class="legend-current">Current: ${this.getCurrentMemory()}MB</span>
                            <span class="legend-limit">Limit: ${this.getMemoryLimit()}MB</span>
                        </div>
                    </div>
                    
                    <div class="chart-container">
                        <h3 class="chart-title">CPU Usage</h3>
                        <div class="chart-wrapper">
                            <canvas id="cpu-chart" width="400" height="200"></canvas>
                        </div>
                        <div class="chart-legend">
                            <span class="legend-current">Current: ${this.getCurrentCPU()}%</span>
                            <span class="legend-average">Avg: ${this.getAverageCPU()}%</span>
                        </div>
                    </div>
                </div>
                
                <div class="plugin-resources">
                    <h3 class="section-title">Plugin Resource Breakdown</h3>
                    <div class="plugin-resource-list">
                        ${this.renderPluginResourceList()}
                    </div>
                </div>
            </div>
        `;

        this.attachEventListeners(container);
        this.element = container;
        
        // Start monitoring
        this.startMonitoring();
        
        // Initialize charts
        requestAnimationFrame(() => {
            this.initializeCharts();
        });
        
        return container;
    }

    renderResourceSummary() {
        const totalMemory = this.getTotalMemoryUsage();
        const totalCPU = this.getTotalCPUUsage();
        const activePlugins = this.context.state.installedPlugins.filter(p => p.enabled).length;
        
        return `
            <div class="summary-grid">
                <div class="summary-card">
                    <div class="summary-icon memory">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <rect x="4" y="8" width="16" height="8" stroke="currentColor" stroke-width="1.5"/>
                            <path d="M8 4V8M12 4V8M16 4V8M8 16V20M12 16V20M16 16V20" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                    </div>
                    <div class="summary-content">
                        <div class="summary-value">${totalMemory}MB</div>
                        <div class="summary-label">Memory Used</div>
                        <div class="summary-progress">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${(totalMemory / this.getMemoryLimit()) * 100}%"></div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="summary-card">
                    <div class="summary-icon cpu">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <rect x="6" y="6" width="12" height="12" stroke="currentColor" stroke-width="1.5"/>
                            <path d="M10 3V6M14 3V6M10 18V21M14 18V21M3 10H6M18 10H21M3 14H6M18 14H21" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                    </div>
                    <div class="summary-content">
                        <div class="summary-value">${totalCPU}%</div>
                        <div class="summary-label">CPU Usage</div>
                        <div class="summary-meter">
                            <div class="meter-segments">
                                ${this.renderCPUMeter(totalCPU)}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="summary-card">
                    <div class="summary-icon plugins">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="3" width="7" height="7" stroke="currentColor" stroke-width="1.5"/>
                            <rect x="14" y="3" width="7" height="7" stroke="currentColor" stroke-width="1.5"/>
                            <rect x="3" y="14" width="7" height="7" stroke="currentColor" stroke-width="1.5"/>
                            <rect x="14" y="14" width="7" height="7" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                    </div>
                    <div class="summary-content">
                        <div class="summary-value">${activePlugins}</div>
                        <div class="summary-label">Active Plugins</div>
                        <div class="summary-detail">
                            ${this.getHighResourcePlugins()} high usage
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderPluginResourceList() {
        const plugins = this.context.state.installedPlugins.filter(p => p.enabled);
        
        if (plugins.length === 0) {
            return LoadingStates.createEmptyState(
                'No active plugins',
                'Enable some plugins to see their resource usage'
            ).outerHTML;
        }
        
        // Sort by total resource usage
        const pluginsWithUsage = plugins.map(plugin => {
            const resources = this.context.state.resources[plugin.id] || {};
            const memoryUsage = resources.memory?.used || 0;
            const cpuUsage = resources.cpu || 0;
            const totalScore = memoryUsage + (cpuUsage * 10); // Weight CPU usage
            
            return { ...plugin, resources, totalScore };
        }).sort((a, b) => b.totalScore - a.totalScore);
        
        return pluginsWithUsage.map(plugin => `
            <div class="plugin-resource-item">
                <div class="plugin-resource-header">
                    <span class="plugin-name">${plugin.name}</span>
                    <span class="resource-status ${this.getResourceStatus(plugin.resources)}">
                        ${this.getResourceStatusIcon(plugin.resources)}
                    </span>
                </div>
                <div class="plugin-resource-details">
                    <div class="resource-metric">
                        <span class="metric-label">Memory:</span>
                        <span class="metric-value">${plugin.resources.memory?.used || 0}MB</span>
                        <div class="metric-bar">
                            <div class="metric-fill" style="width: ${this.getResourcePercentage(plugin.resources.memory?.used, 100)}%"></div>
                        </div>
                    </div>
                    <div class="resource-metric">
                        <span class="metric-label">CPU:</span>
                        <span class="metric-value">${plugin.resources.cpu || 0}%</span>
                        <div class="metric-bar">
                            <div class="metric-fill" style="width: ${plugin.resources.cpu || 0}%"></div>
                        </div>
                    </div>
                    <div class="resource-metric">
                        <span class="metric-label">Storage:</span>
                        <span class="metric-value">${this.formatStorage(plugin.resources.storage?.used || 0)}</span>
                    </div>
                </div>
                <div class="plugin-resource-actions">
                    <button class="resource-action-btn" data-plugin-id="${plugin.id}" data-action="restart">
                        Restart
                    </button>
                    <button class="resource-action-btn" data-plugin-id="${plugin.id}" data-action="limit">
                        Set Limits
                    </button>
                </div>
            </div>
        `).join('');
    }

    renderCPUMeter(percentage) {
        const segments = 10;
        const activeSegments = Math.round((percentage / 100) * segments);
        
        return Array(segments).fill(0).map((_, i) => {
            const isActive = i < activeSegments;
            const isHigh = i >= 7;
            const isMedium = i >= 5 && i < 7;
            
            return `<div class="meter-segment ${isActive ? 'active' : ''} ${isHigh ? 'high' : isMedium ? 'medium' : 'low'}"></div>`;
        }).join('');
    }

    initializeCharts() {
        // Simple canvas-based charts
        this.drawMemoryChart();
        this.drawCPUChart();
    }

    drawMemoryChart() {
        const canvas = this.element?.querySelector('#memory-chart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Draw grid
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 1;
        
        for (let i = 0; i <= 4; i++) {
            const y = (height / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        // Draw data line
        if (this.chartData.memory.length > 1) {
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            const maxValue = this.getMemoryLimit();
            this.chartData.memory.forEach((value, index) => {
                const x = (width / (this.maxDataPoints - 1)) * index;
                const y = height - (value / maxValue) * height;
                
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            
            ctx.stroke();
            
            // Fill area under line
            ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
            ctx.lineTo(width, height);
            ctx.lineTo(0, height);
            ctx.closePath();
            ctx.fill();
        }
    }

    drawCPUChart() {
        const canvas = this.element?.querySelector('#cpu-chart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Draw grid
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 1;
        
        for (let i = 0; i <= 4; i++) {
            const y = (height / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        // Draw data bars
        if (this.chartData.cpu.length > 0) {
            const barWidth = width / this.maxDataPoints;
            
            this.chartData.cpu.forEach((value, index) => {
                const x = barWidth * index;
                const barHeight = (value / 100) * height;
                const y = height - barHeight;
                
                // Color based on usage
                if (value > 80) {
                    ctx.fillStyle = '#f44336';
                } else if (value > 50) {
                    ctx.fillStyle = '#ff9800';
                } else {
                    ctx.fillStyle = '#4caf50';
                }
                
                ctx.fillRect(x, y, barWidth - 2, barHeight);
            });
        }
    }

    startMonitoring() {
        // Simulate real-time data updates
        this.updateInterval = setInterval(() => {
            this.updateResourceData();
            this.updateCharts();
            this.updateStats();
        }, 2000);
        
        // Initial data
        this.updateResourceData();
    }

    stopMonitoring() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    updateResourceData() {
        // Simulate resource data
        const memoryUsage = 200 + Math.random() * 100;
        const cpuUsage = 10 + Math.random() * 50;
        
        // Add to chart data
        this.chartData.memory.push(memoryUsage);
        this.chartData.cpu.push(cpuUsage);
        
        // Keep only last N data points
        if (this.chartData.memory.length > this.maxDataPoints) {
            this.chartData.memory.shift();
        }
        if (this.chartData.cpu.length > this.maxDataPoints) {
            this.chartData.cpu.shift();
        }
        
        // Update plugin resources (mock data)
        this.context.state.installedPlugins.forEach(plugin => {
            if (plugin.enabled) {
                this.context.updateResourceUsage(plugin.id, {
                    memory: { used: Math.round(Math.random() * 50), limit: 100 },
                    cpu: Math.round(Math.random() * 30),
                    storage: { used: Math.round(Math.random() * 200), limit: 500 }
                });
            }
        });
    }

    updateCharts() {
        this.drawMemoryChart();
        this.drawCPUChart();
    }

    updateStats() {
        // Update summary cards
        const summaryElement = this.element?.querySelector('.resource-summary');
        if (summaryElement) {
            summaryElement.innerHTML = this.renderResourceSummary();
        }
        
        // Update chart legends
        const memoryLegend = this.element?.querySelector('.chart-container:first-child .legend-current');
        if (memoryLegend) {
            memoryLegend.textContent = `Current: ${this.getCurrentMemory()}MB`;
        }
        
        const cpuLegend = this.element?.querySelector('.chart-container:last-child .legend-current');
        if (cpuLegend) {
            cpuLegend.textContent = `Current: ${this.getCurrentCPU()}%`;
        }
    }

    attachEventListeners(container) {
        // Time range selector
        const timeRangeBtns = container.querySelectorAll('.time-range-btn');
        timeRangeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedTimeRange = btn.dataset.range;
                timeRangeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Adjust data points based on time range
                switch (this.selectedTimeRange) {
                    case '5m': this.maxDataPoints = 30; break;
                    case '15m': this.maxDataPoints = 45; break;
                    case '1h': this.maxDataPoints = 60; break;
                }
            });
        });
        
        // Pause button
        const pauseBtn = container.querySelector('.pause-button');
        pauseBtn?.addEventListener('click', () => {
            if (this.updateInterval) {
                this.stopMonitoring();
                pauseBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M5 4L13 8L5 12V4Z" fill="currentColor"/>
                    </svg>
                `;
                pauseBtn.setAttribute('aria-label', 'Resume monitoring');
            } else {
                this.startMonitoring();
                pauseBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <rect x="5" y="4" width="2" height="8" fill="currentColor"/>
                        <rect x="9" y="4" width="2" height="8" fill="currentColor"/>
                    </svg>
                `;
                pauseBtn.setAttribute('aria-label', 'Pause monitoring');
            }
        });
        
        // Plugin resource actions
        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('resource-action-btn')) {
                const pluginId = e.target.dataset.pluginId;
                const action = e.target.dataset.action;
                
                if (action === 'restart') {
                    this.restartPlugin(pluginId);
                } else if (action === 'limit') {
                    this.setResourceLimits(pluginId);
                }
            }
        });
    }

    restartPlugin(pluginId) {
        const plugin = this.context.state.installedPlugins.find(p => p.id === pluginId);
        if (plugin) {
            this.context.showToast(`Restarting ${plugin.name}...`, 'info');
            // TODO: Implement actual restart
        }
    }

    setResourceLimits(pluginId) {
        const plugin = this.context.state.installedPlugins.find(p => p.id === pluginId);
        if (plugin) {
            // TODO: Open modal to set resource limits
            this.context.showToast('Resource limits dialog coming soon', 'info');
        }
    }

    // Helper methods
    getTotalMemoryUsage() {
        return this.chartData.memory[this.chartData.memory.length - 1] || 0;
    }

    getTotalCPUUsage() {
        return this.chartData.cpu[this.chartData.cpu.length - 1] || 0;
    }

    getCurrentMemory() {
        return Math.round(this.getTotalMemoryUsage());
    }

    getCurrentCPU() {
        return Math.round(this.getTotalCPUUsage());
    }

    getAverageCPU() {
        if (this.chartData.cpu.length === 0) return 0;
        const sum = this.chartData.cpu.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.chartData.cpu.length);
    }

    getMemoryLimit() {
        return 500; // Mock limit
    }

    getHighResourcePlugins() {
        return this.context.state.installedPlugins.filter(p => {
            const resources = this.context.state.resources[p.id];
            return resources && (resources.cpu > 30 || resources.memory?.used > 50);
        }).length;
    }

    getResourceStatus(resources) {
        if (!resources) return 'normal';
        if (resources.cpu > 50 || resources.memory?.used > 75) return 'high';
        if (resources.cpu > 30 || resources.memory?.used > 50) return 'medium';
        return 'normal';
    }

    getResourceStatusIcon(resources) {
        const status = this.getResourceStatus(resources);
        switch (status) {
            case 'high': return '🔴';
            case 'medium': return '🟡';
            default: return '🟢';
        }
    }

    getResourcePercentage(used, limit) {
        if (!limit) return 0;
        return Math.min(100, (used / limit) * 100);
    }

    formatStorage(bytes) {
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}GB`;
        return `${bytes}MB`;
    }

    destroy() {
        this.stopMonitoring();
        this.element = null;
    }
}

export default ResourcesView;