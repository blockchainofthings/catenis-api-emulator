/**
 * Created by claudio on 2022-12-20
 */
import { createServer } from 'node:http';
import {
    typeCheck,
    parseType,
    parsedTypeCheck
} from 'type-check';
import {
    hasJSONContentType,
    readData
} from './RequestUtil.js';
import {
    AuthenticationError,
    parseHttpRequestAuthentication,
    signHttpRequest
} from './Authentication.js';

const httpContentType = parseType(`{
    expectedRequest: {
        httpMethod: HttpMethod,
        apiMethodPath: HttpPath,
        data: Maybe JsonData,
        authenticate: Maybe Boolean
    },
    requiredResponse: Maybe {
        data: JsonData
    } | {
        statusCode: Number,
        errorMessage: String
    }
}`);
const deviceCredentialsType = parseType(`{
    deviceId: NonEmptyString,
    apiAccessSecret: String
}`);

const httpMethodTypeDef = {
    typeOf: 'String',
    validate: d => d === 'GET' || d === 'POST'
};
const httpPathTypeDef = {
    typeOf: 'String',
    validate: (d) => {
        let ok = true;

        try {
            new URL(d, 'http://host');
        }
        catch (err) {
            ok = false;
        }

        return ok;
    }
};
const jsonDataTypeDef = {
    typeOf: 'String',
    validate: (d) => {
        let ok;

        try {
            const p = JSON.parse(d);
            ok = p !== null;
        }
        catch (err) {
            ok = false;
        }

        return ok;
    }
};
const nonEmptyStringTypeDef = {
    typeOf: 'String',
    validate: (d) => d.length > 0
};

/**
 * @typedef {('GET','POST')} HttpRequestMethod
 */

/**
 * @typedef {Object} HttpRequest
 * @property {HttpRequestMethod} httpMethod HTML method of request.
 * @property {string} apiMethodPath Catenis API method path, with an optional leading '/' character and query string
 *                                   (e.g. /messages/mjvHYitWYCbJHvKqT3vk?encoding=utf8).
 * @property {string} [data] JSON of the received data.
 * @property {boolean} [authenticate=true] Indicates whether the request should be authenticated (validate Authorization
 *                                          header)
 */

/**
 * @typedef {Object} HttpErrorResponse
 * @property {number} statusCode
 * @property {string} errorMessage
 */

/**
 * @typedef {Object} HttpSuccessResponse
 * @property {string} data JSON of the data to be returned.
 */

/**
 * @typedef {(HttpSuccessResponse|HttpErrorResponse)} HttpResponse
 */

/**
 * @typedef {Object} HttpContext
 * @property {HttpRequest} expectedRequest
 * @property {HttpResponse} [requiredResponse]
 */

/**
 * @typedef {Object} DeviceCredentials
 * @property {string} deviceId
 * @property {string} apiAccessSecret
 */

export class ApiServer {
    /**
     * @param {number} port
     * @param {string} apiVersion
     * @param {DeviceCredentials} [credentials]
     */
    constructor(port, apiVersion, credentials) {
        this.port = port;
        this.apiBasePath = `/api/${apiVersion}/`;
        /**
         * @type {DeviceCredentials}
         */
        this._credentials = credentials;
        /**
         * @type {HttpContext}
         */
        this._httpContext = undefined;
    }

    get httpContext() {
        return this._httpContext;
    }

    /**
     * @param {*} data
     */
    set httpContext(data) {
        if (!isValidHttpContext(data)) {
            throw new TypeError('Not a valid HttpContext data type');
        }

        this._httpContext = data;
    }

    get credentials() {
        return this._credentials;
    }

    /**
     * @param {*} data
     */
    set credentials(data) {
        if (!isValidDeviceCredentials(data)) {
            throw new TypeError('Not a valid DeviceCredentials data type');
        }

        this._credentials = data;
    }

