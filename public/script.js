const STORAGE_KEYS = {
    token: 'uss_token',
    profile: 'uss_user_profile',
    matchRequest: 'uss_match_request',
    notification: 'uss_notification_mode',
    timer: 'uss_conversation_timer'
};

const DEFAULT_PROFILE = {
    name: '',
    email: '',
    interests: [],
    personalityTags: [],
    mood: 'Neutral',
    intent: 'I want to talk',
    availability: ['Evening'],
    connectionTypes: ['Coffee Chat'],
    anonymousMode: false
};

const COMMUNITY_CATALOG = [
    {
        title: 'Late Night Talks',
        subtitle: 'Small room for people who feel more open after dark.',
        seats: '6 seats',
        when: 'Evening',
        match: (profile) => profile.availability.includes('Evening') || profile.mood === 'Lonely'
    },
    {
        title: 'Students Stressed',
        subtitle: 'Quiet company and grounding conversations.',
        seats: '8 seats',
        when: 'Afternoon',
        match: (profile) => profile.mood === 'Stressed' || profile.connectionTypes.includes('Study Session')
    },
    {
        title: 'Gym Buddies',
        subtitle: 'Accountability partners with low-pressure check-ins.',
        seats: '5 seats',
        when: 'Morning',
        match: (profile) => profile.connectionTypes.includes('Gym Buddy') || profile.interests.includes('Fitness')
    },
    {
        title: 'Builders Unplugged',
        subtitle: 'Tech-minded people who want real conversation offline.',
        seats: '7 seats',
        when: 'Midday',
        match: (profile) => profile.interests.includes('Tech') || profile.interests.includes('Startups')
    },
    {
        title: 'Coffee and Books',
        subtitle: 'A tiny reading circle with calm energy.',
        seats: '6 seats',
        when: 'Midday',
        match: (profile) => profile.interests.includes('Books') || profile.connectionTypes.includes('Coffee Chat')
    },
    {
        title: 'Walk and Reset',
        subtitle: 'Slow walks for people who need a lighter day.',
        seats: '5 seats',
        when: 'Afternoon',
        match: (profile) => profile.connectionTypes.includes('Walk') || profile.mood === 'Neutral'
    }
];

const ICEBREAKER_LIBRARY = [
    (profile, match) => `What first pulled you into ${match?.sharedInterest || profile.interests[0] || 'this interest'}?`,
    (profile) => `What kind of energy feels easiest for you right now: calm, playful, or focused?`,
    (profile, match) => `If this ${match?.meetingFormat || 'meetup'} goes well, what would make you want a second one?`,
    () => 'What is one thing you wish people understood about your week without you having to explain it all?',
    (profile) => `What usually helps you feel a little more human again when life feels ${profile.mood.toLowerCase()}?`,
    () => 'Do you prefer deep questions right away, or a lighter start and then depth later?'
];

let profileState = { ...DEFAULT_PROFILE };
let pollingInterval = null;
let promptIndex = 0;

function normalizeList(values) {
    if (!Array.isArray(values)) return [];

    const seen = new Map();
    values.forEach((value) => {
        if (typeof value !== 'string') return;
        const cleaned = value.trim();
        if (!cleaned) return;
        const lookup = cleaned.toLowerCase();
        if (!seen.has(lookup)) {
            seen.set(lookup, cleaned);
        }
    });

    return Array.from(seen.values());
}

function readJsonStorage(key) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    } catch (error) {
        console.error(`Failed to read ${key}`, error);
        return null;
    }
}

function writeJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function parseBoolean(value) {
    return value === true || value === 1 || value === '1';
}

function normalizeProfile(rawProfile) {
    if (!rawProfile || typeof rawProfile !== 'object') {
        return { ...DEFAULT_PROFILE };
    }

    const interests = normalizeList(Array.isArray(rawProfile.interests) ? rawProfile.interests : safeParseArray(rawProfile.interests));
    const personalityTags = normalizeList(Array.isArray(rawProfile.personalityTags) ? rawProfile.personalityTags : safeParseArray(rawProfile.personalityTags));
    const availability = normalizeList(Array.isArray(rawProfile.availability) ? rawProfile.availability : safeParseArray(rawProfile.availability));
    const connectionTypes = normalizeList(Array.isArray(rawProfile.connectionTypes) ? rawProfile.connectionTypes : safeParseArray(rawProfile.connectionTypes));

    return {
        ...DEFAULT_PROFILE,
        name: typeof rawProfile.name === 'string' ? rawProfile.name : '',
        email: typeof rawProfile.email === 'string' ? rawProfile.email : '',
        interests,
        personalityTags,
        mood: typeof rawProfile.mood === 'string' && rawProfile.mood.trim() ? rawProfile.mood : DEFAULT_PROFILE.mood,
        intent: typeof rawProfile.intent === 'string' && rawProfile.intent.trim() ? rawProfile.intent : DEFAULT_PROFILE.intent,
        availability: availability.length > 0 ? availability : DEFAULT_PROFILE.availability,
        connectionTypes: connectionTypes.length > 0 ? connectionTypes : DEFAULT_PROFILE.connectionTypes,
        anonymousMode: parseBoolean(rawProfile.anonymousMode)
    };
}

