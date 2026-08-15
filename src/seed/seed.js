import "dotenv/config";
import fs from "fs/promises";

const API_URL = process.env.API_URL;
if (!API_URL) {
    throw new Error("API_URL is required to seed via REST endpoints.");
}

// Delay between commentary posts for matches that are still LIVE. Keeps them
// slow enough that a viewer actually sees scores/commentary arrive live.
const LIVE_DELAY_MS = Number.parseInt(process.env.LIVE_DELAY_MS || "250", 10);
// Fast delay for finished matches so their final scores are built quickly.
const FINISHED_DELAY_MS = Number.parseInt(process.env.FINISHED_DELAY_MS || "20", 10);
const NEW_MATCH_DELAY_MIN_MS = 200;
const NEW_MATCH_DELAY_MAX_MS = 500;
const DEFAULT_MATCH_DURATION_MINUTES = Number.parseInt(
    process.env.SEED_MATCH_DURATION_MINUTES || "120",
    10,
);
const SPORT_DURATION_MINUTES = {
    football: Number.parseInt(process.env.SEED_FOOTBALL_MIN || "105", 10),
    cricket: Number.parseInt(process.env.SEED_CRICKET_MIN || "300", 10),
    basketball: Number.parseInt(process.env.SEED_BASKETBALL_MIN || "150", 10),
};

// Number of seed matches that should be "live right now" (shown at the top).
const LIVE_MATCH_COUNT = Number.parseInt(process.env.SEED_LIVE_COUNT || "6", 10);
// Hours ago each finished match ended, spread over the last ~2 days.
const FINISHED_OFFSETS_HOURS = [2, 3, 5, 7, 10, 13, 17, 21, 26, 31, 38, 45];

// How many commentary entries a live match gets during setup; the rest are
// streamed one-by-one so scores keep updating in real time.
const LIVE_SETUP_COUNT = Number.parseInt(process.env.SEED_LIVE_SETUP_COUNT || "40", 10);
// Pause between streaming rounds (each round pushes one event per live match).
const STREAM_INTERVAL_MS = Number.parseInt(process.env.STREAM_INTERVAL_MS || "2500", 10);

// Event types that change the score, streamed first for visible live scoring.
const SCORING_EVENTS = new Set([
    "goal",
    "penalty",
    "six",
    "four",
    "boundary",
    "run",
    "wicket",
    "basket",
    "three",
    "free_throw",
]);

// Wipe existing matches/commentary before seeding so re-runs stay clean.
const SEED_RESET =
    process.env.SEED_RESET !== "0" && process.env.SEED_RESET !== "false";

const DEFAULT_DATA_FILE = new URL("../data/data.json", import.meta.url);

async function readJsonFile(fileUrl) {
    const raw = await fs.readFile(fileUrl, "utf8");
    return JSON.parse(raw);
}

async function loadSeedData() {
    const parsed = await readJsonFile(DEFAULT_DATA_FILE);

    if (Array.isArray(parsed)) {
        return { feed: parsed, matches: [] };
    }

    if (Array.isArray(parsed.commentary)) {
        return { feed: parsed.commentary, matches: parsed.matches ?? [] };
    }

    if (Array.isArray(parsed.feed)) {
        return { feed: parsed.feed, matches: parsed.matches ?? [] };
    }

    throw new Error(
        "Seed data must be an array or contain a commentary/feed array.",
    );
}

