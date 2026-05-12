const MODULE_NAME = 'pollinations_balance';
const EXTENSION_NAME = 'sillytavern-pollinations-balance';
const EXTENSION_FOLDER = `third-party/${EXTENSION_NAME}`;
const BALANCE_ENDPOINT = 'https://gen.pollinations.ai/account/balance';
const PROFILE_ENDPOINT = 'https://gen.pollinations.ai/account/profile';
const USAGE_ENDPOINT = 'https://gen.pollinations.ai/account/usage';
const TIER_HOURLY_ALLOWANCES = Object.freeze({
    spore: 0.01,
    seed: 0.15,
    flower: 0.4,
});

const defaultSettings = Object.freeze({
    apiKey: '',
    lastBalance: null,
    lastTierEstimate: null,
    lastUpdatedAt: '',
    lastError: '',
    lastEstimateError: '',
});

let isRefreshing = false;
let elements = {};

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    return extensionSettings[MODULE_NAME];
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

function getApiKey() {
    return getSettings().apiKey.trim();
}

function cacheElements() {
    elements = {
        root: document.getElementById('pollinations_balance_settings'),
        apiKeyInput: document.getElementById('pollinations_balance_api_key'),
        saveButton: document.getElementById('pollinations_balance_save'),
        refreshButton: document.getElementById('pollinations_balance_refresh'),
        floatingRefreshButton: document.getElementById('pollinations_balance_floating_refresh'),
        floatingToggle: document.getElementById('pollinations_balance_floating_toggle'),
        floatingPanel: document.getElementById('pollinations_balance_floating_panel'),
        balanceValues: document.querySelectorAll('[data-pollinations-balance-total]'),
        tierValues: document.querySelectorAll('[data-pollinations-balance-tier]'),
        paidValues: document.querySelectorAll('[data-pollinations-balance-paid]'),
        tierMetas: document.querySelectorAll('[data-pollinations-balance-tier-meta]'),
        statusElements: document.querySelectorAll('[data-pollinations-balance-status]'),
    };
}

function setText(targets, text) {
    for (const target of targets || []) {
        target.textContent = text;
    }
}

function setDataState(targets, state = '') {
    for (const target of targets || []) {
        target.dataset.state = state;
    }
}

function createFloatingBalanceUi() {
    if (document.getElementById('pollinations_balance_floating_toggle')) {
        return;
    }

    const toggle = document.createElement('button');
    toggle.id = 'pollinations_balance_floating_toggle';
    toggle.className = 'pollinations-balance-floating-toggle';
    toggle.type = 'button';
    toggle.title = 'Show Pollinations balance';
    toggle.setAttribute('aria-controls', 'pollinations_balance_floating_panel');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Pollen';

    const panel = document.createElement('div');
    panel.id = 'pollinations_balance_floating_panel';
    panel.className = 'pollinations-balance-floating-panel';
    panel.hidden = true;
    panel.innerHTML = `
        <div class="pollinations-balance-floating-header">
            <strong>Pollinations Balance</strong>
            <button id="pollinations_balance_floating_refresh" class="pollinations-balance-floating-refresh" type="button">
                Refresh
            </button>
        </div>
        <div class="pollinations-balance-summary pollinations-balance-floating-summary">
            <div class="pollinations-balance-row">
                <span class="pollinations-balance-label">Total</span>
                <span class="pollinations-balance-value" data-pollinations-balance-total>Not loaded</span>
            </div>
            <div class="pollinations-balance-row">
                <span class="pollinations-balance-label">Tier left</span>
                <span class="pollinations-balance-value" data-pollinations-balance-tier>Not estimated</span>
            </div>
            <div class="pollinations-balance-row">
                <span class="pollinations-balance-label">Paid/other</span>
                <span class="pollinations-balance-value" data-pollinations-balance-paid>Not estimated</span>
            </div>
            <small class="pollinations-balance-meta" data-pollinations-balance-tier-meta>
                Requires profile and usage permissions.
            </small>
        </div>
        <div class="pollinations-balance-status pollinations-balance-floating-status" data-pollinations-balance-status aria-live="polite">
            Add an API key in extension settings.
        </div>
    `;

    toggle.addEventListener('click', () => {
        const shouldOpen = panel.hidden;
        panel.hidden = !shouldOpen;
        toggle.setAttribute('aria-expanded', String(shouldOpen));
    });

    panel.querySelector('#pollinations_balance_floating_refresh')?.addEventListener('click', () => {
        void refreshBalance('manual');
    });

    document.body.append(toggle, panel);
}