function safeParseArray(value) {
    if (!value) return [];

    try {
        return JSON.parse(value);
    } catch (error) {
        return [];
    }
}

function persistDraftProfile() {
    writeJsonStorage(STORAGE_KEYS.matchRequest, profileState);
}

function logout(event) {
    if (event) {
        event.preventDefault();
    }

    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.profile);
    localStorage.removeItem(STORAGE_KEYS.matchRequest);
    window.location.href = '/login.html';
}

function redirectToDetails() {
    window.location.replace('/index.html');
}

function redirectToLogin() {
    window.location.replace('/login.html');
}

function renderPillList(containerId, values, removable = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.replaceChildren();

    values.forEach((value) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = removable ? 'pill pill-remove' : 'pill';
        pill.textContent = removable ? `${value} x` : value;
        if (removable) {
            pill.dataset.removeInterest = value;
        }
        container.appendChild(pill);
    });
}

function setInputValues() {
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const anonymousCheckbox = document.getElementById('anonymous-mode');

    if (nameInput) nameInput.value = profileState.name;
    if (emailInput) emailInput.value = profileState.email;
    if (anonymousCheckbox) anonymousCheckbox.checked = profileState.anonymousMode;
}

function updateChoiceSelectionStyles() {
    document.querySelectorAll('[data-choice-group]').forEach((element) => {
        const { choiceGroup, choiceValue, choiceMode } = element.dataset;

        let selected = false;
        if (choiceMode === 'single') {
            selected = profileState[choiceGroup] === choiceValue;
        } else {
            selected = Array.isArray(profileState[choiceGroup]) && profileState[choiceGroup].includes(choiceValue);
        }

        element.classList.toggle('is-selected', selected);
    });
}

function updateCommunityPreviews(targetId) {
    const container = document.getElementById(targetId);
    if (!container) return;

    const suggestions = COMMUNITY_CATALOG
        .filter(entry => entry.match(profileState))
        .slice(0, 3);

    const finalSuggestions = suggestions.length > 0 ? suggestions : COMMUNITY_CATALOG.slice(0, 3);
    container.innerHTML = finalSuggestions.map((entry) => `
        <article class="community-card">
            <div class="community-meta">
                <span>${entry.seats}</span>
                <span>${entry.when}</span>
            </div>
            <h3>${entry.title}</h3>
            <p>${entry.subtitle}</p>
        </article>
    `).join('');
}

function renderDetailsPage() {
    setInputValues();
    renderPillList('interest-pill-list', profileState.interests, true);
    updateChoiceSelectionStyles();
    updateCommunityPreviews('community-preview');
}

function addInterestFromInput() {
    const input = document.getElementById('interest-input');
    if (!input) return;

    const nextValue = input.value.trim();
    if (!nextValue) return;

    profileState.interests = normalizeList([...profileState.interests, nextValue]);
    input.value = '';
    persistDraftProfile();
    renderDetailsPage();
}

function toggleMultipleChoice(group, value) {
    const currentValues = Array.isArray(profileState[group]) ? profileState[group] : [];
    const exists = currentValues.includes(value);

    profileState[group] = exists
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];
}