async function fetchMatches(limit = 100) {
    const response = await fetch(`${API_URL}/matches?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch matches: ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.data) ? payload.data : [];
}

function parseDate(value) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isLiveMatch(match) {
    const start = parseDate(match.startTime);
    const end = parseDate(match.endTime);
    if (!start || !end) {
        return false;
    }
    const now = new Date();
    return now >= start && now < end;
}

function sportDurationMinutes(sport) {
    return SPORT_DURATION_MINUTES[String(sport).toLowerCase()]
        || DEFAULT_MATCH_DURATION_MINUTES;
}

// The first LIVE_MATCH_COUNT seed matches kick off right now; the rest are
// finished matches whose endTime is staggered over the last ~48 hours.
function buildMatchTimes(seedMatch, index) {
    const now = new Date();
    const durationMs = sportDurationMinutes(seedMatch.sport) * 60 * 1000;

    if (index < LIVE_MATCH_COUNT) {
        const start = new Date(now.getTime() - 5 * 60 * 1000);
        return {
            startTime: start.toISOString(),
            endTime: new Date(start.getTime() + durationMs).toISOString(),
        };
    }

    const offsetIndex =
        (index - LIVE_MATCH_COUNT) % FINISHED_OFFSETS_HOURS.length;
    const offsetMs = FINISHED_OFFSETS_HOURS[offsetIndex] * 60 * 60 * 1000;
    const end = new Date(now.getTime() - offsetMs);
    const start = new Date(end.getTime() - durationMs);

    return {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
    };
}

async function createMatch(seedMatch, index) {
    const { startTime, endTime } = buildMatchTimes(seedMatch, index);

    const response = await fetch(`${API_URL}/matches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            sport: seedMatch.sport,
            homeTeam: seedMatch.homeTeam,
            awayTeam: seedMatch.awayTeam,
            startTime,
            endTime,
            homeScore: seedMatch.homeScore ?? 0,
            awayScore: seedMatch.awayScore ?? 0,
        }),
    });
    if (!response.ok) {
        throw new Error(`Failed to create match: ${response.status}`);
    }
    const responsePayload = await response.json();
    return responsePayload.data;
}

async function insertCommentary(matchId, entry) {
    const payload = {
        message: entry.message ?? "Update",
    };
    if (entry.minute !== undefined && entry.minute !== null) {
        payload.minute = entry.minute;
    }
    if (entry.sequence !== undefined && entry.sequence !== null) {
        payload.sequence = entry.sequence;
    }
    if (entry.period !== undefined && entry.period !== null) {
        payload.period = entry.period;
    }
    if (entry.eventType !== undefined && entry.eventType !== null) {
        payload.eventType = entry.eventType;
    }
    if (entry.actor !== undefined && entry.actor !== null) {
        payload.actor = entry.actor;
    }
    if (entry.team !== undefined && entry.team !== null) {
        payload.team = entry.team;
    }
    if (entry.metadata !== undefined && entry.metadata !== null) {
        payload.metadata = entry.metadata;
    }
    if (entry.tags !== undefined && entry.tags !== null) {
        payload.tags = entry.tags;
    }

    const response = await fetch(`${API_URL}/matches/${matchId}/commentary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // NOTE: Avoid sending nulls; the API expects missing optional fields.
        // body: JSON.stringify({
        //   minute: entry.minute ?? null,
        //   sequence: entry.sequence ?? null,
        //   period: entry.period ?? null,
        //   eventType: entry.eventType ?? null,
        //   actor: entry.actor ?? null,
        //   team: entry.team ?? null,
        //   message: entry.message ?? "Update",
        //   metadata: entry.metadata ?? null,
        //   tags: entry.tags ?? null,
        // }),
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Failed to create commentary: ${response.status}`);
    }
    const responsePayload = await response.json();
    return responsePayload.data;
}

async function insertCommentaryWithRetry(matchId, entry, attempts = 5) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await insertCommentary(matchId, entry);
        } catch (error) {
            lastError = error;
            const delayMs = 500 * attempt * attempt;
            console.warn(
                `⚠️  Retry ${attempt}/${attempts} after error for [Match ${matchId}]: ${error.message}`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}

// Bulk-ingest a chunk of commentary entries for a match (max 100 per request).
function buildCommentaryPayload(entry) {
    const payload = { message: entry.message ?? "Update" };
    if (entry.minute !== undefined && entry.minute !== null) {
        payload.minute = entry.minute;
    }
    if (entry.sequence !== undefined && entry.sequence !== null) {
        payload.sequence = entry.sequence;
    }
    if (entry.period !== undefined && entry.period !== null) {
        payload.period = entry.period;
    }
    if (entry.eventType !== undefined && entry.eventType !== null) {
        payload.eventType = entry.eventType;
    }
    if (entry.actor !== undefined && entry.actor !== null) {
        payload.actor = entry.actor;
    }
    if (entry.team !== undefined && entry.team !== null) {
        payload.team = entry.team;
    }
    if (entry.metadata !== undefined && entry.metadata !== null) {
        payload.metadata = entry.metadata;
    }
    if (entry.tags !== undefined && entry.tags !== null) {
        payload.tags = entry.tags;
    }
    return payload;
}

async function insertCommentaryBatch(matchId, entries, attempts = 5) {
    const chunks = [];
    for (let i = 0; i < entries.length; i += 100) {
        chunks.push(entries.slice(i, i + 100));
    }

    for (const chunk of chunks) {
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const response = await fetch(
                    `${API_URL}/matches/${matchId}/commentary/batch`,
                    {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                            entries: chunk.map(buildCommentaryPayload),
                        }),
                    },
                );
                if (!response.ok) {
                    throw new Error(`Failed to create commentary batch: ${response.status}`);
                }
                const responsePayload = await response.json();
                console.log(
                    `📦 [Match ${matchId}] batch of ${responsePayload.data?.length ?? chunk.length} commentary entries`,
                );
                break;
            } catch (error) {
                lastError = error;
                const delayMs = 500 * attempt * attempt;
                console.warn(
                    `⚠️  Retry ${attempt}/${attempts} after error for [Match ${matchId}]: ${error.message}`,
                );
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        if (lastError) {
            throw lastError;
        }
    }
}