function formatBalance(balance) {
    if (typeof balance !== 'number' || !Number.isFinite(balance)) {
        return 'Not loaded';
    }

    return balance.toLocaleString(undefined, {
        maximumFractionDigits: 4,
    });
}

function formatTierButtonLabel(estimate) {
    if (!estimate) {
        return 'Pollen';
    }

    return `${formatBalance(estimate.remaining)} / ${formatBalance(estimate.allowance)} pol`;
}

function getCurrentHourWindow(now = new Date()) {
    const windowStart = new Date(now);
    windowStart.setUTCMinutes(0, 0, 0);

    const windowEnd = new Date(windowStart);
    windowEnd.setUTCHours(windowEnd.getUTCHours() + 1);

    return { windowStart, windowEnd };
}

function parseUsageTimestamp(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    let normalized = value.trim();

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
        normalized = `${normalized.replace(' ', 'T')}Z`;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatUpdatedAt(value) {
    if (!value) {
        return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toLocaleString();
}

function setStatus(message, state = '') {
    setText(elements.statusElements, message);
    setDataState(elements.statusElements, state);
}

function renderTierEstimate(settings) {
    const estimate = settings.lastTierEstimate;

    if (!estimate) {
        setText(elements.tierValues, 'Not estimated');
        setText(elements.paidValues, 'Not estimated');
        setText(elements.tierMetas, settings.lastEstimateError || 'Requires profile and usage permissions.');
        setDataState(elements.tierMetas, settings.lastEstimateError ? 'error' : '');

        return;
    }

    const paidEstimate = typeof settings.lastBalance === 'number'
        ? Math.max(settings.lastBalance - estimate.remaining, 0)
        : null;

    setText(elements.tierValues, `${formatBalance(estimate.remaining)} / ${formatBalance(estimate.allowance)}`);
    setText(elements.paidValues, formatBalance(paidEstimate));

    const resetTime = formatUpdatedAt(estimate.windowEnd);
    setText(elements.tierMetas, `${estimate.tier} tier, ${formatBalance(estimate.used)} estimated tier pollen used this hour. Resets around ${resetTime}.`);
    setDataState(elements.tierMetas, '');
}

function setRefreshState(refreshing) {
    isRefreshing = refreshing;

    for (const button of [elements.refreshButton, elements.floatingRefreshButton]) {
        if (button) {
            button.disabled = refreshing;
        }
    }

    if (elements.floatingToggle) {
        elements.floatingToggle.dataset.state = refreshing ? 'loading' : '';
    }
}

function renderState() {
    const settings = getSettings();

    if (elements.apiKeyInput) {
        elements.apiKeyInput.value = settings.apiKey;
    }

    setText(elements.balanceValues, formatBalance(settings.lastBalance));

    if (elements.floatingToggle) {
        elements.floatingToggle.textContent = formatTierButtonLabel(settings.lastTierEstimate);
    }

    renderTierEstimate(settings);

    if (settings.lastError) {
        setStatus(settings.lastError, 'error');
        return;
    }

    if (settings.lastEstimateError && settings.lastUpdatedAt) {
        setStatus(`Total updated ${formatUpdatedAt(settings.lastUpdatedAt)}. Tier estimate unavailable: ${settings.lastEstimateError}`, 'error');
        return;
    }

    if (settings.lastUpdatedAt) {
        setStatus(`Last updated ${formatUpdatedAt(settings.lastUpdatedAt)}.`, 'success');
        return;
    }

    setStatus(settings.apiKey ? 'Balance has not been checked yet.' : 'Add an API key to check your balance.');
}

function saveApiKeyFromInput() {
    if (!elements.apiKeyInput) {
        return;
    }

    const settings = getSettings();
    const apiKey = elements.apiKeyInput.value.trim();

    if (settings.apiKey !== apiKey) {
        settings.lastBalance = null;
        settings.lastTierEstimate = null;
        settings.lastUpdatedAt = '';
    }

    settings.apiKey = apiKey;
    settings.lastError = '';
    settings.lastEstimateError = '';
    saveSettings();
    renderState();
}

async function fetchAccountJson(endpoint, apiKey, label) {
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        cache: 'no-store',
    });
    const responseText = await response.text();
    let data = {};

    try {
        data = responseText ? JSON.parse(responseText) : {};
    } catch {
        if (response.ok) {
            throw new Error(`${label} response was not valid JSON.`);
        }
    }

    if (!response.ok) {
        const detail = data?.error?.message || data?.message || response.statusText;
        throw new Error(`${label} request failed (${response.status})${detail ? `: ${detail}` : ''}`);
    }

    return data;
}

