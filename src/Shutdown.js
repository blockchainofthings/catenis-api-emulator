/**
 * Created by claudio on 2023-01-03
 */
import { display } from './main.js';

/**
 * Shutdown Catenis API emulator if it is running and listening at the given TCP port
 * @param {number} cmdSvrPort Catenis API emulator command server TCP port
 * @param {string} version Catenis API emulator version
 * @return {Promise<boolean>}
 */
export async function checkShutdown(cmdSvrPort, version) {
    let res;

    try {
        res = await fetch(`http://localhost:${cmdSvrPort}/info`);
    }
    catch (err) {
        if ((err.cause instanceof Error) && err.cause.code === 'ECONNREFUSED') {
            display.log('Catenis API Emulator is currently not running');
            return false;
        }
        else {
            throw new Error(`Failure checking if Catenis API Emulator is currently running: ${err}`);
        }
    }

    if (res.ok) {
        let data;

        try {
            data = await res.json()
        }
        catch (err) {}

        if (data === `Catenis API Emulator (ver. ${version})`) {
            // Catenis API emulator seems to be running and listening at the given TCP port.
            //  So send command to shut it down
            let res;

            try {
                res = await fetch(`http://localhost:${cmdSvrPort}/close`, {
                    method: 'POST'
                });
            }
            catch (err) {
                throw new Error(`Failure trying to shut down Catenis API Emulator: ${err}`);
            }

            if (!res.ok) {
                throw new Error(`Failure trying to shut down Catenis API Emulator: [${res.status}] - ${res.statusText}`);
            }
        }
        else {
            display.log('Catenis API Emulator is currently not running');
            return false;
        }
    }
    else {
        throw new Error(`Failure checking if Catenis API Emulator is currently running: [${res.status}] - ${res.statusText}`);
    }

    return true;
}