function chunkEntries(entries, size) {
    const chunks = [];
    for (let i = 0; i < entries.length; i += size) {
        chunks.push(entries.slice(i, i + size));
    }
    return chunks;
}

// NOTE: Score delta logic is commented out because this codebase
// does not expose score update endpoints.
// function extractRuns(entry) {
//   if (Number.isFinite(entry.runs)) {
//     return entry.runs;
//   }
//   if (entry.metadata && Number.isFinite(entry.metadata.runs)) {
//     return entry.metadata.runs;
//   }
//   if (entry.eventType === "four") {
//     return 4;
//   }
//   if (entry.eventType === "six") {
//     return 6;
//   }
//   if (entry.eventType === "run") {
//     return 1;
//   }
//   return null;
// }
//
// function scoreDeltaFromEntry(entry, match) {
//   if (entry.scoreDelta && typeof entry.scoreDelta === "object") {
//     return {
//       home: Number(entry.scoreDelta.home || 0),
//       away: Number(entry.scoreDelta.away || 0),
//     };
//   }
//
//   if (entry.eventType === "goal") {
//     if (entry.team === match.homeTeam) {
//       return { home: 1, away: 0 };
//     }
//     if (entry.team === match.awayTeam) {
//       return { home: 0, away: 1 };
//     }
//   }
//
//   const runs = extractRuns(entry);
//   if (runs !== null) {
//     if (entry.team === match.homeTeam) {
//       return { home: runs, away: 0 };
//     }
//     if (entry.team === match.awayTeam) {
//       return { home: 0, away: runs };
//     }
//   }
//
//   return null;
// }
//
// function fakeScoreDelta(matchState) {
//   const nextSide = matchState.fakeNext === "home" ? "away" : "home";
//   matchState.fakeNext = nextSide;
//   const points = 1;
//   return nextSide === "home"
//     ? { home: points, away: 0 }
//     : { home: 0, away: points };
// }

function inningsRank(period) {
    if (!period) {
        return 0;
    }
    const lower = String(period).toLowerCase();
    const match = lower.match(/(\d+)(st|nd|rd|th)/);
    if (match) {
        return Number(match[1]) || 0;
    }
    if (lower.includes("first")) {
        return 1;
    }
    if (lower.includes("second")) {
        return 2;
    }
    if (lower.includes("third")) {
        return 3;
    }
    if (lower.includes("fourth")) {
        return 4;
    }
    return 0;
}

function cricketBattingTeam(entry, match) {
    const rank = inningsRank(entry.period);
    if (rank === 1) {
        return match.homeTeam;
    }
    if (rank === 2) {
        return match.awayTeam;
    }
    return null;
}

// function cricketScoreDelta(entry, match) {
//   const battingTeam = cricketBattingTeam(entry, match);
//   let delta = scoreDeltaFromEntry(entry, match);
//   if (!delta) {
//     if (!battingTeam) {
//       return null;
//     }
//     const points = 1;
//     return battingTeam === match.homeTeam
//       ? { home: points, away: 0 }
//       : { home: 0, away: points };
//   }
//
//   if (!battingTeam) {
//     return delta;
//   }
//
//   if (battingTeam === match.homeTeam) {
//     return { home: delta.home, away: 0 };
//   }
//   return { home: 0, away: delta.away };
// }