    /**
     * Start the API server
     * @return {Promise<void>}
     */
    start() {
        let promiseCall;
        const promise = new Promise((resolve, reject) => {
            promiseCall = {
                resolve,
                reject
            }
        });

        if (!this.server) {
            this.server = createServer(async (req, res) => {
                if (!this._httpContext) {
                    sendErrorResponse(req, res, 500, 'Missing HTTP context');
                    return;
                }

                const url = new URL(req.url, `http://${req.headers.host}`);

                // Validate request method
                if (req.method !== this._httpContext.expectedRequest.httpMethod) {
                    sendErrorResponse(req, res, 500, `Unexpected HTTP request method: expected: ${this._httpContext.expectedRequest.httpMethod}; received: ${req.method}`);
                    return;
                }

                const apiMethodPath = this._httpContext.expectedRequest.apiMethodPath;
                const expectedUrl = new URL(apiMethodPath.startsWith('/') ? apiMethodPath.substring(1) : apiMethodPath, new URL(this.apiBasePath, `http://${req.headers.host}`).href);

                // Validate request path
                if (url.pathname !== expectedUrl.pathname || !areUrlsSearchEqual(url, expectedUrl)) {
                    sendErrorResponse(req, res, 500, `Unexpected HTTP request path: expected: ${expectedUrl.pathname + expectedUrl.search}; received: ${url.pathname + url.search}`);
                    return;
                }

                let reqBody;

                if (this._httpContext.expectedRequest.data) {
                    // Validate request body
                    reqBody = await readData(req);

                    if (reqBody.length > 0) {
                        if (!hasJSONContentType(req)) {
                            sendErrorResponse(req, res, 500, `Inconsistent content type: expected: application/json; received: ${req.headers['content-type']}`);
                            return;
                        }

                        const strBody = reqBody.toString();

                        if (strBody !== this._httpContext.expectedRequest.data) {
                            sendErrorResponse(req, res, 500, `Unexpected HTTP request body:\n expected: ${this._httpContext.expectedRequest.data}\n received: ${strBody}`);
                            return;
                        }
                    }
                }

                if (this._httpContext.expectedRequest.authenticate === true || this._httpContext.expectedRequest.authenticate === undefined) {
                    if (!this._credentials) {
                        sendErrorResponse(req, res, 500, 'Missing device credentials');
                        return;
                    }

                    // Authenticate request
                    try {
                        // Parse HTTP request to retrieve relevant authentication data
                        const authData = parseHttpRequestAuthentication(req.headers);

                        if (authData.deviceId !== this._credentials.deviceId) {
                            sendErrorResponse(req, res, 500, `Inconsistent device ID in signature: expected: ${this._credentials.deviceId}; received: ${authData.deviceId}`);
                            return;
                        }

                        // Sign request and validate signature
                        const reqSignature = signHttpRequest(req, {
                            timestamp: authData.timestamp,
                            signDate: authData.signDate,
                            apiAccessSecret: this._credentials.apiAccessSecret,
                            reqBody: reqBody !== undefined ? reqBody : await readData(req)
                        });

                        if (reqSignature !== authData.signature) {
                            sendErrorResponse(req, res, 500, `Inconsistent request signature:\n expected: ${reqSignature}\n received: ${authData.signature}`);
                            return;
                        }
                    }
                    catch (err) {
                        let error;

                        if (err instanceof AuthenticationError) {
                            if (err.code === 'parse_err_missing_headers') {
                                sendErrorResponse(req, res, 401, 'Authorization failed; missing required HTTP headers');
                            }
                            else if (err.code === 'parse_err_malformed_timestamp') {
                                sendErrorResponse(req, res, 401, 'Authorization failed; timestamp not well formed');
                            }
                            else if (err.code === 'parse_err_timestamp_out_of_bounds') {
                                sendErrorResponse(req, res, 401, 'Authorization failed; timestamp not within acceptable time variation');
                            }
                            else if (err.code === 'parse_err_malformed_auth_header') {
                                sendErrorResponse(req, res, 401, 'Authorization failed; authorization value not well formed');
                            }
                            else if (err.code === 'parse_err_malformed_sign_date') {
                                sendErrorResponse(req, res, 401, 'Authorization failed; signature date not well formed');
                            }
                            else if (err.code === 'parse_err_sign_date_out_of_bounds') {
                                sendErrorResponse(req, res, 401, 'Authorization failed; signature date out of bounds');
                            }
                            else {
                                sendErrorResponse(req, res, 500, 'Internal server error');
                            }
                        }
                        else {
                            sendErrorResponse(req, res, 500, 'Internal server error');
                        }

                        return;
                    }
                }

                if (this._httpContext.requiredResponse) {
                    const requiredResponse = this._httpContext.requiredResponse;

                    if (requiredResponse.errorMessage) {
                        sendErrorResponse(req, res, requiredResponse.statusCode, requiredResponse.errorMessage);
                    }
                    else {
                        sendSuccessResponse(req, res, JSON.parse(requiredResponse.data));
                    }
                }
                else {
                    sendSuccessResponse(req, res);
                }
            });

            this.server.on('close', () => {
                console.log('[Catenis API Emulator] - API server shut down');
            });

            this.server.listen(this.port, () => {
                console.log(`[Catenis API Emulator] - API server listening at port ${this.port}`);
                promiseCall.resolve();
            });
        }
        else {
            promiseCall.resolve();
        }

        return promise;
    }

