require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configure from .env
const dbDirectory = process.env.SQLITE_DB_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.RENDER_DISK_PATH;
const dbPath = process.env.SQLITE_DB_PATH || (dbDirectory ? path.join(dbDirectory, 'database.sqlite') : './database.sqlite');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const PORT = process.env.PORT || 3000;

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error(err.message);
    console.log(`Connected to the SQLite database at ${dbPath}`);
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        interests TEXT NOT NULL,
        personalityTags TEXT NOT NULL DEFAULT '[]',
        mood TEXT DEFAULT 'Neutral',
        intent TEXT DEFAULT 'I want to talk',
        availability TEXT NOT NULL DEFAULT '[]',
        connectionTypes TEXT NOT NULL DEFAULT '[]',
        anonymousMode INTEGER NOT NULL DEFAULT 0,
        matched BOOLEAN DEFAULT 0,
        partnerName TEXT,
        partnerEmail TEXT,
        sharedInterest TEXT,
        meetingPlace TEXT,
        meetingTime TEXT,
        meetingFormat TEXT,
        matchSummary TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        displayName TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Community Care Admin',
        emotionalFocus TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        updatedAt TEXT NOT NULL
    )`);

    db.all('PRAGMA table_info(users)', (pragmaError, columns) => {
        if (pragmaError) {
            console.error('Failed to inspect users table:', pragmaError.message);
            return;
        }

        const existingColumns = new Set(columns.map(column => column.name));
        const columnDefinitions = [
            ['personalityTags', `TEXT NOT NULL DEFAULT '[]'`],
            ['mood', `TEXT DEFAULT 'Neutral'`],
            ['intent', `TEXT DEFAULT 'I want to talk'`],
            ['availability', `TEXT NOT NULL DEFAULT '[]'`],
            ['connectionTypes', `TEXT NOT NULL DEFAULT '[]'`],
            ['anonymousMode', `INTEGER NOT NULL DEFAULT 0`],
            ['partnerEmail', 'TEXT'],
            ['meetingFormat', 'TEXT'],
            ['matchSummary', 'TEXT']
        ];

        columnDefinitions.forEach(([name, definition]) => {
            if (!existingColumns.has(name)) {
                db.run(`ALTER TABLE users ADD COLUMN ${name} ${definition}`, (alterError) => {
                    if (alterError) {
                        console.error(`Failed to add ${name} column:`, alterError.message);
                    }
                });
            }
        });
    });
});

const MEETING_LOCATIONS = {
    'Coffee Chat': [
        'Bluebird Coffee House',
        'Canal Side Espresso Bar',
        'Old Town Coffee Roasters',
        'Sunrise Brew Corner'
    ],
    Walk: [
        'Lakeside Walking Loop',
        'Riverfront Promenade',
        'City Botanical Path',
        'Neighborhood Heritage Park'
    ],
    'Study Session': [
        'Downtown Library Study Hall',
        'Campus Co-Study Hub',
        'Civic Reading Room',
        'Quiet Corner Learning Cafe'
    ],
    'Gym Buddy': [
        'Eastside Fitness Hub',
        'Central Strength Studio',
        'Riverside Sports Center',
        'Metro Training Yard'
    ]
};

const DEFAULT_CONNECTION_TYPES = Object.keys(MEETING_LOCATIONS);
const DEFAULT_AVAILABILITY = ['Morning', 'Midday', 'Afternoon', 'Evening'];
const TIME_SLOT_OPTIONS = {
    Morning: ['10:00', '10:30', '11:00', '11:30'],
    Midday: ['12:00', '12:30', '13:00', '13:30'],
    Afternoon: ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30'],
    Evening: ['17:00', '17:30', '18:00', '18:30', '19:00']
};

const LOOPBACK_ALIASES = new Set(['127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function normalizeList(values) {
    if (!Array.isArray(values)) return [];

    const uniqueValues = new Map();
    values.forEach((value) => {
        if (typeof value !== 'string') return;
        const cleaned = value.trim();
        if (!cleaned) return;
        const lookup = cleaned.toLowerCase();
        if (!uniqueValues.has(lookup)) {
            uniqueValues.set(lookup, cleaned);
        }
    });

    return Array.from(uniqueValues.values());
}

function parseStoredArray(value, fallback = []) {
    if (Array.isArray(value)) {
        const normalized = normalizeList(value);
        return normalized.length > 0 ? normalized : fallback;
    }

    if (typeof value !== 'string' || !value.trim()) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(value);
        const normalized = normalizeList(parsed);
        return normalized.length > 0 ? normalized : fallback;
    } catch (error) {
        return fallback;
    }
}

function getSharedItems(firstList, secondList) {
    const secondLookup = new Set(secondList.map(item => item.toLowerCase()));
    return firstList.filter(item => secondLookup.has(item.toLowerCase()));
}

function pickRandomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function getMoodCompatibility(moodA, moodB) {
    if (moodA === moodB) return 3;
    if (moodA === 'Neutral' || moodB === 'Neutral') return 1;

    const supportivePairs = new Set([
        'Lonely|Happy',
        'Happy|Lonely',
        'Stressed|Calm',
        'Calm|Stressed',
        'Stressed|Happy',
        'Happy|Stressed'
    ]);

    return supportivePairs.has(`${moodA}|${moodB}`) ? 2 : 0;
}

function getIntentCompatibility(intentA, intentB) {
    if (intentA === intentB) return 2;

    const complementaryPairs = new Set([
        'I want to talk|I want to listen',
        'I want to listen|I want to talk',
        'I want advice|I want to listen',
        'I want to listen|I want advice'
    ]);

    return complementaryPairs.has(`${intentA}|${intentB}`) ? 3 : 0;
}

function getUserProfile(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        interests: parseStoredArray(row.interests),
        personalityTags: parseStoredArray(row.personalityTags),
        mood: row.mood || 'Neutral',
        intent: row.intent || 'I want to talk',
        availability: parseStoredArray(row.availability, DEFAULT_AVAILABILITY),
        connectionTypes: parseStoredArray(row.connectionTypes, DEFAULT_CONNECTION_TYPES),
        anonymousMode: Number(row.anonymousMode) === 1
    };
}

function getPublicDisplayName(profile) {
    if (!profile.anonymousMode) {
        return profile.name;
    }

    const descriptor = profile.personalityTags[0] || 'Member';
    return `Anonymous ${descriptor}`;
}

function buildDefaultAdminProfile(email) {
    const normalizedEmail = typeof email === 'string' ? email.trim() : '';
    return {
        email: normalizedEmail,
        displayName: 'Care Admin',
        title: 'Community Care Admin',
        emotionalFocus: 'Emotion-based matching and safer real-world connection',
        note: 'Helping people move from emotional isolation to grounded offline connection.'
    };
}

function clearUserMatchStateByPartnerEmail(partnerEmail, callback = () => {}) {
    db.run(
        `UPDATE users
         SET matched = 0,
             partnerName = NULL,
             partnerEmail = NULL,
             sharedInterest = NULL,
             meetingPlace = NULL,
             meetingTime = NULL,
             meetingFormat = NULL,
             matchSummary = NULL
         WHERE partnerEmail = ?`,
        [partnerEmail],
        callback
    );
}

function chooseMeetingFormat(sharedConnectionTypes) {
    const options = sharedConnectionTypes.length > 0 ? sharedConnectionTypes : DEFAULT_CONNECTION_TYPES;
    return pickRandomItem(options);
}

function chooseMeetingLocation(meetingFormat) {
    const locations = MEETING_LOCATIONS[meetingFormat] || Object.values(MEETING_LOCATIONS).flat();
    return pickRandomItem(locations);
}

function chooseMeetingTime(sharedAvailability) {
    const availabilityPool = sharedAvailability.length > 0 ? sharedAvailability : DEFAULT_AVAILABILITY;
    const slotGroup = pickRandomItem(availabilityPool);
    const slot = pickRandomItem(TIME_SLOT_OPTIONS[slotGroup] || TIME_SLOT_OPTIONS.Afternoon);
    const [hours, minutes] = slot.split(':').map(Number);

    const meetingDate = new Date();
    meetingDate.setDate(meetingDate.getDate() + 1 + Math.floor(Math.random() * 4));
    meetingDate.setHours(hours, minutes, 0, 0);

    return meetingDate.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function buildMatchSummary({ sharedInterests, sharedAvailability, meetingFormat, moodScore, intentScore }) {
    const summaryParts = [];

    if (sharedInterests.length > 0) {
        summaryParts.push(`Shared spark: ${sharedInterests.slice(0, 2).join(' + ')}`);
    }

    if (sharedAvailability.length > 0) {
        summaryParts.push(`Both free in ${sharedAvailability[0].toLowerCase()}`);
    }

    if (moodScore > 0) {
        summaryParts.push('Mood fit feels supportive');
    }

    if (intentScore > 0) {
        summaryParts.push('Your conversation intent lines up');
    }

    summaryParts.push(`Best next move: ${meetingFormat}`);
    return summaryParts.join('. ') + '.';
}

function getCookieValue(req, name) {
    const cookieHeader = req.get('cookie');
    if (!cookieHeader) return null;

    const prefix = `${name}=`;
    const cookie = cookieHeader
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(prefix));

    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

function isDocumentRequest(req) {
    return req.get('sec-fetch-mode') === 'navigate'
        || req.get('sec-fetch-dest') === 'document'
        || (!req.is('application/json') && req.accepts('html'));
}

function sendGoogleAuthError(req, res, status, message) {
    if (!isDocumentRequest(req)) {
        res.status(status).json({ error: message });
        return;
    }

    const loginUrl = new URL('/login.html', `${req.protocol}://${req.get('host') || `localhost:${PORT}`}`);
    loginUrl.searchParams.set('error', message);
    res.redirect(302, loginUrl.toString());
}