function normalizeCricketFeed(entries, match) {
    const sorted = [...entries].sort((a, b) => {
        const inningsDiff = inningsRank(a.period) - inningsRank(b.period);
        if (inningsDiff !== 0) {
            return inningsDiff;
        }
        const seqA = Number.isFinite(a.sequence)
            ? a.sequence
            : Number.MAX_SAFE_INTEGER;
        const seqB = Number.isFinite(b.sequence)
            ? b.sequence
            : Number.MAX_SAFE_INTEGER;
        if (seqA !== seqB) {
            return seqA - seqB;
        }
        const minA = Number.isFinite(a.minute) ? a.minute : Number.MAX_SAFE_INTEGER;
        const minB = Number.isFinite(b.minute) ? b.minute : Number.MAX_SAFE_INTEGER;
        return minA - minB;
    });

    const grouped = new Map();
    for (const entry of sorted) {
        const key = inningsRank(entry.period);
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(entry);
    }

    const ordered = [];
    const inningsKeys = Array.from(grouped.keys()).sort((a, b) => a - b);

    for (const key of inningsKeys) {
        const inningsEntries = grouped.get(key) || [];
        const primaryTeam = inningsEntries.find(
            (entry) => entry.team === match.homeTeam || entry.team === match.awayTeam,
        )?.team;
        const secondaryTeam =
            primaryTeam === match.homeTeam ? match.awayTeam : match.homeTeam;

        const neutral = inningsEntries.filter(
            (entry) => !entry.team || entry.team === "neutral",
        );
        const primary = inningsEntries.filter(
            (entry) => entry.team === primaryTeam,
        );
        const secondary = inningsEntries.filter(
            (entry) => entry.team === secondaryTeam,
        );
        const other = inningsEntries.filter(
            (entry) =>
                entry.team &&
                entry.team !== "neutral" &&
                entry.team !== primaryTeam &&
                entry.team !== secondaryTeam,
        );

        ordered.push(...neutral, ...primary, ...secondary, ...other);
    }

    return ordered;
}

function replaceTrailingTeam(message, replacements) {
    if (typeof message !== "string") {
        return message;
    }
    const match = message.match(/\(([^)]+)\)\s*$/);
    if (!match) {
        return message;
    }
    const nextTeam = replacements.get(match[1]);
    if (!nextTeam) {
        return message;
    }
    return message.replace(/\([^)]+\)\s*$/, `(${nextTeam})`);
}

function setTrailingTeam(message, team) {
    if (typeof message !== "string") {
        return message;
    }
    return message.replace(/\([^)]+\)\s*$/, `(${team})`);
}

