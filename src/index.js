import Agent from 'apminsight';
Agent.config()

import express from 'express';
import {matchRouter} from "./routes/matches.js";
import http from 'http';
import { attachWebSocketServer } from './ws/server.js';
import { securityMiddleware } from './arcjet.js';
import { commentaryRouter } from './routes/commentary.js';


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
app.use('/matches/:id/commentary',commentaryRouter);

const { broadcastMatchCreated, broadcastCommentary, shutdownWebSocketServer } = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;

server.listen(PORT, HOST, () => {
    const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;

    console.log(`Server is running on ${baseUrl}`);
    console.log(`WebSocket Server is running on ${baseUrl.replace('http', 'ws')}/ws`);
});

function shutdown() {
    shutdownWebSocketServer();
    server.close(() => process.exit(0));
    server.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
