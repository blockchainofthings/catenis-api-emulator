#!/usr/bin/env node
/**
 * Created by claudio on 2022-12-20
 */
import commandLineArgs from 'command-line-args';
import { ApiServer } from './ApiServer.js';
import { WSNotificationServer } from './WSNotificationServer.js';
import { CommandServer } from './CommandServer.js';

const optionDefinitions = [
    {name: 'api-port', alias: 'p', type: Number, defaultValue: 3500},
    {name: 'cmd-port', alias: 'c', type: Number, defaultValue: 3501},
    {name: 'api-version', alias: 'v', type: String, defaultValue: '0.13'}
];

const options = commandLineArgs(optionDefinitions);
console.debug('In-use options:', options);
console.debug('Process:', process);

// Start API server
const apiSvr = new ApiServer(options['api-port'], options['api-version']);
await apiSvr.start();

// Start WebSocket notification server
const wsNotifySvr = new WSNotificationServer(apiSvr);
wsNotifySvr.start();

// Start Command server
const cmdSvr = new CommandServer(options['cmd-port'], apiSvr, wsNotifySvr);
cmdSvr.start();