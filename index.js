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
        balanceValue: document.getElementById('pollinations_balance_value'),
        tierValue: document.getElementById('pollinations_balance_tier_value'),
        paidValue: document.getElementById('pollinations_balance_paid_value'),
        tierMeta: document.getElementById('pollinations_balance_tier_meta'),
        status: document.getElementById('pollinations_balance_status'),
    };
}

function formatBalance(balance) {
    if (typeof balance !== 'number' || !Number.isFinite(balance)) {
        return 'Not loaded';
    }

    return balance.toLocaleString(undefined, {
        maximumFractionDigits: 4,
    });
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
    if (!elements.status) {
        return;
    }

    elements.status.textContent = message;
    elements.status.dataset.state = state;
}

function renderTierEstimate(settings) {
    const estimate = settings.lastTierEstimate;

    if (!estimate) {
        if (elements.tierValue) {
            elements.tierValue.textContent = 'Not estimated';
        }

        if (elements.paidValue) {
            elements.paidValue.textContent = 'Not estimated';
        }

        if (elements.tierMeta) {
            elements.tierMeta.textContent = settings.lastEstimateError || 'Requires profile and usage permissions.';
            elements.tierMeta.dataset.state = settings.lastEstimateError ? 'error' : '';
        }

        return;
    }

    const paidEstimate = typeof settings.lastBalance === 'number'
        ? Math.max(settings.lastBalance - estimate.remaining, 0)
        : null;

    if (elements.tierValue) {
        elements.tierValue.textContent = `${formatBalance(estimate.remaining)} / ${formatBalance(estimate.allowance)}`;
    }

    if (elements.paidValue) {
        elements.paidValue.textContent = formatBalance(paidEstimate);
    }

    if (elements.tierMeta) {
        const resetTime = formatUpdatedAt(estimate.windowEnd);
        elements.tierMeta.textContent = `${estimate.tier} tier, ${formatBalance(estimate.used)} estimated tier pollen used this hour. Resets around ${resetTime}.`;
        elements.tierMeta.dataset.state = '';
    }
}

function setRefreshState(refreshing) {
    isRefreshing = refreshing;

    if (elements.refreshButton) {
        elements.refreshButton.disabled = refreshing;
    }
}

function renderState() {
    const settings = getSettings();

    if (elements.apiKeyInput) {
        elements.apiKeyInput.value = settings.apiKey;
    }

    if (elements.balanceValue) {
        elements.balanceValue.textContent = formatBalance(settings.lastBalance);
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
    setStatus(source === 'generation' ? 'Refreshing after generation started...' : 'Refreshing balance...');

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
        cacheElements();
        renderState();
        return;
    }

    const settingsHtml = await renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings');
    document.getElementById('extensions_settings2')?.insertAdjacentHTML('beforeend', settingsHtml);
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
    eventSource.on(event_types.GENERATION_STARTED, () => {
        void refreshBalance('generation');
    });
}

initialize();