function sendGoogleAuthSuccess(req, res, { message, token, user }) {
    if (!isDocumentRequest(req)) {
        res.json({ message, token, user });
        return;
    }

    const safeMessage = JSON.stringify(message);
    const safeToken = JSON.stringify(token);
    const safeUser = JSON.stringify(user || null);

    res
        .status(200)
        .type('html')
        .send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Signing In...</title>
</head>
<body>
    <p>Signing you in...</p>
    <script>
        const userProfile = ${safeUser};
        localStorage.setItem('uss_token', ${safeToken});
        localStorage.removeItem('uss_match_request');
        if (userProfile) {
            localStorage.setItem('uss_user_profile', JSON.stringify(userProfile));
        }
        alert(${safeMessage} + '! Redirecting to home...');
        window.location.replace('/index.html');
    </script>
</body>
</html>`);
}

app.use((req, res, next) => {
    const hostHeader = req.get('host');

    if (!hostHeader) {
        next();
        return;
    }

    try {
        const currentUrl = new URL(req.originalUrl, `${req.protocol}://${hostHeader}`);
        const expectsHtml = req.method === 'GET' && req.accepts('html');

        if (expectsHtml && LOOPBACK_ALIASES.has(currentUrl.hostname)) {
            const target = new URL(`${req.protocol}://localhost`);
            target.port = currentUrl.port;
            target.pathname = req.path;
            target.search = currentUrl.search;
            res.redirect(302, target.toString());
            return;
        }
    } catch (error) {
        console.warn('Failed to inspect request host for loopback redirect:', error.message);
    }

    next();
});