function estimateTierBalance(profile, usageRecords, now = new Date()) {
    const tier = String(profile?.tier || '').trim().toLowerCase();
    const allowance = TIER_HOURLY_ALLOWANCES[tier];

    if (!Number.isFinite(allowance)) {
        throw new Error(`Unknown or unsupported Pollinations tier "${profile?.tier || 'unknown'}".`);
    }

    const { windowStart, windowEnd } = getCurrentHourWindow(now);
    const tierUsage = usageRecords.filter((record) => {
        if (String(record?.meter_source || '').toLowerCase() !== 'tier') {
            return false;
        }

        const timestamp = parseUsageTimestamp(record?.timestamp);
        return timestamp && timestamp >= windowStart && timestamp < windowEnd;
    });
    const used = tierUsage.reduce((total, record) => {
        const cost = Number(record?.cost_usd);
        return Number.isFinite(cost) ? total + cost : total;
    }, 0);

    return {
        tier,
        allowance,
        used,
        remaining: Math.max(allowance - used, 0),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        usageRecordCount: tierUsage.length,
    };
}

async function refreshBalance(source = 'manual') {
    const settings = getSettings();
    const apiKey = getApiKey();

    if (!apiKey) {
        settings.lastError = '';
        settings.lastBalance = null;
        settings.lastTierEstimate = null;
        settings.lastUpdatedAt = '';
        settings.lastEstimateError = '';
        renderState();
        return;
    }

    if (isRefreshing) {
        return;
    }

    setRefreshState(true);
    setStatus(source === 'generation' ? 'Refreshing after generation completed...' : 'Refreshing balance...');

    try {
        const balanceData = await fetchAccountJson(BALANCE_ENDPOINT, apiKey, 'Balance');
        const balance = Number(balanceData?.balance);

        if (!Number.isFinite(balance)) {
            throw new Error('Balance response did not include a numeric balance.');
        }

        settings.lastBalance = balance;
        settings.lastUpdatedAt = new Date().toISOString();
        settings.lastError = '';

        const [profileResult, usageResult] = await Promise.allSettled([
            fetchAccountJson(PROFILE_ENDPOINT, apiKey, 'Profile'),
            fetchAccountJson(USAGE_ENDPOINT, apiKey, 'Usage'),
        ]);

        if (profileResult.status === 'fulfilled' && usageResult.status === 'fulfilled') {
            const usageRecords = Array.isArray(usageResult.value?.usage) ? usageResult.value.usage : [];
            settings.lastTierEstimate = estimateTierBalance(profileResult.value, usageRecords);
            settings.lastEstimateError = '';
        } else {
            const error = profileResult.status === 'rejected' ? profileResult.reason : usageResult.reason;
            settings.lastTierEstimate = null;
            settings.lastEstimateError = error instanceof Error ? error.message : String(error);
        }

        saveSettings();
    } catch (error) {
        console.error('[Pollinations Balance] Failed to refresh balance:', error);
        settings.lastError = error instanceof Error ? error.message : String(error);
        saveSettings();
    } finally {
        setRefreshState(false);
        renderState();
    }
}

function bindEvents() {
    elements.saveButton?.addEventListener('click', () => {
        saveApiKeyFromInput();
        void refreshBalance('manual');
    });

    elements.refreshButton?.addEventListener('click', () => {
        saveApiKeyFromInput();
        void refreshBalance('manual');
    });

    elements.apiKeyInput?.addEventListener('change', saveApiKeyFromInput);
}

async function initializeSettingsUi() {
    const { renderExtensionTemplateAsync } = SillyTavern.getContext();

    if (document.getElementById('pollinations_balance_settings')) {
        createFloatingBalanceUi();
        cacheElements();
        renderState();
        return;
    }

    const settingsHtml = await renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings');
    document.getElementById('extensions_settings2')?.insertAdjacentHTML('beforeend', settingsHtml);
    createFloatingBalanceUi();
    cacheElements();
    bindEvents();
    renderState();

    if (getApiKey()) {
        void refreshBalance('startup');
    }
}

function initialize() {
    const { eventSource, event_types } = SillyTavern.getContext();

    eventSource.on(event_types.APP_READY, initializeSettingsUi);
    eventSource.on(event_types.GENERATION_ENDED, () => {
        void refreshBalance('generation');
    });
}

initialize();