    /**
     * Close the API server
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
 * @param {*} data
 * @return {boolean}
 */
function isValidHttpContext(data) {
    return parsedTypeCheck(httpContentType, data, {
        customTypes: {
            HttpMethod: httpMethodTypeDef,
            HttpPath: httpPathTypeDef,
            JsonData: jsonDataTypeDef
        }
    });
}

/**
 * @param {*} data
 * @return {boolean}
 */
function isValidDeviceCredentials(data) {
    return parsedTypeCheck(deviceCredentialsType, data, {
        customTypes: {
            NonEmptyString: nonEmptyStringTypeDef
        }
    });
}

/**
 * @param {module:http.IncomingMessage} req
 * @param {module:http.ServerResponse} res
 * @param {*} [data]
 */
function sendSuccessResponse(req, res, data) {
    const reqOrigin = req.headers['origin'];
    let headers = {
        'Access-Control-Allow-Origin': reqOrigin || '*',
    };

    if (reqOrigin) {
        headers['Vary'] = 'Origin';
    }

    let resData;

    if (data) {
        resData = JSON.stringify({
            status: 'success',
            data
        }, null, 2);

        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(resData);
    }

    res.writeHead(200, headers);
    res.end(resData);
}

/**
 * @param {module:http.IncomingMessage} req
 * @param {module:http.ServerResponse} res
 * @param {number} statusCode
 * @param {string} errorMessage
 */
function sendErrorResponse(req, res, statusCode, errorMessage) {
    const reqOrigin = req.headers['origin'];

    let headers = {
        'Access-Control-Allow-Origin': reqOrigin || '*',
    };

    if (reqOrigin) {
        headers['Vary'] = 'Origin';
    }

    const resData = JSON.stringify({
        status: 'error',
        message: errorMessage
    }, null, 2);

    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(resData);

    res.writeHead(statusCode, headers);
    res.end(resData);
}

/**
 * Check if the search components (query strings) of two URLs are equal
 * @param {URL} url1
 * @param {URL} url2
 * @return {boolean}
 */
function areUrlsSearchEqual(url1, url2) {
    let equal = false;

    const sp1 = url1.searchParams;
    const sp2 = url2.searchParams;

    const keys1 = Array.from(sp1.keys());
    const keys2 = Array.from(sp2.keys());

    if (keys1.length === keys2.length) {
        const uniqKeys = new Set(keys1);

        equal = true;

        for (const k of uniqKeys) {
            if (!sp2.has(k) || !areArraysEqual(sp2.getAll(k), sp1.getAll(k))) {
                equal = false;
                break;
            }
        }
    }

    return equal;
}

/**
 * Check if two arrays contain the same elements
 * @param {any[]} a1
 * @param {any[]} a2
 * @return {boolean}
 */
function areArraysEqual(a1, a2) {
    let equal = false;

    if (a1.length === a2.length) {
        if (a1.length === 1) {
            equal = a1[0] === a2[0];
        }
        else {
            const a3 = a1.concat().sort();
            const a4 = a2.concat().sort();

            equal = true;

            for (let i = 0, l = a3.length; i < l; i++) {
                if (a3[i] !== a4[i]) {
                    equal = false;
                    break;
                }
            }
        }
    }

    return equal;
}