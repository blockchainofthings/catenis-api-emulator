/**
 * Created by claudio on 2022-12-23
 */
import crypto from 'node:crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isBetween from 'dayjs/plugin/isBetween.js';

dayjs.extend(utc);
dayjs.extend(customParseFormat);
dayjs.extend(isBetween);

const signVersionId = 'CTN1',
    signMethodId = 'CTN1-HMAC-SHA256',
    scopeRequest = 'ctn1_request',
    signValidDays = 7,
    allowedTimestampOffset = 300;
export const timestampHdr = 'x-bcot-timestamp',
    authHeader = 'authorization';

const authRegex = new RegExp(`^${signMethodId} +(?:C|c)redential *= *(\\w{20})/(\\d{8})/${scopeRequest} *, *(?:S|s)ignature *= *([0-9a-fA-F]{64}) *$`);

export class AuthenticationError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {Object} [options]
     */
    constructor(code, message, options) {
        super(message, options);

        this.code = code;
    }
}

/**
 * @typedef {Object} ParsedAuthenticationData
 * @property {string} timestamp
 * @property {string} deviceId
 * @property {string} signDate
 * @property {string} signature
 */

/**
 * Parse HTTP request headers to retrieve authentication relevant data from it.
 * @param {Object<string, string>} headers
 * @return {ParsedAuthenticationData}
 */
export function parseHttpRequestAuthentication(headers) {
    const now = dayjs().millisecond(0);

    // Make sure that required headers are present
    if (!(timestampHdr in headers) || !(authHeader in headers)) {
        // Missing required HTTP headers. Log error and throw exception
        throw new AuthenticationError('parse_err_missing_headers', 'Error parsing HTTP request for authentication: missing required HTTP headers');
    }

    // Make sure that timestamp is valid
    const strTmstmp = headers[timestampHdr],
        // NOTE: the approach below of using dayjs.utc(), escaping the Z character in the format string and applying
        //        local() to the result (instead of simply using dayjs() with the unescaped Z character) is to overcome
        //        an issue with Day.js (as of version 1.11.7) that fails to strictly parse a date string with the Z
        //        (UTC/Zulu) timezone specifier.
        tmstmp = dayjs.utc(strTmstmp, 'YYYYMMDDTHHmmss[Z]', true).local();

    if (!tmstmp.isValid()) {
        // Timestamp not well formed. Log error and throw exception
        throw new AuthenticationError('parse_err_malformed_timestamp', 'Error parsing HTTP request for authentication: timestamp not well formed');
    }

    if (!tmstmp.isBetween(now.subtract(allowedTimestampOffset, 'seconds'), now.add(allowedTimestampOffset, 'seconds'), null, '[]')) {
        // Timestamp not within acceptable time variation. Log error and throw exception
        throw new AuthenticationError('parse_err_timestamp_out_of_bounds', 'Error parsing HTTP request for authentication: timestamp not within acceptable time variation');
    }

    // Try to parse Authorization header
    let matchResult;

    if (!(matchResult = headers[authHeader].match(authRegex))) {
        // HTTP Authorization header value not well formed. Log error and throw exception
        throw new AuthenticationError('parse_err_malformed_auth_header', 'Error parsing HTTP request for authentication: authorization value not well formed');
    }

    const deviceId = matchResult[1],
        strSignDate = matchResult[2],
        signature = matchResult[3];

    // Make sure that date of signature is valid
    const signDate = dayjs.utc(strSignDate, 'YYYYMMDD', true);

    if (!signDate.isValid()) {
        // Signature date not well formed. Log error and throw exception
        throw new AuthenticationError('parse_err_malformed_sign_date', 'Error parsing HTTP request for authentication: signature date not well formed');
    }

    if (!now.utc().isBetween(signDate, signDate.add(signValidDays, 'days'), 'day', '[)')) {
        // Signature date out of bounds. Log error and throw exception
        throw new AuthenticationError('parse_err_sign_date_out_of_bounds', 'Error parsing HTTP request for authentication: signature date out of bounds');
    }

    // Return parsed data
    return {
        timestamp: strTmstmp,
        deviceId: deviceId,
        signDate: strSignDate,
        signature: signature
    }
}

/**
 * @typedef {Object} SignDataInfo
 * @property {string} timestamp
 * @property {string} signDate
 * @property {string} apiAccessSecret
 * @property {Buffer} reqBody
 */

/**
 * Sign HTTP request
 * @param {module:http.IncomingMessage} req
 * @param {SignDataInfo} info
 * @return {string}
 */
export function signHttpRequest(req, info) {
    // First step: compute conformed request
    let confReq = req.method + '\n';
    confReq += req.url + '\n';

    let essentialHeaders = 'host:' + req.headers.host + '\n';

    if (timestampHdr in req.headers) {
        essentialHeaders += timestampHdr + ':' + req.headers[timestampHdr] + '\n';
    }

    confReq += essentialHeaders + '\n';
    confReq += hashData(info.reqBody) + '\n';

    // Second step: assemble string to sign
    let strToSign = signMethodId + '\n';
    strToSign += info.timestamp + '\n';

    const scope = info.signDate + '/' + scopeRequest;

    strToSign += scope + '\n';
    strToSign += hashData(confReq) + '\n';

    // Third step: generate the signature
    const dateKey = signData(info.signDate, signVersionId + info.apiAccessSecret),
        signKey = signData(scopeRequest, dateKey);

    return signData(strToSign, signKey, true);
}

/**
 * Hash data using the SHA-256 algorithm.
 * @param {(string|Buffer)} data The data to be hashed.
 * @return {string} Hex-encoded SHA-256 hash of the data.
 */
function hashData(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Sign data using the HMAC-SHA-256 algorithm.
 * @param {(string|Buffer)} data The data to sign.
 * @param {string} secret The signing key.
 * @param {boolean} hexEncode Indicates whether the resulting signature should be hex-encoded.
 * @return {(Buffer|string)}
 */
function signData(data, secret, hexEncode = false) {
    return crypto.createHmac('sha256', secret).update(data).digest(hexEncode ? 'hex' : undefined);
}