app.use((req, res, next) => {
    const htmlRequest = req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'));

    if (htmlRequest) {
        res.set('Cache-Control', 'no-store, max-age=0');
    } else if (req.path === '/sw.js' || req.path === '/site.webmanifest') {
        res.set('Cache-Control', 'no-cache');
    }

    next();
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Middleware to verify JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.sendStatus(403);
    }

    next();
}

// --- Authentication Endpoints ---

app.post('/api/login', (req, res) => {
    const { email, password, role } = req.body;

    if (role === 'admin') {
        const submittedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const adminEmail = typeof process.env.ADMIN_EMAIL === 'string' ? process.env.ADMIN_EMAIL.trim().toLowerCase() : '';
        const submittedPassword = typeof password === 'string' ? password.trim() : '';
        const adminPassword = typeof process.env.ADMIN_PASSWORD === 'string' ? process.env.ADMIN_PASSWORD.trim() : '';
        const compactSubmittedPassword = submittedPassword.replace(/\s+/g, '');
        const compactAdminPassword = adminPassword.replace(/\s+/g, '');

        if (submittedEmail === adminEmail && (submittedPassword === adminPassword || compactSubmittedPassword === compactAdminPassword)) {
            const token = jwt.sign({ email, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
            return res.json({ message: "Admin login successful", token });
        } else {
            return res.status(401).json({ error: "Invalid admin credentials" });
        }
    } else {
        db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
            if (err) return res.status(500).json({ error: "Database error" });
            if (row) {
                const token = jwt.sign({ email: row.email, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });
                return res.json({ message: "User login successful", token, user: row });
            } else {
                return res.status(401).json({ error: "User not found. Please join the movement first." });
            }
        });
    }
});

