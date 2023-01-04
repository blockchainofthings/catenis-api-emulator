/**
 * Created by claudio on 2022-12-20
 */
import { createServer } from 'node:http';
import {
    parseType,
    parsedTypeCheck
} from 'type-check';
import {
    hasJSONContentType,
    readData,
    isCORSPreflightRequest
} from './RequestUtil.js';
import {
    AuthenticationError,
    parseHttpRequestAuthentication,
    signHttpRequest
} from './Authentication.js';
import { display } from './main.js';

const httpContextType = parseType(`{
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
} | [{
    deviceId: NonEmptyString,
    apiAccessSecret: String
}]`);

const httpMethodTypeDef = {
    typeOf: 'String',
    validate: d => d === 'GET' || d === 'POST'
};
const httpPathTypeDef = {
    typeOf: 'String',
    validate: d => {
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
export const jsonDataTypeDef = {
    typeOf: 'String',
    validate: d => {
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
export const nonEmptyStringTypeDef = {
    typeOf: 'String',
    validate: d => d.length > 0
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
 * @typedef {Object} SingleDeviceCredentials
 * @property {string} deviceId
 * @property {string} apiAccessSecret
 */

/**
 * @typedef {SingleDeviceCredentials[]} DeviceCredentialsList
 */

/**
 * @typedef {(SingleDeviceCredentials|DeviceCredentialsList)} DeviceCredentials
 */

export class ApiServer {
    /**
     * @param {number} port
     * @param {string} apiVersion
     */
    constructor(port, apiVersion) {
        this.port = port;
        this.apiBasePath = `/api/${apiVersion}/`;
        /**
         * @type {Map<string, SingleDeviceCredentials>}
         */
        this._deviceCredentials = new Map();
        /**
         * @type {HttpContext}
         */
        this._httpContext = undefined;
    }

    /**
     * @return {HttpContext}
     */
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

    /**
     * @return {DeviceCredentialsList}
     */
    get credentials() {
        return Array.from(this._deviceCredentials.values());
    }

    /**
     * @param {*} data
     */
    set credentials(data) {
        if (!isValidDeviceCredentials(data)) {
            throw new TypeError('Not a valid DeviceCredentials data type');
        }

        this._deviceCredentials.clear();

        for (const singleCredentials of (Array.isArray(data) ? data : [data])) {
            this._deviceCredentials.set(singleCredentials.deviceId, singleCredentials);
        }
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
                // Filter and process CORS preflight request
                if (isCORSPreflightRequest(req)) {
                    sendCORSPreflightResponse(req, res);
                    return;
                }

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
                    // Authenticate request
                    const authResult = this.authenticateRequest(req, reqBody);

                    if (typeof authResult === 'object') {
                        // Authentication has failed. Send error response
                        sendErrorResponse(req, res, authResult.code, authResult.message);
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
                display.log('[Catenis API Emulator] - API server shut down');
            });

            this.server.listen(this.port, () => {
                display.log(`[Catenis API Emulator] - API server listening at port ${this.port}`);
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

    /**
     * @typedef {Object} ErrorResponseInfo
     * @property {number} code
     * @property {string} message
     */

    /**
     * Authenticate an incoming HTTP request.
     * @param {module:http.IncomingMessage} req
     * @param {Buffer} [reqBody]
     * @return {(string|ErrorResponseInfo)} The ID of the authenticated virtual device if successful, or the information
     *                                       about the error to be sent as the response.
     */
    authenticateRequest(req, reqBody) {
        try {
            // Parse HTTP request to retrieve relevant authentication data
            const authData = parseHttpRequestAuthentication(req.headers);

            // Get credentials of the device to authenticate
            const deviceCredentials = this._deviceCredentials.get(authData.deviceId);

            if (!deviceCredentials) {
                // No device found. Return error
                return {
                    code: 401,
                    message: 'Authorization failed; invalid device or signature'
                };
            }

            // Sign request and validate signature
            const reqSignature = signHttpRequest(req, {
                timestamp: authData.timestamp,
                signDate: authData.signDate,
                apiAccessSecret: deviceCredentials.apiAccessSecret,
                reqBody: reqBody !== undefined ? reqBody : Buffer.from('')
            });

            if (reqSignature !== authData.signature) {
                // Invalid signature. Return error
                return {
                    code: 401,
                    message: 'Authorization failed; invalid device or signature'
                };
            }

            // Success. Return ID of authenticated virtual device
            return authData.deviceId;
        }
        catch (err) {
            let error;

            if (err instanceof AuthenticationError) {
                if (err.code === 'parse_err_missing_headers') {
                    error = {
                        code: 401,
                        message: 'Authorization failed; missing required HTTP headers'
                    };
                }
                else if (err.code === 'parse_err_malformed_timestamp') {
                    error = {
                        code: 401,
                        message: 'Authorization failed; timestamp not well formed'
                    };
                }
                else if (err.code === 'parse_err_timestamp_out_of_bounds') {
                    error = {
                        code: 401,
                        message: 'Authorization failed; timestamp not within acceptable time variation'
                    };
                }
                else if (err.code === 'parse_err_malformed_auth_header') {
                    error = {
                        code: 401,
                        message: 'Authorization failed; authorization value not well formed'
                    };
                }
                else if (err.code === 'parse_err_malformed_sign_date') {
                    error = {
                        code: 401,
                        message: 'Authorization failed; signature date not well formed'
                    };
                }
                else if (err.code === 'parse_err_sign_date_out_of_bounds') {
                    error = {
                        code: 401,
                        message: 'Authorization failed; signature date out of bounds'
                    };
                }
                else {
                    error = {
                        code: 500,
                        message: 'Internal server error'
                    };
                }
            }
            else {
                error = {
                    code: 500,
                    message: 'Internal server error'
                };
            }

            return error;
        }
    }
}

/**
 * @param {*} data
 * @return {boolean}
 */
function isValidHttpContext(data) {
    return parsedTypeCheck(httpContextType, data, {
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
 * @param {module:http.IncomingMessage} req
 * @param {module:http.ServerResponse} res
 */
function sendCORSPreflightResponse(req, res) {
    const reqOrigin = req.headers['origin'];

    let headers = {
        'Access-Control-Allow-Origin': reqOrigin || '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'DNT, X-CustomHeader, Keep-Alive, User-Agent, X-Requested-With, If-Modified-Since, Cache-Control, Accept, Origin, Content-Type, Content-Encoding, Accept-Encoding, X-Bcot-Timestamp, Authorization',
        'Access-Control-Max-Age': 86400
    };

    if (reqOrigin) {
        headers['Vary'] = 'Origin';
    }

    res.writeHead(204, headers);
    res.end();
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