function bindDetailsInteractions() {
    document.getElementById('add-interest-btn')?.addEventListener('click', addInterestFromInput);
    document.getElementById('interest-input')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addInterestFromInput();
        }
    });

    document.getElementById('interest-pill-list')?.addEventListener('click', (event) => {
        const removeTarget = event.target.closest('[data-remove-interest]');
        if (!removeTarget) return;

        profileState.interests = profileState.interests.filter((interest) => interest !== removeTarget.dataset.removeInterest);
        persistDraftProfile();
        renderDetailsPage();
    });

    document.querySelectorAll('[data-choice-group]').forEach((button) => {
        button.addEventListener('click', () => {
            const group = button.dataset.choiceGroup;
            const value = button.dataset.choiceValue;
            const mode = button.dataset.choiceMode || 'multiple';
            const action = button.dataset.choiceAction || 'toggle';

            if (group === 'interests' && action === 'add') {
                profileState.interests = normalizeList([...profileState.interests, value]);
            } else if (mode === 'single') {
                profileState[group] = value;
            } else {
                toggleMultipleChoice(group, value);
            }

            persistDraftProfile();
            renderDetailsPage();
        });
    });

    document.getElementById('anonymous-mode')?.addEventListener('change', (event) => {
        profileState.anonymousMode = event.target.checked;
        persistDraftProfile();
    });

    document.getElementById('details-form')?.addEventListener('submit', (event) => {
        event.preventDefault();

        profileState.name = document.getElementById('name').value.trim();
        profileState.email = document.getElementById('email').value.trim();

        if (!profileState.name || !profileState.email || profileState.interests.length === 0) {
            alert('Please add your name, email, and at least one interest.');
            return;
        }

        writeJsonStorage(STORAGE_KEYS.matchRequest, profileState);
        writeJsonStorage(STORAGE_KEYS.profile, profileState);
        window.location.href = '/matching.html';
    });
}

function createSummaryPills() {
    renderPillList('summary-interests', profileState.interests);
    renderPillList('summary-personality', profileState.personalityTags);
    renderPillList('summary-availability', profileState.availability);
    renderPillList('summary-connection-types', profileState.connectionTypes);
}

function renderMatchingSummary() {
    const nameNode = document.getElementById('summary-name');
    const emailNode = document.getElementById('summary-email');
    const moodNode = document.getElementById('summary-mood');
    const intentNode = document.getElementById('summary-intent');
    const anonymousStatus = document.getElementById('anonymous-status');

    if (nameNode) nameNode.innerText = profileState.name || '-';
    if (emailNode) emailNode.innerText = profileState.email || '-';
    if (moodNode) moodNode.innerText = profileState.mood;
    if (intentNode) intentNode.innerText = profileState.intent;
    if (anonymousStatus) anonymousStatus.innerText = profileState.anonymousMode ? 'Anonymous until you feel ready' : 'Visible to your match';

    createSummaryPills();
    updateCommunityPreviews('community-suggestions');
}

function getCurrentMatchDetails() {
    const request = readJsonStorage(STORAGE_KEYS.matchRequest);
    return request && typeof request === 'object' ? request : null;
}

function updatePrompt(matchDetails = null) {
    const promptNode = document.getElementById('icebreaker-text');
    if (!promptNode) return;

    const promptFactory = ICEBREAKER_LIBRARY[promptIndex % ICEBREAKER_LIBRARY.length];
    promptNode.innerText = promptFactory(profileState, matchDetails);
    promptIndex += 1;
}

function getTimerValue() {
    return localStorage.getItem(STORAGE_KEYS.timer) || '25';
}

function updateOfflinePlan(matchDetails = null) {
    const copyNode = document.getElementById('offline-plan-copy');
    if (!copyNode) return;

    const timer = getTimerValue();
    const format = matchDetails?.meetingFormat || profileState.connectionTypes[0] || 'meetup';
    copyNode.innerText = `Aim for a ${timer}-minute ${format.toLowerCase()} and leave room for a natural follow-up if the energy feels right.`;
}

function updateSettingSelectionStyles() {
    document.querySelectorAll('[data-setting-group]').forEach((button) => {
        const group = button.dataset.settingGroup;
        const key = group === 'notification' ? STORAGE_KEYS.notification : STORAGE_KEYS.timer;
        const selectedValue = localStorage.getItem(key) || (group === 'notification' ? 'reply-only' : '25');
        button.classList.toggle('is-selected', selectedValue === button.dataset.settingValue);
    });
}

function bindMatchingInteractions() {
    document.getElementById('refresh-prompt-btn')?.addEventListener('click', () => updatePrompt());

    document.querySelectorAll('[data-setting-group]').forEach((button) => {
        button.addEventListener('click', () => {
            const group = button.dataset.settingGroup;
            const storageKey = group === 'notification' ? STORAGE_KEYS.notification : STORAGE_KEYS.timer;
            localStorage.setItem(storageKey, button.dataset.settingValue);
            updateSettingSelectionStyles();
            updateOfflinePlan();
        });
    });
}

