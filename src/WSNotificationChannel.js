/**
 * Created by claudio on 2022-12-30
 */
import { WebSocket } from  'ws';
import {
    timestampHdr,
    authHeader
} from './Authentication.js';

const heartbeatInterval = 30000;    // (30 sec.)
const authMsgTimeout =  5000;   // (5 sec.)
const notifyChannelOpenMsg = 'NOTIFICATION_CHANNEL_OPEN';

export class WSNotificationChannel {
    /**
     * @param {WSNotificationServer} wsNotifyServer
     * @param {WebSocket} ws
     * @param {module:http.IncomingMessage} req The HTTP request used for establishing the WebSocket connection (the
     *                                           connection upgrade request)
     */
    constructor(wsNotifyServer, ws, req) {
        this.wsNotifyServer = wsNotifyServer;
        this.ws = ws;
        this.req = req;

        /**
         * @type {string}
         */
        this.eventName = this.wsNotifyServer.checkNotificationUrl(new URL(req.url, `http://${req.headers.host}`));
        /**
         * @type {string}
         */
        this.deviceId = undefined;

        // Client heartbeat control
        this.isAlive = true;
        this.heartbeatInterval = undefined;

        // Hook up event handlers
        this.ws.onclose = this._closeHandler.bind(this);
        this.ws.onmessage = this._messageHandler.bind(this);

        this.ws.on('pong', () => {
            this.isAlive = true;
        });

        // Wait for client authentication
        this.authenticationTimeout = setTimeout(this._authenticationTimeout.bind(this), authMsgTimeout);
    }

    /**
     * Indicates whether client has already been authenticated
     * @return {boolean}
     */
    get authenticated() {
        return !!this.deviceId;
    }

    /**
     * Send notification message to client
     * @param {string} data
     * @param {Function} [callback]
     */
    sendMessage(data, callback) {
        // Make sure that client connection is open and client is authenticated
        if (this.ws.readyState === WebSocket.OPEN && this.authenticated) {
            // Send message to client
            this.ws.send(data, {
                compress: false,
                binary: false,
                fin: true
            }, callback);
        }
    }

    /**
     * Handler for timeout while waiting for client authentication
     * @private
     */
    _authenticationTimeout() {
        if (!this.authenticated) {
            // Close connection
            this.ws.close(1002, 'Failed to receive authentication message');
        }
    }

    /**
     * Handler for sending ping to client for checking its heartbeat
     * @private
     */
    _heartbeatPing() {
        if (!this.isAlive) {
            // Have not received heartbeat pong package from client.
            //  Assume it is down and terminate its connection
            return this.ws.terminate();
        }

        this.isAlive = false;
        this.ws.ping();
    }

    /**
     * Start client heartbeat check
     * @private
     */
    _startHeartbeatCheck() {
        this.heartbeatInterval = setInterval(this._heartbeatPing.bind(this), heartbeatInterval);
    }

    /**
     * Stop client heartbeat check
     * @private
     */
    _stopHeartbeatCheck() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
        }
    }

    /**
     * Handler for close event
     * @param {CloseEvent} event
     * @private
     */
    _closeHandler(event) {
        if (!this.authenticated) {
            clearTimeout(this.authenticationTimeout);
        }

        this._stopHeartbeatCheck();

        this.wsNotifyServer.discardNotificationChannel(this);
    }

    /**
     * Handler for message event
     * @param {MessageEvent} event
     * @private
     */
    _messageHandler(event) {
        // We only care for authentication message. So make sure that
        //  client has not yet been authentication
        if (!this.authenticated) {
            let error;

            // Make sure that this is an authentication message
            if (typeof event.data === 'string') {
                let parsedData;

                try {
                    parsedData = JSON.parse(event.data);
                }
                catch (err) {}

                if (typeof parsedData === 'object' && parsedData !== null && (timestampHdr in parsedData) &&
                        (authHeader in parsedData)) {
                    // Add authentication info to connection request and try to authenticate client/device
                    this.req.headers[timestampHdr] = parsedData[timestampHdr];
                    this.req.headers[authHeader] = parsedData[authHeader];

                    const authResult = this.wsNotifyServer.apiServer.authenticateRequest(this.req);

                    if (typeof authResult === 'string') {
                        // Get ID of authenticated virtual device, save notification channel, and
                        //  start client heartbeat check
                        this.deviceId = authResult;
                        this.wsNotifyServer.saveNotificationChannel(this);
                        this._startHeartbeatCheck();

                        // Send notification channel open message
                        this.sendMessage(notifyChannelOpenMsg, () => this.wsNotifyServer.autoDispatchMessages(this));

                        return;
                    }
                    else {
                        // Error authenticating device. Get error
                        error = {
                            code: authResult.code === 500 ? 1011 : 1002,
                            reason: authResult.message
                        };
                    }
                }
            }

            // If this point is reached, the client authentication has failed
            if (error === undefined) {
                // If no error set, it was not a valid authentication message
                error = {
                    code: 1002,
                    reason: 'Invalid authentication message'
                }
            }

            // Close the client connection
            this.ws.close(error.code, error.reason);
        }
    }
}