// Google OAuth Login
app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    const csrfCookie = getCookieValue(req, 'g_csrf_token');
    const csrfBody = req.body?.g_csrf_token;

    if (csrfCookie || csrfBody) {
        if (!csrfCookie || !csrfBody || csrfCookie !== csrfBody) {
            sendGoogleAuthError(req, res, 400, "Google login security check failed. Please try again.");
            return;
        }
    }

    if (!GOOGLE_CLIENT_ID) {
        sendGoogleAuthError(req, res, 500, "Google login is not configured on the server.");
        return;
    }

    if (!credential) {
        sendGoogleAuthError(req, res, 400, "Missing Google credential.");
        return;
    }

    try {
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        if (!payload?.email || !payload?.name || !payload.email_verified) {
            sendGoogleAuthError(req, res, 401, "Incomplete Google profile received.");
            return;
        }

        const email = payload.email;
        const name = payload.name;
        
        // Check if user exists in DB
        db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
            if (err) {
                sendGoogleAuthError(req, res, 500, "Database error");
                return;
            }
            
            if (row) {
                // User exists, issue JWT
                const token = jwt.sign({ email: row.email, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });
                sendGoogleAuthSuccess(req, res, { message: "Google login successful", token, user: row });
                return;
            } else {
                // User does not exist, but logged in via Google.
                // We should register them with empty interests so they can update it later.
                const emptyInterests = JSON.stringify([]);
                db.run('INSERT INTO users (name, email, interests) VALUES (?, ?, ?)', [name, email, emptyInterests], function(insertErr) {
                    if (insertErr) {
                        sendGoogleAuthError(req, res, 500, "Failed to create Google user");
                        return;
                    }
                    
                    const token = jwt.sign({ email, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });
                    sendGoogleAuthSuccess(req, res, { message: "Google register successful", token, user: { name, email, interests: [] } });
                });
            }
        });
    } catch (err) {
        console.error(err);
        sendGoogleAuthError(req, res, 401, "Invalid Google token");
    }
});

// Protected Admin Routes
app.get('/api/admin/dashboard', authenticateToken, requireAdmin, (req, res) => {
    
    db.all('SELECT * FROM users', [], (err, rows) => {
        if (err) return res.status(500).json({ error: "Database error" });
        
        const formattedUsers = rows.map(r => ({
            name: r.name,
            email: r.email,
            interests: JSON.parse(r.interests),
            mood: r.mood || 'Neutral',
            intent: r.intent || 'I want to talk',
            matched: r.matched === 1,
            matchDetails: r.matched === 1 ? {
                partnerName: r.partnerName,
                partnerEmail: r.partnerEmail,
                sharedInterest: r.sharedInterest,
                meetingPlace: r.meetingPlace,
                meetingTime: r.meetingTime
            } : null
        }));
        res.json({
            users: formattedUsers,
            stats: {
                totalUsers: formattedUsers.length,
                matchedUsers: formattedUsers.filter(user => user.matched).length
            }
        });
    });
});