function shuffle(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function balanceFootballFeed(entries, match) {
    const isGoal = (e) => ["goal", "penalty", "own_goal"].includes(e.eventType);
    const goalIndices = [];
    entries.forEach((e, i) => {
        if (isGoal(e)) goalIndices.push(i);
    });

    if (goalIndices.length === 0) {
        return entries;
    }

    const total = Math.min(2 + Math.floor(Math.random() * 4), goalIndices.length);
    const keep = new Set(shuffle(goalIndices).slice(0, total));
    const homeGoals = 1 + Math.floor(Math.random() * (total - 1));
    let homeAssigned = 0;

    return entries
        .map((entry, i) => {
            if (!isGoal(entry)) {
                return entry;
            }
            if (!keep.has(i)) {
                return null;
            }
            const team =
                homeAssigned < homeGoals ? match.homeTeam : match.awayTeam;
            if (team === match.homeTeam) {
                homeAssigned += 1;
            }
            return {
                ...entry,
                team,
                message: setTrailingTeam(entry.message, team),
            };
        })
        .filter(Boolean);
}

function balanceCricketFeed(entries, match) {
    const byTeam = new Map();
    for (const entry of entries) {
        const key = entry.team || "neutral";
        if (!byTeam.has(key)) {
            byTeam.set(key, []);
        }
        byTeam.get(key).push(entry);
    }

    const out = [];
    for (const [team, list] of byTeam) {
        if (team === "neutral") {
            out.push(...list);
            continue;
        }

        const maxSix = 3 + Math.floor(Math.random() * 5);
        const maxFour = 3 + Math.floor(Math.random() * 5);
        const drop = new Set();
        let sixes = 0;
        let fours = 0;
        let wickets = 0;

        list.forEach((entry, i) => {
            if (entry.eventType === "six") {
                if (sixes >= maxSix) drop.add(i);
                else sixes += 1;
            } else if (entry.eventType === "four" || entry.eventType === "boundary") {
                if (fours >= maxFour) drop.add(i);
                else fours += 1;
            } else if (entry.eventType === "wicket") {
                if (wickets >= 10) drop.add(i);
                else wickets += 1;
            }
        });

        list.forEach((entry, i) => {
            if (!drop.has(i)) out.push(entry);
        });
    }

    return out;
}

const BASKET_POINTS = { basket: 2, three: 3, free_throw: 1 };

function balanceBasketballFeed(entries, match) {
    const isScoring = (e) => BASKET_POINTS[e.eventType] != null;

    const byTeam = new Map();
    for (const entry of entries) {
        const key = entry.team || "neutral";
        if (!byTeam.has(key)) {
            byTeam.set(key, []);
        }
        byTeam.get(key).push(entry);
    }

    const targets = new Map();
    for (const team of byTeam.keys()) {
        if (team === "neutral") continue;
        targets.set(team, 72 + Math.floor(Math.random() * 44));
    }

    const drop = new Set();
    for (const [team, list] of byTeam) {
        if (team === "neutral") continue;
        const target = targets.get(team);
        let total = list.reduce(
            (acc, e) => acc + (BASKET_POINTS[e.eventType] ?? 0),
            0,
        );
        const scoring = list
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => isScoring(e));
        const toDrop = scoring.slice(0, scoring.length).sort(
            () => 0.5 - Math.random(),
        );
        for (const { e, i } of toDrop) {
            if (total <= target) break;
            drop.add(i);
            total -= BASKET_POINTS[e.eventType];
        }
    }

    // Keep the original (interleaved) order so both sides score throughout.
    return entries.filter((entry, i) => !drop.has(i));
}

function realisticFeed(entries, match) {
    const sport = String(match.sport).toLowerCase();
    if (sport === "football") {
        return balanceFootballFeed(entries, match);
    }
    if (sport === "cricket") {
        return balanceCricketFeed(entries, match);
    }
    if (sport === "basketball") {
        return balanceBasketballFeed(entries, match);
    }
    return entries;
}

function cloneCommentaryEntries(entries, templateMatch, targetMatch) {
    const replacements = new Map([
        [templateMatch.homeTeam, targetMatch.homeTeam],
        [templateMatch.awayTeam, targetMatch.awayTeam],
    ]);
    const minuteOffset = Math.floor(Math.random() * 31);

    return entries.map((entry) => {
        const next = { ...entry, matchId: targetMatch.id };
        if (entry.team === templateMatch.homeTeam) {
            next.team = targetMatch.homeTeam;
        } else if (entry.team === templateMatch.awayTeam) {
            next.team = targetMatch.awayTeam;
        }
        if (Number.isFinite(next.minute)) {
            next.minute = Math.max(0, next.minute + minuteOffset);
        }
        next.message = replaceTrailingTeam(entry.message, replacements);
        return next;
    });
}

