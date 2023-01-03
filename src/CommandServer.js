/**
 * Created by claudio on 2022-12-21
 */
import { createServer } from 'node:http';
import {
    hasJSONContentType,
    readData
} from './RequestUtil.js';

export class CommandServer {
    /**
     * @param {number} port
     * @param {ApiServer} apiServer
     * @param {WSNotificationServer} wsNotifyServer
     */
    constructor(port, apiServer, wsNotifyServer) {
        this.port = port;
        this.apiServer = apiServer;
        this.wsNotifyServer = wsNotifyServer;
    }

    /**
     * Start the Command server
     */
    start() {
        if (!this.server) {
            this.server = createServer(async (req, res) => {
                const url = new URL(req.url, `http://${req.headers.host}`);

                switch (url.pathname) {
                    case '/device-credentials': {
                        if (req.method === 'GET') {
                            sendSuccessResponse(req, res, JSON.stringify(this.apiServer.credentials));
                        }
                        else if (req.method === 'POST' && hasJSONContentType(req)) {
                            const body = await readData(req);
                            let error = false;

                            try {
                                const parsedBody = JSON.parse(body.toString());

                                try {
                                    this.apiServer.credentials = parsedBody;
                                    sendSuccessResponse(req, res);
                                }
                                catch (err) {
                                    error = true;
                                }
                            }
                            catch (err) {
                                error = true;
                            }

                            if (error) {
                                sendErrorResponse(req, res, 400, 'Invalid device credentials');
                            }
                        }
                        else {
                            sendErrorResponse(req, res, 404);
                        }

                        break;
                    }

                    case '/http-context': {
                        if (req.method === 'GET') {
                            sendSuccessResponse(req, res, JSON.stringify(this.apiServer.httpContext));
                        }
                        else if (req.method === 'POST' && hasJSONContentType(req)) {
                            const body = await readData(req);
                            let error = false;

                            try {
                                const parsedBody = JSON.parse(body.toString());

                                try {
                                    this.apiServer.httpContext = parsedBody;
                                    sendSuccessResponse(req, res);
                                }
                                catch (err) {
                                    error = true;
                                }
                            }
                            catch (err) {
                                error = true;
                            }

                            if (error) {
                                sendErrorResponse(req, res, 400, 'Invalid HTTP context');
                            }
                        }
                        else {
                            sendErrorResponse(req, res, 404);
                        }

                        break;
                    }

                    case '/notify-context': {
                        if (req.method === 'GET') {
                            sendSuccessResponse(req, res, JSON.stringify(this.wsNotifyServer.notifyContext));
                        }
                        else if (req.method === 'POST' && hasJSONContentType(req)) {
                            const body = await readData(req);
                            let error = false;

                            try {
                                const parsedBody = JSON.parse(body.toString());

                                try {
                                    this.wsNotifyServer.notifyContext = parsedBody;
                                    sendSuccessResponse(req, res);
                                }
                                catch (err) {
                                    error = true;
                                }
                            }
                            catch (err) {
                                error = true;
                            }

                            if (error) {
                                sendErrorResponse(req, res, 400, 'Invalid notification context');
                            }
                        }
                        else {
                            sendErrorResponse(req, res, 404);
                        }

                        break;
                    }

                    case '/notify-close': {
                        if (req.method === 'POST') {
                            try {
                                // Close all WebSocket notification connection
                                this.wsNotifyServer.closeAllClients();
                                sendSuccessResponse(req, res);
                            }
                            catch (err) {
                                sendErrorResponse(req, res, 500);
                            }
                        }
                        else {
                            sendErrorResponse(req, res, 404);
                        }

                        break;
                    }

                    case '/close': {
                        if (req.method === 'POST') {
                            try {
                                // Close API server, and return
                                await this.apiServer.close();
                                sendSuccessResponse(req, res);

                                // And now, close Command server
                                await this.close();
                            }
                            catch (err) {
                                sendErrorResponse(req, res, 500);
                            }
                        }
                        else {
                            sendErrorResponse(req, res, 404);
                        }

                        break;
                    }

                    default:
                        sendErrorResponse(req, res, 404);
                }
            });

            this.server.on('close', () => {
                console.log('[Catenis API Emulator] - Command server shut down');
            });

            this.server.listen(this.port, () => {
                console.log(`[Catenis API Emulator] - Command server listening at port ${this.port}`);
            });
        }
    }

    /**
     * Close the Command server
     * @return {Promise<void>}
     */
    close() {
        let promiseCall;
        const promise = new Promise((resolve, reject) => {
            promiseCall = {
                resolve,
                reject
            }
        });

        if (this.server) {
            this.server.close((error) => {
                if (error) {
                    promiseCall.reject(error);
                }
                else {
                    promiseCall.resolve();
                }
            });
        }
        else {
            promiseCall.resolve();
        }

        return promise;
    }
}

/**
 * @param {module:http.IncomingMessage} req
 * @param {module:http.ServerResponse} res
 * @param {string} [data]
 * @param {boolean} [isJSON=true]
 */
function sendSuccessResponse(req, res, data, isJSON = true) {
    const reqOrigin = req.headers['origin'];
    let headers = {
        'Access-Control-Allow-Origin': reqOrigin || '*',
    };

    if (reqOrigin) {
        headers['Vary'] = 'Origin';
    }

    if (data) {
        if (isJSON) {
            headers['Content-Type'] = 'application/json';
        }

        headers['Content-Length'] = Buffer.byteLength(data);
    }

    res.writeHead(200, headers);
    res.end(data);
}

/**
 * @param {module:http.IncomingMessage} req
 * @param {module:http.ServerResponse} res
 * @param {number} statusCode
 * @param {string} [errorMessage]
 * @param {boolean} [sendData=true]
 */
function sendErrorResponse(req, res, statusCode, errorMessage, sendData = true) {
    const reqOrigin = req.headers['origin'];
    errorMessage = !errorMessage ? undefined : errorMessage;

    let headers = {
        'Access-Control-Allow-Origin': reqOrigin || '*',
    };

    if (reqOrigin) {
        headers['Vary'] = 'Origin';
    }

    let data;

    if (sendData) {
        data = `Error: [${statusCode}]`;

        if (errorMessage) {
            data += ` - ${errorMessage}`;
        }
    }

    if (data) {
        headers['Content-Type'] = 'text/plain';
        headers['Content-Length'] = Buffer.byteLength(data);
    }

    res.writeHead(statusCode, errorMessage, headers);
    res.end(data);
}