app.get('/api/admin/profile', authenticateToken, requireAdmin, (req, res) => {
    db.get('SELECT * FROM admin_profiles WHERE email = ?', [req.user.email], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        const profile = row ? {
            email: row.email,
            displayName: row.displayName,
            title: row.title,
            emotionalFocus: row.emotionalFocus,
            note: row.note
        } : buildDefaultAdminProfile(req.user.email);

        res.json({ profile });
    });
});

app.put('/api/admin/profile', authenticateToken, requireAdmin, (req, res) => {
    const fallbackProfile = buildDefaultAdminProfile(req.user.email);
    const displayName = typeof req.body.displayName === 'string' && req.body.displayName.trim()
        ? req.body.displayName.trim()
        : fallbackProfile.displayName;
    const title = typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : fallbackProfile.title;
    const emotionalFocus = typeof req.body.emotionalFocus === 'string'
        ? req.body.emotionalFocus.trim()
        : fallbackProfile.emotionalFocus;
    const note = typeof req.body.note === 'string'
        ? req.body.note.trim()
        : fallbackProfile.note;
    const updatedAt = new Date().toISOString();

    db.run(
        `INSERT INTO admin_profiles (email, displayName, title, emotionalFocus, note, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
            displayName = excluded.displayName,
            title = excluded.title,
            emotionalFocus = excluded.emotionalFocus,
            note = excluded.note,
            updatedAt = excluded.updatedAt`,
        [req.user.email, displayName, title, emotionalFocus, note, updatedAt],
        (err) => {
            if (err) return res.status(500).json({ error: 'Failed to save admin profile' });

            res.json({
                message: 'Admin profile saved',
                profile: {
                    email: req.user.email,
                    displayName,
                    title,
                    emotionalFocus,
                    note
                }
            });
        }
    );
});