function showMatchResult(matchDetails) {
    const loadingState = document.getElementById('loading-state');
    const matchResult = document.getElementById('match-result');

    if (pollingInterval) {
        window.clearInterval(pollingInterval);
        pollingInterval = null;
    }

    loadingState?.classList.add('hidden');
    matchResult?.classList.remove('hidden');

    document.getElementById('match-name').innerText = matchDetails.partnerName;
    document.getElementById('match-interest').innerText = matchDetails.sharedInterest;
    document.getElementById('match-place').innerText = matchDetails.meetingPlace;
    document.getElementById('match-time').innerText = matchDetails.meetingTime;
    document.getElementById('match-summary').innerText = matchDetails.matchSummary || 'Shared interests and aligned energy made this match click.';
    document.getElementById('match-format-badge').innerText = matchDetails.meetingFormat || 'Meetup';

    updatePrompt(matchDetails);
    updateOfflinePlan(matchDetails);
}

async function checkStatus(email) {
    try {
        const response = await fetch(`/api/status/${encodeURIComponent(email)}`);
        if (!response.ok) {
            return;
        }

        const data = await response.json();
        if (data.matched && data.matchDetails) {
            showMatchResult(data.matchDetails);
        }
    } catch (error) {
        console.error('Polling error', error);
    }
}

async function beginMatching() {
    const statusCopy = document.getElementById('matching-status-copy');

    try {
        const response = await fetch('/api/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileState)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Unable to start matching right now.');
        }

        statusCopy.innerText = data.matched
            ? 'Match approved. Finalizing the best place and time for both of you.'
            : 'You can step away now. We are still looking for someone with shared interests, mood fit, and overlapping availability.';

        await checkStatus(profileState.email);

        if (!pollingInterval) {
            pollingInterval = window.setInterval(() => checkStatus(profileState.email), 3000);
        }
    } catch (error) {
        console.error(error);
        statusCopy.innerText = error.message || 'Unable to start matching right now.';
    }
}

function initializeDetailsPage() {
    const storedProfile = normalizeProfile(readJsonStorage(STORAGE_KEYS.profile));
    const storedRequest = normalizeProfile(readJsonStorage(STORAGE_KEYS.matchRequest));
    profileState = {
        ...DEFAULT_PROFILE,
        ...storedProfile,
        ...storedRequest,
        interests: storedRequest.interests.length > 0 ? storedRequest.interests : storedProfile.interests,
        personalityTags: storedRequest.personalityTags.length > 0 ? storedRequest.personalityTags : storedProfile.personalityTags,
        availability: storedRequest.availability.length > 0 ? storedRequest.availability : storedProfile.availability,
        connectionTypes: storedRequest.connectionTypes.length > 0 ? storedRequest.connectionTypes : storedProfile.connectionTypes
    };

    renderDetailsPage();
    bindDetailsInteractions();
}

function initializeMatchingPage() {
    const requestProfile = normalizeProfile(readJsonStorage(STORAGE_KEYS.matchRequest));
    const fallbackProfile = normalizeProfile(readJsonStorage(STORAGE_KEYS.profile));
    profileState = {
        ...DEFAULT_PROFILE,
        ...fallbackProfile,
        ...requestProfile,
        interests: requestProfile.interests.length > 0 ? requestProfile.interests : fallbackProfile.interests,
        personalityTags: requestProfile.personalityTags.length > 0 ? requestProfile.personalityTags : fallbackProfile.personalityTags,
        availability: requestProfile.availability.length > 0 ? requestProfile.availability : fallbackProfile.availability,
        connectionTypes: requestProfile.connectionTypes.length > 0 ? requestProfile.connectionTypes : fallbackProfile.connectionTypes
    };

    if (!profileState.name || !profileState.email || profileState.interests.length === 0) {
        redirectToDetails();
        return;
    }

    updateSettingSelectionStyles();
    renderMatchingSummary();
    updatePrompt(getCurrentMatchDetails());
    updateOfflinePlan();
    bindMatchingInteractions();
    beginMatching();
}

document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem(STORAGE_KEYS.token)) {
        redirectToLogin();
        return;
    }

    if (document.getElementById('details-form')) {
        initializeDetailsPage();
    }

    if (document.getElementById('summary-name')) {
        initializeMatchingPage();
    }
});
