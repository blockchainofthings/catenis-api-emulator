/**
 * Created by claudio on 2022-12-22
 */

/**
 * Checks whether an HTTP request has a JSON content type.
 * @param {module:http.IncomingMessage} req
 */
export function hasJSONContentType(req) {
    const contentType = req.headers['content-type'];

    return typeof contentType === 'string' && contentType.startsWith('application/json');
}

/**
 * Read data received from an HTTP request.
 * @param {module:http.IncomingMessage} req
 * @return {Promise<Buffer>}
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

            resolve(Buffer.concat(dataChunks, dataLength));
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
