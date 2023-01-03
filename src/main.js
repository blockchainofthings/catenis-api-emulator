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
    {name: 'shutdown', alias: 'q', type: Boolean},
    {name: 'verbose', alias: 'v', type: Boolean}
];

const options = commandLineArgs(optionDefinitions);

display.info(`Catentis API Emulator (ver. ${appVersion})`);

if (options['shutdown']) {
    if (await checkShutdown(options['cmd-port'], appVersion)) {
        display.log('Catenis API Emulator successfully shut down');
        process.exit(0);
    }
    else {
        display.error('Unable to shut down Catenis API Emulator; either it is not running or it failed to process the close command');
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
    if (options['verbose'] && typeof console[level] === 'function') {
        console[level].call(undefined, ...args);
    }
}
