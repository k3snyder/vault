// AgentCostDisplay.js - Display token usage and cost for Claude Agent
import { icons } from '../icons/icon-utils.js';

export class AgentCostDisplay {
  constructor(options = {}) {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cumulativeInputTokens = 0;
    this.cumulativeOutputTokens = 0;
    this.cumulativeCost = 0;
    this.lastCost = 0;
    this.model = options.model || 'claude-sonnet-4-5-20250929';
    this.budget = options.budget || 1.00; // Default $1 budget warning
    this.element = null;
    this.visible = false;

    // Pricing per 1M tokens (approximate, may need updates)
    this.pricing = {
      'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
      'claude-opus-4-5-20251101': { input: 15.00, output: 75.00 },
      'claude-haiku-3-5-20241022': { input: 0.25, output: 1.25 },
      'default': { input: 3.00, output: 15.00 }
    };

    this.createUI();
  }

  getPricing() {
    return this.pricing[this.model] || this.pricing['default'];
  }

  calculateCost(inputTokens, outputTokens) {
    const pricing = this.getPricing();
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  formatCost(cost) {
    if (cost < 0.01) {
      return `$${(cost * 100).toFixed(3)}c`;
    }
    return `$${cost.toFixed(4)}`;
  }

  formatTokens(tokens) {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  }

  getBudgetStatus() {
    const percentage = (this.cumulativeCost / this.budget) * 100;
    if (percentage >= 100) return 'exceeded';
    if (percentage >= 80) return 'warning';
    return 'ok';
  }

  createUI() {
    this.element = document.createElement('div');
    this.element.className = 'agent-cost-display';
    this.render();
  }

  render() {
    const budgetStatus = this.getBudgetStatus();
    const budgetPercentage = Math.min((this.cumulativeCost / this.budget) * 100, 100);

    this.element.innerHTML = `
      <div class="cost-display-inner ${this.visible ? 'visible' : ''}">
        <div class="cost-section current-usage">
          <div class="usage-row">
            <span class="usage-label">${icons.arrowUp({ size: 12 })} Input</span>
            <span class="usage-value">${this.formatTokens(this.inputTokens)}</span>
          </div>
          <div class="usage-row">
            <span class="usage-label">${icons.arrowDown({ size: 12 })} Output</span>
            <span class="usage-value">${this.formatTokens(this.outputTokens)}</span>
          </div>
          <div class="usage-row cost-row">
            <span class="usage-label">Cost</span>
            <span class="usage-value">${this.formatCost(this.lastCost)}</span>
          </div>
        </div>
        <div class="cost-divider"></div>
        <div class="cost-section cumulative-usage">
          <div class="usage-row">
            <span class="usage-label">Session Total</span>
            <span class="usage-value total-cost ${budgetStatus}">${this.formatCost(this.cumulativeCost)}</span>
          </div>
          <div class="budget-bar">
            <div class="budget-fill ${budgetStatus}" style="width: ${budgetPercentage}%"></div>
          </div>
          ${budgetStatus !== 'ok' ? `
            <div class="budget-warning ${budgetStatus}">
              ${icons.alertTriangle({ size: 12 })}
              ${budgetStatus === 'exceeded' ? 'Budget exceeded' : 'Approaching budget limit'}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.element.className = `agent-cost-display ${this.visible ? 'visible' : ''}`;
  }

  update(usage) {
    if (!usage) return;

    // Update current message tokens
    this.inputTokens = usage.input_tokens || usage.inputTokens || 0;
    this.outputTokens = usage.output_tokens || usage.outputTokens || 0;

    // Calculate cost for this message
    this.lastCost = this.calculateCost(this.inputTokens, this.outputTokens);

    // Update cumulative totals
    this.cumulativeInputTokens += this.inputTokens;
    this.cumulativeOutputTokens += this.outputTokens;
    this.cumulativeCost += this.lastCost;

    this.render();
  }

  updateFromResult(result) {
    if (!result) return;

    // Handle SDK result format
    if (result.usage) {
      this.update(result.usage);
    }

    // Handle direct cost from SDK
    if (result.cost !== undefined) {
      this.lastCost = result.cost;
      this.cumulativeCost += result.cost;
      this.render();
    }
  }

  setModel(model) {
    this.model = model;
    this.render();
  }

  setBudget(budget) {
    this.budget = budget;
    this.render();
  }

  show() {
    this.visible = true;
    this.render();
  }

  hide() {
    this.visible = false;
    this.render();
  }

  reset() {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cumulativeInputTokens = 0;
    this.cumulativeOutputTokens = 0;
    this.cumulativeCost = 0;
    this.lastCost = 0;
    this.render();
  }

  getElement() {
    return this.element;
  }
}
