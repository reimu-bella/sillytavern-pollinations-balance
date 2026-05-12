const MODULE_NAME = 'pollinations_balance';
const EXTENSION_NAME = 'sillytavern-pollinations-balance';
const EXTENSION_FOLDER = `third-party/${EXTENSION_NAME}`;
const BALANCE_ENDPOINT = 'https://gen.pollinations.ai/account/balance';

const defaultSettings = Object.freeze({
    apiKey: '',
    lastBalance: null,
    lastUpdatedAt: '',
    lastError: '',
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

    if (settings.lastError) {
        setStatus(settings.lastError, 'error');
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
    settings.apiKey = elements.apiKeyInput.value.trim();
    settings.lastError = '';
    saveSettings();
    renderState();
}

async function refreshBalance(source = 'manual') {
    const settings = getSettings();
    const apiKey = getApiKey();

    if (!apiKey) {
        settings.lastError = '';
        settings.lastBalance = null;
        settings.lastUpdatedAt = '';
        renderState();
        return;
    }

    if (isRefreshing) {
        return;
    }

    setRefreshState(true);
    setStatus(source === 'generation' ? 'Refreshing after generation started...' : 'Refreshing balance...');

    try {
        const response = await fetch(BALANCE_ENDPOINT, {
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
                throw new Error('Balance response was not valid JSON.');
            }
        }

        if (!response.ok) {
            const detail = data?.error?.message || data?.message || response.statusText;
            throw new Error(`Balance request failed (${response.status})${detail ? `: ${detail}` : ''}`);
        }

        const balance = Number(data?.balance);

        if (!Number.isFinite(balance)) {
            throw new Error('Balance response did not include a numeric balance.');
        }

        settings.lastBalance = balance;
        settings.lastUpdatedAt = new Date().toISOString();
        settings.lastError = '';
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
