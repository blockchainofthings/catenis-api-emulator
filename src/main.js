#!/usr/bin/env node
/**
 * Created by claudio on 2022-12-20
 */
import commandLineArgs from 'command-line-args';
import { ApiServer } from './ApiServer.js';
import { CommandServer } from './CommandServer.js';

const optionDefinitions = [
    {name: 'api-port', alias: 'p', type: Number, defaultValue: 3500},
    {name: 'cmd-port', alias: 'c', type: Number, defaultValue: 3501},
    {name: 'api-version', alias: 'v', type: String, defaultValue: '0.13'},
    {name: 'device-id', alias: 'd', type: String},
    {name: 'access-secret', alias: 's', type: String}
];

const options = commandLineArgs(optionDefinitions);
console.debug('In-use options:', options);

// Instantiate API server
/**
 * @type {DeviceCredentials}
 */
let deviceCredentials;

if (options['device-id']) {
    const accessSecret = options['access-secret'];

    deviceCredentials = {
        deviceId: options['device-id'],
        apiAccessSecret: typeof accessSecret === 'string' ? accessSecret : ''
    }
}

// Start API server
const apiSvr = new ApiServer(options['api-port'], options['api-version'], deviceCredentials);
await apiSvr.start();

// Start Command server
const cmdSvr = new CommandServer(options['cmd-port'], apiSvr);
cmdSvr.start();