function expandFeedForMatches(feed, seedMatches) {
    if (!Array.isArray(seedMatches) || seedMatches.length === 0) {
        return feed;
    }

    const byMatchId = new Map();
    for (const entry of feed) {
        if (!Number.isInteger(entry.matchId)) {
            continue;
        }
        if (!byMatchId.has(entry.matchId)) {
            byMatchId.set(entry.matchId, []);
        }
        byMatchId.get(entry.matchId).push(entry);
    }

    const matchById = new Map();
    const templatesBySport = new Map();
    const counters = new Map();
    for (const match of seedMatches) {
        matchById.set(match.id, match);
        if (byMatchId.has(match.id)) {
            if (!templatesBySport.has(match.sport)) {
                templatesBySport.set(match.sport, []);
                counters.set(match.sport, 0);
            }
            templatesBySport.get(match.sport).push(match);
        }
    }

    const expanded = [...feed];
    for (const match of seedMatches) {
        if (byMatchId.has(match.id)) {
            continue;
        }
        const templates = templatesBySport.get(match.sport);
        if (!templates || templates.length === 0) {
            continue;
        }
        const index = counters.get(match.sport) % templates.length;
        counters.set(match.sport, index + 1);
        const templateMatch = templates[index];
        const templateEntries = byMatchId.get(templateMatch.id) || [];
        expanded.push(
            ...cloneCommentaryEntries(templateEntries, templateMatch, match),
        );
    }

    return expanded;
}

function getMatchEntry(entry, matchMap) {
    if (!Number.isInteger(entry.matchId)) {
        return null;
    }
    return matchMap.get(entry.matchId) ?? null;
}

// NOTE: Score updates are not part of this codebase yet.
// async function updateMatchScore(matchId, homeScore, awayScore) {
//   const response = await fetch(`${API_URL}/matches/${matchId}/score`, {
//     method: "PATCH",
//     headers: { "content-type": "application/json" },
//     body: JSON.stringify({ homeScore, awayScore }),
//   });
//   if (!response.ok) {
//     throw new Error(`Failed to update score: ${response.status}`);
//   }
// }

function randomMatchDelay() {
    const range = NEW_MATCH_DELAY_MAX_MS - NEW_MATCH_DELAY_MIN_MS;
    return NEW_MATCH_DELAY_MIN_MS + Math.floor(Math.random() * (range + 1));
}

async function runWithConcurrency(items, limit, worker) {
    let index = 0;

    const run = async () => {
        while (index < items.length) {
            const current = index;
            index += 1;
            await worker(items[current], current);
        }
    };

    const workers = Array.from({ length: Math.min(limit, items.length) }, run);
    await Promise.all(workers);
}

// NOTE: Match status updates are not part of this codebase yet.
// async function endMatch(matchId) {
//   const response = await fetch(`${API_URL}/matches/${matchId}/end`, {
//     method: "PATCH",
//     headers: { "content-type": "application/json" },
//   });
//   if (!response.ok) {
//     throw new Error(`Failed to end match: ${response.status}`);
//   }
// }

async function resetMatches() {
    const response = await fetch(`${API_URL}/matches`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
    });
    if (!response.ok) {
        throw new Error(`Failed to reset matches: ${response.status}`);
    }
}

