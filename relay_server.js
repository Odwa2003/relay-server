// relay_server.js
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

class RelayServer {
    constructor() {
        this.pcConnections = new Map(); // token -> PC WebSocket
        this.phoneConnections = new Map(); // token -> Phone WebSocket
        this.server = http.createServer();
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.setupWebSocketServer();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (ws, request) => {
            const parsedUrl = url.parse(request.url, true);
            const token = parsedUrl.query.token;
            const clientType = parsedUrl.query.client; // 'pc' or 'phone'

            if (!token) {
                ws.close(1008, 'Token required');
                return;
            }

            if (!clientType || !['pc', 'phone'].includes(clientType)) {
                ws.close(1008, 'Client type must be "pc" or "phone"');
                return;
            }

            console.log(`New ${clientType} connection for token: ${token}`);

            if (clientType === 'pc') {
                this.handlePCConnection(ws, token);
            } else {
                this.handlePhoneConnection(ws, token);
            }

            // Setup message relay
            ws.on('message', (data) => {
                this.handleMessage(ws, token, clientType, data.toString());
            });

            ws.on('close', () => {
                this.handleDisconnection(token, clientType);
            });

            ws.on('error', (error) => {
                console.error(`WebSocket error for ${clientType} (${token}):`, error);
                this.handleDisconnection(token, clientType);
            });
        });
    }

    handlePCConnection(ws, token) {
        // Close existing PC connection for this token
        if (this.pcConnections.has(token)) {
            const oldPC = this.pcConnections.get(token);
            oldPC.close(1000, 'New PC connection');
        }

        this.pcConnections.set(token, ws);
        console.log(`PC registered for token: ${token}`);

        // Notify phone if connected
        const phoneWS = this.phoneConnections.get(token);
        if (phoneWS && phoneWS.readyState === WebSocket.OPEN) {
            phoneWS.send(JSON.stringify({ type: 'relay_status', pc_connected: true }));
        }

        // Send connection confirmation to PC
        ws.send(JSON.stringify({ type: 'relay_status', status: 'connected', role: 'pc' }));
    }

    handlePhoneConnection(ws, token) {
        // Close existing phone connection for this token
        if (this.phoneConnections.has(token)) {
            const oldPhone = this.phoneConnections.get(token);
            oldPhone.close(1000, 'New phone connection');
        }

        this.phoneConnections.set(token, ws);
        console.log(`Phone registered for token: ${token}`);

        // Notify phone about PC status
        const pcWS = this.pcConnections.get(token);
        const pcConnected = !!(pcWS && pcWS.readyState === WebSocket.OPEN);
        
        ws.send(JSON.stringify({ 
            type: 'relay_status', 
            pc_connected: pcConnected,
            status: 'connected',
            role: 'phone'
        }));

        // Notify PC about phone connection
        if (pcConnected) {
            pcWS.send(JSON.stringify({ type: 'relay_status', phone_connected: true }));
        }
    }

    handleMessage(ws, token, clientType, message) {
        console.log(`Message from ${clientType} (${token}):`, message);

        try {
            const data = JSON.parse(message);
            
            // Handle authentication messages separately
            if (data.type === 'auth') {
                this.handleAuthMessage(token, clientType, data);
                return;
            }

            // Relay messages between clients
            if (clientType === 'phone') {
                // Phone → PC relay
                const pcWS = this.pcConnections.get(token);
                if (pcWS && pcWS.readyState === WebSocket.OPEN) {
                    pcWS.send(message);
                    console.log(`Relayed message from phone to PC for token: ${token}`);
                } else {
                    // Notify phone that PC is not connected
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        error: 'PC not connected',
                        pc_connected: false 
                    }));
                }
            } else if (clientType === 'pc') {
                // PC → Phone relay (responses)
                const phoneWS = this.phoneConnections.get(token);
                if (phoneWS && phoneWS.readyState === WebSocket.OPEN) {
                    phoneWS.send(message);
                    console.log(`Relayed message from PC to phone for token: ${token}`);
                }
            }
        } catch (error) {
            console.error('Error handling message:', error);
            ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
        }
    }

    handleAuthMessage(token, clientType, data) {
        // For relay server, we don't validate tokens - just pass through
        const targetWS = clientType === 'phone' 
            ? this.pcConnections.get(token) 
            : this.phoneConnections.get(token);

        if (targetWS && targetWS.readyState === WebSocket.OPEN) {
            targetWS.send(JSON.stringify(data));
        }
    }

    handleDisconnection(token, clientType) {
        if (clientType === 'pc') {
            this.pcConnections.delete(token);
            console.log(`PC disconnected for token: ${token}`);
            
            // Notify phone
            const phoneWS = this.phoneConnections.get(token);
            if (phoneWS && phoneWS.readyState === WebSocket.OPEN) {
                phoneWS.send(JSON.stringify({ type: 'relay_status', pc_connected: false }));
            }
        } else {
            this.phoneConnections.delete(token);
            console.log(`Phone disconnected for token: ${token}`);
            
            // Notify PC
            const pcWS = this.pcConnections.get(token);
            if (pcWS && pcWS.readyState === WebSocket.OPEN) {
                pcWS.send(JSON.stringify({ type: 'relay_status', phone_connected: false }));
            }
        }
    }

    start(port = process.env.PORT || 8080) {
        this.server.listen(port, () => {
            console.log(`Relay server running on port ${port}`);
            console.log('WebSocket endpoint: ws://HOST:' + port);
        });
    }
}

// Start the server
const relayServer = new RelayServer();
relayServer.start();