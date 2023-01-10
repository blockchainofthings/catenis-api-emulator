/**
 * Created by claudio on 2022-12-22
 */
import zlib from 'node:zlib';

/**
 * Checks whether an HTTP request has a JSON content type.
 * @param {module:http.IncomingMessage} req
 */
export function hasJSONContentType(req) {
    const contentType = req.headers['content-type'];

    return typeof contentType === 'string' && contentType.startsWith('application/json');
}

/**
 * @typedef {Object} ReadHttpReqBody
 * @property {Buffer} raw
 * @property {Buffer} [decoded]
 */

/**
 * Read data received from an HTTP request.
 * @param {module:http.IncomingMessage} req
 * @return {Promise<ReadHttpReqBody>}
 */
export function readData(req) {
    return new Promise((resolve, reject) => {
        const dataChunks = [];
        let dataLength = 0;

        req.on('error', error => reject(error));

        req.on('readable', () => {
            let dataChunk;

            while ((dataChunk = req.read()) !== null) {
                dataChunks.push(dataChunk);
                dataLength += dataChunk.length;
            }

            /**
             * @type {ReadHttpReqBody}
             */
            let data = {
                raw: Buffer.concat(dataChunks, dataLength)
            };

            if (req.headers['content-encoding'] === 'deflate') {
                // Body data is compressed. Decompress it
                data.decoded = zlib.inflateSync(data.raw);
            }

            resolve(data);
        });
    });
}

/**
 * Check whether an HTTP request is a CORS preflight request.
 * @param {module:http.IncomingMessage} req
 * @return {boolean}
 */
export function isCORSPreflightRequest(req) {
    return req.method === 'OPTIONS' && (('access-control-request-headers' in req.headers)
        || ('access-control-request-method' in req.headers));
}