async function seed() {
    console.log(`📡 Seeding via API: ${API_URL}`);

    if (SEED_RESET) {
        console.log("🧹 Clearing existing matches and commentary…");
        await resetMatches();
    }

    const { feed, matches: seedMatches } = await loadSeedData();
    const matchesList = await fetchMatches();

    const matchMap = new Map();
    const matchKeyMap = new Map();
    for (const match of matchesList) {
        const key = `${match.sport}|${match.homeTeam}|${match.awayTeam}`;
        if (!matchKeyMap.has(key)) {
            matchKeyMap.set(key, match);
        }
        matchMap.set(match.id, { match });
    }

    if (Array.isArray(seedMatches) && seedMatches.length > 0) {
        for (const [index, seedMatch] of seedMatches.entries()) {
            const key = `${seedMatch.sport}|${seedMatch.homeTeam}|${seedMatch.awayTeam}`;
            let match = matchKeyMap.get(key);
            if (!match) {
                match = await createMatch(seedMatch, index);
                matchKeyMap.set(key, match);
                const delayMs = randomMatchDelay();
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            if (Number.isInteger(seedMatch.id)) {
                matchMap.set(seedMatch.id, { match });
            }
            matchMap.set(match.id, { match });
        }
    }

    if (matchMap.size === 0) {
        throw new Error("No matches found or created in the database.");
    }

    const expandedFeed = expandFeedForMatches(feed, seedMatches);

    const entriesByMatch = new Map();
    for (const entry of expandedFeed) {
        const target = getMatchEntry(entry, matchMap);
        if (!target) {
            console.warn("⚠️  Skipping entry without a match:", entry.message);
            continue;
        }
        const matchId = target.match.id;
        if (!entriesByMatch.has(matchId)) {
            entriesByMatch.set(matchId, []);
        }
        entriesByMatch.get(matchId).push(entry);
    }

    // matchMap is keyed by both seed ids and db ids, so dedupe by db id first
    // to avoid processing the same match twice.
    const dbMatches = new Map();
    for (const { match } of matchMap.values()) {
        if (!dbMatches.has(match.id)) {
            dbMatches.set(match.id, match);
        }
    }

    // Balance each match's feed so scores land on realistic totals.
    for (const match of dbMatches.values()) {
        const matchId = match.id;
        const entries = entriesByMatch.get(matchId);
        if (entries && entries.length > 0) {
            entriesByMatch.set(matchId, realisticFeed(entries, match));
        }
    }

    const liveMatchIds = [];
    const finishedMatchIds = [];
    for (const match of dbMatches.values()) {
        if (isLiveMatch(match)) liveMatchIds.push(match.id);
        else finishedMatchIds.push(match.id);
    }

    const SEED_CONCURRENCY = Number.parseInt(process.env.SEED_CONCURRENCY || "4", 10);

    // 1) Finished matches: full commentary in fast batches so their final
    //    scores are complete before the live stream begins.
    const finishedJobs = [];
    for (const matchId of finishedMatchIds) {
        const entries = entriesByMatch.get(matchId) ?? [];
        for (const chunk of chunkEntries(entries, 100)) {
            finishedJobs.push({ matchId, chunk });
        }
    }
    await runWithConcurrency(finishedJobs, SEED_CONCURRENCY, async (job) => {
        await insertCommentaryBatch(job.matchId, job.chunk);
        if (FINISHED_DELAY_MS > 0) {
            await new Promise((resolve) => setTimeout(resolve, FINISHED_DELAY_MS));
        }
    });
    console.log(`✅ Finalized ${finishedMatchIds.length} finished match(es).`);

    // 2) Live matches: post an opening portion so they don't look empty.
    const streamBuckets = new Map();
    const liveSetupJobs = [];
    for (const matchId of liveMatchIds) {
        const entries = entriesByMatch.get(matchId) ?? [];
        const setupCount = Math.min(LIVE_SETUP_COUNT, entries.length);
        const setup = entries.slice(0, setupCount);
        const rest = entries.slice(setupCount);
        // Prioritize scoring events so scores visibly change while streaming.
        const scoring = rest.filter((e) => SCORING_EVENTS.has(e.eventType));
        const other = rest.filter((e) => !SCORING_EVENTS.has(e.eventType));
        streamBuckets.set(matchId, [...scoring, ...other]);
        for (const chunk of chunkEntries(setup, 100)) {
            liveSetupJobs.push({ matchId, chunk });
        }
    }
    await runWithConcurrency(liveSetupJobs, SEED_CONCURRENCY, async (job) => {
        await insertCommentaryBatch(job.matchId, job.chunk);
        if (LIVE_DELAY_MS > 0) {
            await new Promise((resolve) => setTimeout(resolve, LIVE_DELAY_MS));
        }
    });

    console.log(
        `🔴 Streaming live updates for ${liveMatchIds.length} match(es). ` +
        "Score updates are pushed to the website in real time (Ctrl+C to stop).",
    );

    // 3) Stream the remaining commentary one entry at a time per live match.
    while (liveMatchIds.length > 0) {
        const round = [];
        for (const matchId of liveMatchIds) {
            const bucket = streamBuckets.get(matchId);
            const match = matchMap.get(matchId)?.match;
            if (!match || !isLiveMatch(match) || !bucket || bucket.length === 0) {
                continue;
            }
            round.push({ matchId, entry: bucket.shift() });
        }
        if (round.length === 0) {
            break;
        }
        await Promise.all(
            round.map(({ matchId, entry }) => insertCommentaryWithRetry(matchId, entry)),
        );
        await new Promise((resolve) => setTimeout(resolve, STREAM_INTERVAL_MS));
    }

    const finalMatches = await fetchMatches();
    console.log(`✅ Seeding complete. ${finalMatches.length} matches in the database.`);
}

seed().catch((err) => {
    console.error("❌ Seed error:", err);
    process.exit(1);
});