app.delete('/api/admin/users/:email', authenticateToken, requireAdmin, (req, res) => {
    const userEmail = typeof req.params.email === 'string' ? req.params.email.trim() : '';
    if (!userEmail) {
        return res.status(400).json({ error: 'User email is required' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [userEmail], (selectErr, user) => {
        if (selectErr) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(404).json({ error: 'User not found' });

        clearUserMatchStateByPartnerEmail(userEmail, (clearErr) => {
            if (clearErr) return res.status(500).json({ error: 'Failed to update related matches' });

            db.run('DELETE FROM users WHERE email = ?', [userEmail], (deleteErr) => {
                if (deleteErr) return res.status(500).json({ error: 'Failed to remove user' });

                res.json({ message: 'User removed successfully', email: userEmail });
            });
        });
    });
});


// --- Matchmaking Endpoints ---
function scoreCandidate(currentUser, candidateUser) {
    const sharedInterests = getSharedItems(currentUser.interests, candidateUser.interests);
    const sharedAvailability = getSharedItems(currentUser.availability, candidateUser.availability);
    const sharedPersonality = getSharedItems(currentUser.personalityTags, candidateUser.personalityTags);
    const sharedConnectionTypes = getSharedItems(currentUser.connectionTypes, candidateUser.connectionTypes);
    const moodScore = getMoodCompatibility(currentUser.mood, candidateUser.mood);
    const intentScore = getIntentCompatibility(currentUser.intent, candidateUser.intent);

    if (sharedInterests.length === 0) {
        return null;
    }

    const score =
        (sharedInterests.length * 5) +
        (sharedAvailability.length * 2) +
        (sharedPersonality.length * 2) +
        (sharedConnectionTypes.length * 2) +
        moodScore +
        intentScore;

    return {
        score,
        sharedInterests,
        sharedAvailability,
        sharedPersonality,
        sharedConnectionTypes,
        moodScore,
        intentScore
    };
}

function updateMatchedUsers({ currentUser, candidateUser, sharedSignals }, res) {
    const meetingFormat = chooseMeetingFormat(sharedSignals.sharedConnectionTypes);
    const meetingPlace = chooseMeetingLocation(meetingFormat);
    const meetingTime = chooseMeetingTime(sharedSignals.sharedAvailability);
    const sharedInterest = sharedSignals.sharedInterests[0];
    const matchSummary = buildMatchSummary({
        sharedInterests: sharedSignals.sharedInterests,
        sharedAvailability: sharedSignals.sharedAvailability,
        meetingFormat,
        moodScore: sharedSignals.moodScore,
        intentScore: sharedSignals.intentScore
    });

    const currentDisplayName = getPublicDisplayName(currentUser);
    const candidateDisplayName = getPublicDisplayName(candidateUser);

    db.run(
        'UPDATE users SET matched = 1, partnerName = ?, partnerEmail = ?, sharedInterest = ?, meetingPlace = ?, meetingTime = ?, meetingFormat = ?, matchSummary = ? WHERE id = ?',
        [currentDisplayName, currentUser.email, sharedInterest, meetingPlace, meetingTime, meetingFormat, matchSummary, candidateUser.id]
    );

    db.run(
        'UPDATE users SET matched = 1, partnerName = ?, partnerEmail = ?, sharedInterest = ?, meetingPlace = ?, meetingTime = ?, meetingFormat = ?, matchSummary = ? WHERE id = ?',
        [candidateDisplayName, candidateUser.email, sharedInterest, meetingPlace, meetingTime, meetingFormat, matchSummary, currentUser.id],
        (updateError) => {
            if (updateError) {
                return res.status(500).json({ error: "Database error" });
            }

            res.json({
                message: "Match queued successfully",
                email: currentUser.email,
                matched: true,
                meetingFormat,
                matchSummary
            });
        }
    );
}

function attemptMatchForUser(userProfile, res) {
    db.all('SELECT * FROM users WHERE matched = 0 AND id != ?', [userProfile.id], (err, rows) => {
        if (err) return res.status(500).json({ error: "Database error" });

        let bestCandidate = null;
        let bestSignals = null;

        rows.forEach((row) => {
            const candidateProfile = getUserProfile(row);
            const signals = scoreCandidate(userProfile, candidateProfile);

            if (!signals) {
                return;
            }

            if (!bestSignals || signals.score > bestSignals.score) {
                bestCandidate = candidateProfile;
                bestSignals = signals;
            }
        });

        if (!bestCandidate || !bestSignals) {
            return res.json({
                message: "Details saved. Looking for a match.",
                email: userProfile.email,
                matched: false
            });
        }

        updateMatchedUsers({ currentUser: userProfile, candidateUser: bestCandidate, sharedSignals: bestSignals }, res);
    });
}

app.post('/api/join', (req, res) => {
    const {
        name,
        email,
        interests,
        personalityTags = [],
        mood = 'Neutral',
        intent = 'I want to talk',
        availability = [],
        connectionTypes = [],
        anonymousMode = false
    } = req.body;

    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim() : '';
    const normalizedInterests = normalizeList(interests);
    const normalizedPersonalityTags = normalizeList(personalityTags);
    const normalizedAvailability = normalizeList(availability);
    const normalizedConnectionTypes = normalizeList(connectionTypes);
    const moodValue = typeof mood === 'string' && mood.trim() ? mood.trim() : 'Neutral';
    const intentValue = typeof intent === 'string' && intent.trim() ? intent.trim() : 'I want to talk';
    const anonymousFlag = anonymousMode === true || anonymousMode === 1 || anonymousMode === '1';

    if (!normalizedName || !normalizedEmail || normalizedInterests.length === 0) {
        return res.status(400).json({ error: "Name, email, and at least one interest are required." });
    }

    const profilePayload = {
        name: normalizedName,
        email: normalizedEmail,
        interests: JSON.stringify(normalizedInterests),
        personalityTags: JSON.stringify(normalizedPersonalityTags),
        mood: moodValue,
        intent: intentValue,
        availability: JSON.stringify(normalizedAvailability),
        connectionTypes: JSON.stringify(normalizedConnectionTypes),
        anonymousMode: anonymousFlag ? 1 : 0
    };

    db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail], (err, existingUser) => {
        if (err) return res.status(500).json({ error: "Database error" });

        if (existingUser) {
            db.run(
                `UPDATE users
                 SET name = ?, interests = ?, personalityTags = ?, mood = ?, intent = ?, availability = ?, connectionTypes = ?, anonymousMode = ?
                 WHERE id = ?`,
                [
                    profilePayload.name,
                    profilePayload.interests,
                    profilePayload.personalityTags,
                    profilePayload.mood,
                    profilePayload.intent,
                    profilePayload.availability,
                    profilePayload.connectionTypes,
                    profilePayload.anonymousMode,
                    existingUser.id
                ],
                (updateErr) => {
                    if (updateErr) return res.status(500).json({ error: "Database error" });

                    if (existingUser.matched === 1) {
                        return res.json({ message: "User updated", email: normalizedEmail, matched: true });
                    }

                    attemptMatchForUser({
                        id: existingUser.id,
                        name: profilePayload.name,
                        email: normalizedEmail,
                        interests: normalizedInterests,
                        personalityTags: normalizedPersonalityTags,
                        mood: moodValue,
                        intent: intentValue,
                        availability: normalizedAvailability.length > 0 ? normalizedAvailability : DEFAULT_AVAILABILITY,
                        connectionTypes: normalizedConnectionTypes.length > 0 ? normalizedConnectionTypes : DEFAULT_CONNECTION_TYPES,
                        anonymousMode: anonymousFlag
                    }, res);
                }
            );
            return;
        }

        db.run(
            `INSERT INTO users (name, email, interests, personalityTags, mood, intent, availability, connectionTypes, anonymousMode)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                profilePayload.name,
                normalizedEmail,
                profilePayload.interests,
                profilePayload.personalityTags,
                profilePayload.mood,
                profilePayload.intent,
                profilePayload.availability,
                profilePayload.connectionTypes,
                profilePayload.anonymousMode
            ],
            function(insertErr) {
                if (insertErr) return res.status(500).json({ error: "Failed to create user" });

                attemptMatchForUser({
                    id: this.lastID,
                    name: profilePayload.name,
                    email: normalizedEmail,
                    interests: normalizedInterests,
                    personalityTags: normalizedPersonalityTags,
                    mood: moodValue,
                    intent: intentValue,
                    availability: normalizedAvailability.length > 0 ? normalizedAvailability : DEFAULT_AVAILABILITY,
                    connectionTypes: normalizedConnectionTypes.length > 0 ? normalizedConnectionTypes : DEFAULT_CONNECTION_TYPES,
                    anonymousMode: anonymousFlag
                }, res);
            }
        );
    });
});

app.get('/api/status/:email', (req, res) => {
    db.get('SELECT * FROM users WHERE email = ?', [req.params.email], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: "User not found." });
        }
        res.json({ 
            matched: user.matched === 1, 
            matchDetails: user.matched === 1 ? {
                partnerName: user.partnerName,
                sharedInterest: user.sharedInterest,
                meetingPlace: user.meetingPlace,
                meetingTime: user.meetingTime,
                meetingFormat: user.meetingFormat,
                matchSummary: user.matchSummary
            } : null 
        });
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        googleClientId: GOOGLE_CLIENT_ID || null,
        localhostOrigin: `http://localhost:${PORT}`
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        databasePath: dbPath
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
    res.redirect('/login.html');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Matching server running on http://localhost:${PORT}`);
});
