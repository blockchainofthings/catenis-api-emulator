/**
 * Created by claudio on 2023-01-03
 */

/**
 * Shutdown Catenis API emulator if it is running and listening at the given TCP port
 * @param {number} cmdSvrPort Catenis API emulator command server TCP port
 * @param {string} version Catenis API emulator version
 * @return {Promise<boolean>}
 */
export async function checkShutdown(cmdSvrPort, version) {
    let success = false;
    let res;

    try {
        res = await fetch(`http://localhost:${cmdSvrPort}/info`);
    }
    catch (err) {}

    if (res && res.ok) {
        let data;

        try {
            data = await res.json()
        }
        catch (err) {}

        if (data === `Catenis API Emulator (ver. ${version})`) {
            // Catenis API emulator seems to be running and listening at the given TCP port.
            //  So send command to shut it down
            const res = await fetch(`http://localhost:${cmdSvrPort}/close`, {
                method: 'POST'
            });

            success = res.ok;
        }
    }

    return success;
}