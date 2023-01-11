#!/usr/bin/env node --no-warnings
/**
 * Created by claudio on 2022-12-20
 */
import { readFile } from 'node:fs/promises';
import commandLineArgs from 'command-line-args';
import { ApiServer } from './ApiServer.js';
import { WSNotificationServer } from './WSNotificationServer.js';
import { CommandServer } from './CommandServer.js';
import { checkShutdown } from './Shutdown.js';

const appVersion = JSON.parse(
    await readFile(
        new URL('../package.json', import.meta.url)
    )
).version;

/**
 * @type {{log(...[*]): void, error(...[*]): void, info(...[*]): void}}
 */
export const display = {
    log(...args) {
        checkDisplay('log', ...args);
    },
    info(...args) {
        checkDisplay('info', ...args);
    },
    error(...args) {
        checkDisplay('error', ...args);
    }
}

const optionDefinitions = [
    {name: 'api-port', alias: 'p', type: Number, defaultValue: 3500},
    {name: 'cmd-port', alias: 'c', type: Number, defaultValue: 3501},
    {name: 'api-version', alias: 'a', type: String, defaultValue: '0.13'},
    {name: 'silent', alias: 's', type: Boolean},
    {name: 'shutdown', alias: 'q', type: Boolean},
    {name: 'help', alias: 'h', type: Boolean}
];

const options = commandLineArgs(optionDefinitions);

if (options['help']) {
    console.log(`Catenis API Emulator (ver. ${appVersion})

Usage: catenis-api-emulator [options]

Options:
  -p, --api-port <port>        (default: 3500) The TCP port at which the app's
                                API server should be listening.
  -c, --cmd-port <port>        (default: 3501) The TCP port at which the app's
                                command server should be listening.
  -a, --api-version <version>  (default: 0.13) The version of the Catenis API to
                                target.
  -s, --silent                 Run the app in silent mode: no messages are
                                displayed.
  -q, --shutdown               Terminate a running app whose command server is
                                listening at the designated TCP port.
  -h, --help                   Display this usage info.
`);
    process.exit(0);
}

display.info(`Catentis API Emulator (ver. ${appVersion})`);

if (options['shutdown']) {
    try {
        if (await checkShutdown(options['cmd-port'], appVersion)) {
            display.log('Catenis API Emulator successfully shut down');
        }

        process.exit(0);
    }
    catch (err) {
        display.error(`${err}`);
        process.exit(-1);
    }
}
else {
    // Start API server
    const apiSvr = new ApiServer(options['api-port'], options['api-version']);
    await apiSvr.start();

    // Start WebSocket notification server
    const wsNotifySvr = new WSNotificationServer(apiSvr);
    wsNotifySvr.start();

    // Start Command server
    const cmdSvr = new CommandServer(options['cmd-port'], apiSvr, wsNotifySvr, appVersion);
    cmdSvr.start();
}

/**
 * @param {string} level
 * @param {...[*]} args
 */
function checkDisplay(level, ...args) {
    if (!options['silent'] && typeof console[level] === 'function') {
        console[level].call(undefined, ...args);
    }
}
