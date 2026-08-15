import Agent from 'apminsight';
Agent.config()

import express from 'express';
import {matchRouter} from "./routes/matches.js";
import http from 'http';
import { attachWebSocketServer } from './ws/server.js';
import { securityMiddleware } from './arcjet.js';
import { commentaryRouter } from './routes/commentary.js';
import { db } from './db/index.js';
import { matches } from './db/schema.js';
import { syncAllMatchStatuses } from './utils/match-status.js';
import { syncLiveMatches } from './live/index.js';


const app = express();
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer(app);

app.get('/', (req, res) => {
    res.send('Hello from Express server!');
});

app.use(express.json());

app.use(securityMiddleware());
app.use('/matches', matchRouter)
app.use('/matches', commentaryRouter);

const { broadcastMatchCreated, broadcastCommentary, broadcastMatchUpdate, shutdownWebSocketServer } = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;
app.locals.broadcastMatchUpdate = broadcastMatchUpdate;

const STATUS_SYNC_INTERVAL_MS = Number(process.env.STATUS_SYNC_INTERVAL_MS || 30000);
const statusSyncTimer = setInterval(async () => {
    try {
        const changed = await syncAllMatchStatuses(db, matches);
        for (const match of changed) {
            broadcastMatchUpdate(match.id, match);
        }
    } catch (e) {
        console.error('Match status sync failed', e);
    }
}, STATUS_SYNC_INTERVAL_MS);
statusSyncTimer.unref();

// Poll real scoreboards (ESPN) and upsert live/scheduled/finished games,
// broadcasting match_created/match_updated over WebSocket as they change.
const LIVE_FETCH_INTERVAL_MS = Number(process.env.LIVE_FETCH_INTERVAL_MS || 20000);
let liveFetchInFlight = false;

async function runLiveFetch() {
    if (liveFetchInFlight) return;
    liveFetchInFlight = true;
    try {
        const result = await syncLiveMatches({
            broadcastMatchCreated,
            broadcastMatchUpdate,
            broadcastCommentary,
        });
        if (result.total > 0) {
            console.log(`[live] ${result.total} games (${result.created} new, ${result.updated} updated)`);
        }
    } catch (e) {
        console.error('[live] scoreboard sync failed', e);
    } finally {
        liveFetchInFlight = false;
    }
}

const liveFetchTimer = setInterval(runLiveFetch, LIVE_FETCH_INTERVAL_MS);
liveFetchTimer.unref();
runLiveFetch();

server.listen(PORT, HOST, () => {
    const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;

    console.log(`Server is running on ${baseUrl}`);
    console.log(`WebSocket Server is running on ${baseUrl.replace('http', 'ws')}/ws`);
});

function shutdown() {
    clearInterval(statusSyncTimer);
    clearInterval(liveFetchTimer);
    shutdownWebSocketServer();
    server.close(() => process.exit(0));
    server.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
