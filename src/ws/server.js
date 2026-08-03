import { WebSocket, WebSocketServer } from 'ws';

//stringify and send a payload to a specific socket
function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify(payload));
}


//broadcast a payload to all connected sockets
function broadcast(wss, payload) {
  for (const socket of wss.clients) {
    if (socket.readyState !== WebSocket.OPEN) {
      continue;
    }
    socket.send(JSON.stringify(payload));
  }
}

//attach a WebSocket server to an existing HTTP server
export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });

  wss.on('connection', async (socket, req) => {
    if (typeof wsArcjet !== 'undefined' && wsArcjet) {
      try {
        const decision = await wsArcjet.protect(req);

        if (decision.isDenied()) {
          const code = decision.reason && decision.reason.isRateLimit ? 1013 : 1008;
          const reason = decision.reason && decision.reason.isRateLimit ? 'Rate limit exceeded' : 'Access denied';

          socket.close(code, reason);
          return;
        }
      } catch (err) {
        console.error('wsArcjet protection failed:', err);
        // If protection fails, close the socket with an internal error code
        try { socket.close(1011, 'Internal error'); } catch (e) {}
        return;
      }
    }

    sendJson(socket, { type: 'welcome' });

    socket.on('error', console.error);
  });

  function broadcastMatchCreated(match) {
    broadcast(wss, { type: 'match_created', data: match });
  }

  return { broadcastMatchCreated }
}
