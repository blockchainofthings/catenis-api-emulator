/**
 * Created by claudio on 2022-12-29
 */
import { WebSocketServer } from 'ws';
import { WSNotificationChannel } from './WSNotificationChannel.js';
import {
    parsedTypeCheck,
    parseType
} from 'type-check';
import {
    jsonDataTypeDef,
    nonEmptyStringTypeDef
} from './ApiServer.js';

const notifyWSSubprotocol = 'notify.catenis.io';
const notificationEvents = new Set([
    'new-msg-received',
    'sent-msg-read',
    'asset-received',
    'asset-confirmed',
    'final-msg-progress',
    'asset-export-outcome',
    'asset-migration-outcome',
    'nf-token-received',
    'nf-token-confirmed',
    'nf-asset-issuance-outcome',
    'nf-token-retrieval-outcome',
    'nf-token-transfer-outcome'
]);

const nonEmptyStringType = parseType('NonEmptyString');
const notificationMessageInfoType = parseType(`{
    data: JsonData,
    timeout: Maybe Number
}`);
const notificationEventNameType = parseType('NotificationEventName');
const eventNotificationMessageType = parseType('EventNotificationMessage');
const notifyContextType = parseType('DeviceEventNotificationMessage');

const notificationEventNameTypeDef = {
    typeOf: 'String',
    validate: d => notificationEvents.has(d)
}
const eventNotificationMessageTypeDef = {
    typeOf: 'Object',
    validate: o => {
        return Object.keys(o).every(key =>
                parsedTypeCheck(notificationEventNameType, key, {
                    customTypes: {
                        NotificationEventName: notificationEventNameTypeDef
                    }
                }) && parsedTypeCheck(notificationMessageInfoType, o[key], {
                    customTypes: {
                        JsonData: jsonDataTypeDef
                    }
                })
        );
    }
};
const deviceEventNotificationMessageTypeDef = {
    typeOf: 'Object',
    validate: o => {
        return Object.keys(o).every(key =>
                parsedTypeCheck(nonEmptyStringType, key, {
                    customTypes: {
                        NonEmptyString: nonEmptyStringTypeDef
                    }
                }) && parsedTypeCheck(eventNotificationMessageType, o[key], {
                    customTypes: {
                        EventNotificationMessage: eventNotificationMessageTypeDef
                    }
                })
        );
    }
}

/**
 * @typedef {Object} NotificationMessageInfo
 * @property {string} data The notification message to be sent (as  JSON object).
 * @property {number} [timeout=0] Time, in milliseconds, to wait before sending notification message.
 */

/**
 * Notification message info per notification event name
 * @typedef {Object<string, NotificationMessageInfo>} EventNotificationMessage
 */

/**
 * Notification event dictionary per virtual device ID
 * @typedef {Object<string, EventNotificationMessage>} DeviceEventNotificationMessage
 */

/**
 * @typedef {DeviceEventNotificationMessage} NotifyContext
 */

export class WSNotificationServer {
    /**
     * @param {ApiServer} apiServer
     */
    constructor (apiServer) {
        /**
         * @type {ApiServer}
         */
        this.apiServer = apiServer;
        this.reWSNotifyPath = new RegExp(`^${this.apiServer.apiBasePath.replace('.', '\\.')}notify/ws/([A-Za-z0-9_\\-]+)$`);
        /**
         * @type {NotifyContext}
         */
        this._notifyContext = undefined;

        this.serverOn = false;
        /**
         * @type {Map<string, Map<string, Set<WSNotificationChannel>>>}
         */
        this.deviceEventNotifyChannels = new Map();

        /**
         * @type {Map<string, number>} Key: <deviceId>_<eventName>, value: <timeoutId>
         */
        this.dispatchNotifyMsgTimeouts = new Map();
    }

    /**
     * @return {NotifyContext}
     */
    get notifyContext() {
        return this._notifyContext;
    }

    /**
     * @param {*} data
     */
    set notifyContext(data) {
        if (!isValidNotifyContext(data)) {
            throw new TypeError('Not a valid NotifyContext data type');
        }

        this._notifyContext = data;
    }

    /**
     * Start the WebSocket server
     */
    start() {
        // Start WebSocket server
        this.wss = new WebSocketServer({
            noServer: true,
            handleProtocols: validateProtocol,
            clientTracking: true
        });

        // Hook up event handlers
        this.wss.on('error', () => {
            this.close();
        });

        this.wss.on('connection', (ws, req) => {
            // Instantiate WebSocket notification channel
            new WSNotificationChannel(this, ws, req);
        });

        // Handle connection upgrade request
        this.apiServer.server.on('upgrade', (req, socket, head) => {
            const url = new URL(req.url, `http://${req.headers.host}`);

            if (this.checkNotificationUrl(url)) {
                // Valid URL. Try to establish WebSocket protocol connection
                this.wss.handleUpgrade(req, socket, head, (ws) => {
                    this.wss.emit('connection', ws, req);
                });
            }
            else {
                // Terminate connection
                socket.destroy();
            }
        });

        // Indicate that server is on
        this.serverOn = true;
    }

