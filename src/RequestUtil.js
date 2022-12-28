/**
 * Created by claudio on 2022-12-22
 */

/**
 * Checks whether a HTTP request has a JSON content type.
 * @param {module:http.IncomingMessage} req
 */
export function hasJSONContentType(req) {
    const contentType = req.headers['content-type'];

    return typeof contentType === 'string' && contentType.startsWith('application/json');
}

/**
 * Read data received from a HTTP request.
 * @param {module:http.IncomingMessage} req
 * @return {Promise<Buffer>}
 */
export function readData(req) {
    let promiseCall;
    const promise = new Promise((resolve, reject) => {
        promiseCall = {
            resolve,
            reject
        }
    });

    const dataChunks = [];
    let dataLength = 0;

    req.on('readable', () => {
        let dataChunk;

        while ((dataChunk = req.read()) !== null) {
            dataChunks.push(dataChunk);
            dataLength += dataChunk.length;
        }

        promiseCall.resolve(Buffer.concat(dataChunks, dataLength));
    });

    return promise;
}