    /**
     * Auto dispatch notification messages for a given notification channel.
     * @param {WSNotificationChannel} notifyChannel
     */
    autoDispatchMessages(notifyChannel) {
        if (this._notifyContext && notifyChannel.authenticated) {
            // Check if there are notification messages to be automatically dispatched
            if (notifyChannel.deviceId in this._notifyContext) {
                const eventNotifyMessage = this._notifyContext[notifyChannel.deviceId];

                if (notifyChannel.eventName in eventNotifyMessage) {
                    const notifyMsgInfo = eventNotifyMessage[notifyChannel.eventName];

                    if (notifyMsgInfo.timeout > 0) {
                        // Make sure that notification message is not already waiting to be
                        //  dispatched
                        const key = `${notifyChannel.deviceId}_${notifyChannel.eventName}`;

                        if (!this.dispatchNotifyMsgTimeouts.has(key)) {
                            // Prepare to dispatch notification message (after timeout)
                            const timeout = setTimeout((deviceId, eventName, data) => {
                                this.dispatchNotifyMsgTimeouts.delete(key);
                                this._dispatchNotifyMessage(deviceId, eventName, data);
                            }, notifyMsgInfo.timeout, notifyChannel.deviceId, notifyChannel.eventName, notifyMsgInfo.data);

                            this.dispatchNotifyMsgTimeouts.set(key, timeout);
                        }
                    }
                    else {
                        // Dispatch notification message immediately
                        this._dispatchNotifyMessage(notifyChannel.deviceId, notifyChannel.eventName, notifyMsgInfo.data);
                    }
                }
            }
        }
    }

    /**
     * Close the WebSocket server
     */
    close() {
        if (this.serverOn) {
            this.wss.close(() => {
                this.wss = undefined;
                this.serverOn = false;
            });
        }
    }

    /**
     * Close all client connections
     */
    closeAllClients() {
        if (this.serverOn) {
            for (const ws of this.wss.clients) {
                ws.close(1001, 'Connection closed by end user');
            }

            this._clearDispatchNotifyMsgTimeouts();
        }
    }

    /**
     * Clear timeouts for dispatching notification messages.
     * @private
     */
    _clearDispatchNotifyMsgTimeouts() {
        for (const tmo of this.dispatchNotifyMsgTimeouts.values()) {
            clearTimeout(tmo);
        }

        this.dispatchNotifyMsgTimeouts.clear();
    }

    /**
     * Dispatch notification message, for a given notification event, to all connected clients.
     * @param {string} deviceId
     * @param {string} eventName
     * @param {string} data
     * @return {number} The number of clients to which the message has been sent.
     * @private
     */
    _dispatchNotifyMessage(deviceId, eventName, data) {
        let clientsSent = 0;

        if (this.deviceEventNotifyChannels.has(deviceId)) {
            const eventNotifyChannels = this.deviceEventNotifyChannels.get(deviceId);

            if (eventNotifyChannels.has(eventName)) {
                for (const notifyChannel of eventNotifyChannels.get(eventName)) {
                    notifyChannel.sendMessage(data);
                    clientsSent++;
                }
            }
        }

        return clientsSent;
    }

    /**
     * Check if the given URL is a valid WebSocket notification URL.
     * @param {URL} url
     * @return {(string|false)} The notification event name contained within the URL is returned, if successful. False
     *                           otherwise.
     */
    checkNotificationUrl(url) {
        const matchResult = url.pathname.match(this.reWSNotifyPath);

        return matchResult && notificationEvents.has(matchResult[1]) ? matchResult[1] : false;
    }

    /**
     * @param {WSNotificationChannel} notifyChannel
     */
    saveNotificationChannel(notifyChannel) {
        if (notifyChannel.deviceId) {
            if (this.deviceEventNotifyChannels.has(notifyChannel.deviceId)) {
                const eventNotifyChannels = this.deviceEventNotifyChannels.get(notifyChannel.deviceId);

                if (eventNotifyChannels.has(notifyChannel.eventName)) {
                    eventNotifyChannels.get(notifyChannel.eventName).add(notifyChannel);
                }
                else {
                    eventNotifyChannels.set(notifyChannel.eventName, new Set([notifyChannel]));
                }
            }
            else {
                const eventNotifyChannels = new Map()
                eventNotifyChannels.set(notifyChannel.eventName, new Set([notifyChannel]));

                this.deviceEventNotifyChannels.set(notifyChannel.deviceId, eventNotifyChannels);
            }
        }
    }

    /**
     * @param {WSNotificationChannel} notifyChannel
     */
    discardNotificationChannel(notifyChannel) {
        if (this.deviceEventNotifyChannels.has(notifyChannel.deviceId)) {
            const eventNotifyChannels = this.deviceEventNotifyChannels.get(notifyChannel.deviceId);

            if (eventNotifyChannels.has(notifyChannel.eventName)) {
                const notifyChannels = eventNotifyChannels.get(notifyChannel.eventName);

                notifyChannels.delete(notifyChannel);

                if (notifyChannels.size === 0) {
                    eventNotifyChannels.delete(notifyChannel.eventName);

                    if (eventNotifyChannels.size === 0) {
                        this.deviceEventNotifyChannels.delete(notifyChannel.deviceId);
                    }
                }
            }
        }
    }
}

/**
 * Handler used to validate the subprocotol of the WebSocket connection being established
 * @param {Set<string>} protocols
 * @param {module:http.IncomingMessage} req
 * @return {boolean}
 */
function validateProtocol(protocols, req) {
    let chosenProtocol;

    for (const protocol of protocols) {
        if (protocol === notifyWSSubprotocol) {
            chosenProtocol = protocol;
            break;
        }
    }

    return chosenProtocol !== undefined ? chosenProtocol : false;
}

/**
 * @param {*} data
 * @return {boolean}
 */
function isValidNotifyContext(data) {
    return parsedTypeCheck(notifyContextType, data, {
        customTypes: {
            DeviceEventNotificationMessage: deviceEventNotificationMessageTypeDef
        }
    });
}
