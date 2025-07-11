// @ts-nocheck
'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.3
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
// @ts-ignore
const helper = require(`${__dirname}/lib/utils`);

let ip;
let apiClient;
let polling;
let pollingTime;

const axios = require(`axios`);
const { parseString } = require('xml2js');

// Load your modules here, e.g.:
// const fs = require("fs");

class Bluesound extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'bluesound',
        });
        this.apiClient = null;
        this.on('ready', this.onReady.bind(this));
        // @ts-ignore
        this.on('stateChange', this.onStateChange.bind(this));
        // @ts-ignore
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        this.subscribeStates('*');

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);
        ip = this.config.IP;
        // @ts-ignore
        const promises = [];

        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        if (ip) {
            this.log.info('[Start] Starting adapter bluesound with: ' + ip);
        } else {
            this.log.warn('[Start] No IP Address set');
            return;
        }

        pollingTime = this.config.PollingTime * 1000 || 30000;
        if (pollingTime < 120000) {
            this.log.info('[Start] PollingTime [msec]: ' + pollingTime);
        } else if (pollingTime >= 120000 && pollingTime <= 300000) {
            this.log.warn('[Start] PollingTime set very high! Status update should be scheduled more often!');
        } else {
            this.log.error(
                '[Stop] PollingTime set to an impractical large number! Reasonable numbers are up to 120 secs',
            );
            return;
        }

        const timeOUT = this.config.TimeOut * 1000 || 2000;
        if (timeOUT < pollingTime / 10) {
            this.log.info('[Start] Timeout [msec]: ' + timeOUT);
        } else {
            this.log.error(
                '[Stop] TimeOut set to an impractical large number! Should be set to less than PollingTime divide by ten',
            );
            return;
        }

        apiClient = axios.create({
            baseURL: `http://${ip}:11000`,
            timeout: timeOUT,
            responseType: 'xml',
            responseEncoding: 'utf8',
        });

        // set Info

        let sNameTag = 'info.name';
        const sModelNameTag = 'info.modelname';
        try {
            const response = await apiClient.get('/SyncStatus');
            if (response.status === 200) {
                parseString(response.data, { mergeAttrs: true, explicitArray: false }, (err, result) => {
                    if (err) {
                        this.log('Error parsing SyncStatus XML:' + err);
                        return;
                    }
                    this.setState(sNameTag, result.SyncStatus.name, true);
                    this.setState(sModelNameTag, result.SyncStatus.modelName, true);
                });
            } else {
                this.log.error('Could not retrieve SyncStatus data, Status code ' + response.status);
            }
        } catch (e) {
            console.error('Could not retrieve SyncStatus data: ' + e);
        }

        // Initialize Control

        // stop = false
        sNameTag = 'control.stop';
        this.setState(sNameTag, false, true);
        // pause = false
        sNameTag = 'control.pause';
        this.setState(sNameTag, false, true);
        // play = false
        sNameTag = 'control.play';
        this.setState(sNameTag, false, true);
        // state = ""
        sNameTag = 'control.state';
        this.setState(sNameTag, '', true);
        // shuffle = false
        sNameTag = 'control.shuffle';
        this.setState(sNameTag, false, true);

        // volume from player

        try {
            const response = await apiClient.get('/Volume');
            if (response.status === 200) {
                parseString(response.data, { mergeAttrs: true, explicitArray: false }, (err, result) => {
                    if (err) {
                        console.log('Error parsing Volume XML:' + err);
                        return;
                    }
                    sNameTag = 'control.volume';
                    this.setState(sNameTag, parseInt(result.volume._), true);

                    sNameTag = 'info.volume';
                    this.setState(sNameTag, parseInt(result.volume._), true);
                });
            } else {
                this.log.error('Could not retrieve Volume data, Status code ' + response.status);
            }
        } catch (e) {
            this.log.error('Could not retrieve Volume data: ' + e);
        }

        // Presets

        try {
            const response = await apiClient.get('/Presets');
            if (response.status == 200) {
                parseString(response.data, { mergeAttrs: true, explicitArray: false }, (err, result) => {
                    if (err) {
                        this.log.error('Error parsing Presets XML:' + err);
                        return;
                    }
                    for (const objPreset of result.presets.preset) {
                        const sPresetID = objPreset.id.replace(this.FORBIDDEN_CHARS, '_');
                        const sPresetName = objPreset.name;
                        const sPresetImage = objPreset.image;
                        const data1 = {
                            id: sPresetID,
                            name: sPresetName,
                            image: sPresetImage,
                            start: false,
                        };
                        const objs = helper.getPresets(sPresetID);
                        for (const obj of objs) {
                            const id = obj._id;
                            delete obj._id;
                            promises.push(this.setObjectNotExistsAsync(id, obj));
                            if (obj.type != 'channel') {
                                const sTag = `presets.preset${sPresetID}.${obj.common.name}`;
                                for (const x in data1) {
                                    if (x == obj.common.name) {
                                        if (obj.common.type == 'number') {
                                            this.setState(sTag, parseInt(data1[x]), true);
                                        } else {
                                            this.setState(sTag, data1[x], true);
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            } else {
                this.log.error('Could not retrieve Presets data, Status code ' + response.status);
            }
        } catch (e) {
            this.log.error('Could not retrieve Presets data: ' + e);
        }

        // Status
        this.readPlayerStatus();

        // Polling
        this.startPolling();

        // Set the connection indicator to true on succesful startup
        this.setState('info.connection', true, true);

        // examples for the checkPassword/checkGroup functions
        let result = await this.checkPasswordAsync('admin', 'iobroker');
        this.log.info('check user admin pw iobroker: ' + result);

        result = await this.checkGroupAsync('admin', 'admin');
        this.log.info('check group user admin group admin: ' + result);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    // @ts-ignore
    onUnload(callback) {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            clearTimeout(polling);

            // Set the connection indicator to false
            this.setState('info.connection', false, true);

            // @ts-ignore
            callback();
        } catch (e) {
            // @ts-ignore
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    // @ts-ignore
    onStateChange(id, state) {
        // @ts-ignore
        if (state) {
            // The state was changed
            // @ts-ignore
            if (!state.ack) {
                const pos = id.toString().lastIndexOf('.');
                switch (id.substring(pos + 1)) {
                    case 'start':
                        this.getState(id.substring(0, pos) + '.id', (err, status) => {
                            if (status || status.val) {
                                const preset = status.val;
                                apiClient
                                    .get(`/Preset?id=${preset}`)
                                    .then((response) => {
                                        // Handle response
                                        parseString(response.data, (err, result) => {
                                            if (err) {
                                                this.log.error('Error parsing Preset XML: ' + err);
                                                return;
                                            }
                                            const sStateTag = 'control.state';
                                            this.setState(sStateTag, result.state ?? '', true);
                                            this.log.info(`${this.namespace} Preset${preset} Start`);
                                        });
                                    })
                                    .catch((err) => {
                                        // Handle errors
                                        // adapter.log.error("Could not start preset, Status code " + response.status);
                                        this.log.error('Could not start preset, Status code ' + err);
                                    });
                            }
                        });
                        this.readPlayerStatus();
                        break;
                    case 'pause':
                        apiClient
                            .get('/Pause?toggle=1')
                            .then((response) => {
                                // Handle response
                                parseString(response.data, (err, result) => {
                                    if (err) {
                                        this.log.error('Error parsing Pause XML: ' + err);
                                        return;
                                    }
                                    const sStateTag = 'control.state';
                                    this.setState(sStateTag, result.state, true);
                                    this.log.info(`${this.namespace} Pause`);
                                });
                            })
                            .catch((err) => {
                                // Handle errors
                                this.log.error('Could not set Pause, Status code ' + err);
                            });
                        this.readPlayerStatus();
                        break;
                    case 'stop':
                        apiClient
                            .get('/Stop')
                            .then((response) => {
                                // Handle response
                                parseString(response.data, (err, result) => {
                                    if (err) {
                                        this.log.error('Error parsing Stop XML: ' + err);
                                        return;
                                    }
                                    const sStateTag = 'control.state';
                                    this.setState(sStateTag, result.state, true);
                                    this.log.info(`${this.namespace} Stop`);
                                });
                            })
                            .catch((err) => {
                                // Handle errors
                                this.log.error('Could not set stop, Status code ' + err);
                            });
                        this.clearPlayerStatus();
                        break;
                    case 'stream':
                    case 'play':
                        apiClient
                            .get('/Play')
                            .then((response) => {
                                // Handle response
                                parseString(response.data, (err, result) => {
                                    if (err) {
                                        this.log.error('Error parsing Play XML: ' + err);
                                        return;
                                    }
                                    const sStateTag = 'control.state';
                                    this.setState(sStateTag, result.state, true);
                                    this.log.info(`${this.namespace} Play`);
                                });
                            })
                            .catch((err) => {
                                // Handle errors
                                this.log.error('Could not set play, Status code ' + err);
                            });
                        this.readPlayerStatus();
                        break;
                    case 'volume':
                        apiClient
                            .get(`/Volume?level=${state.val}`)
                            .then()
                            .catch((err) => {
                                // Handle errors
                                this.log.error('Could not set volume, Status code ' + err);
                            });
                        break;
                    case 'shuffle':
                        let val = Number(state.val);
                        apiClient
                            .get(`/Shuffle?state=${val}`)
                            .then()
                            .catch((err) => {
                                // Handle errors
                                this.log.error('Could not set shuffle, Status code ' + err);
                            });
                        break;
                    default:
                    //this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                }
            }
        } else {
            // The state was deleted
            // @ts-ignore
            this.log.info(`state ${id} deleted`);
        }
    }

    stripHTML(str) {
        const strneu = str.replace('&amp;', '&');
        return strneu;
    }

    convertSecs(secs) {
        const date = new Date(null);
        date.setSeconds(secs);

        let res = '';

        if (secs >= 3600) {
            res = date.toISOString().slice(11, 19);
        } else {
            res = date.toISOString().slice(14, 19);
        }

        return res;
    }

    startPolling() {
        polling = this.setTimeout(() => {
            this.readPlayerStatus();
            this.startPolling();
        }, pollingTime);
    }

    async clearPlayerStatus() {
        let i;
        for (i = 1; i < 4; i++) {
            const sStateTag = `info.title${i}`;
            await this.setStateAsync(sStateTag, { val: '', ack: true });
        }
    }

    async readPlayerStatus() {
        const promises = [];
        const title = [];
        let i;
        let varSecs;
        let strSecs;
        let varTotLen, strTotLen, imageUrl, varVolume, pState;

        for (i = 1; i < 4; i++) {
            title[i] = '';
        }
        try {
            const response = await apiClient.get('/Status');
            if (response.status === 200) {
                // Set the connection indicator to true on succesful read
                this.setState('info.connection', true, true);

                //const result = response.data;
                parseString(response.data, (err, result) => {
                    if (err) {
                        this.log.error('Error parsing Status XML:' + err);
                        return;
                    }

                    if (response.data.toString().lastIndexOf('title1') === -1) {
                        title[1] = '';
                    } else {
                        title[1] = result.status.title1[0];
                    }

                    if (response.data.toString().lastIndexOf('title2') === -1) {
                        title[2] = '';
                    } else {
                        title[2] = result.status.title2[0];
                    }

                    if (response.data.toString().lastIndexOf('title3') === -1) {
                        title[3] = '';
                    } else {
                        title[3] = result.status.title3[0];
                    }

                    varSecs = result.status.secs[0];
                    strSecs = this.convertSecs(varSecs);

                    if (response.data.toString().lastIndexOf('totlen') === -1) {
                        varTotLen = 28800;
                    } else {
                        varTotLen = result.status.totlen[0];
                    }

                    if (response.data.toString().lastIndexOf('image') === -1) {
                        imageUrl = '';
                    } else {
                        imageUrl = result.status.image[0];
                    }

                    varVolume = result.status.volume[0];
                    pState = result.status.state[0];
                });

                strTotLen = this.convertSecs(varTotLen);

                if (imageUrl.substring(0, 4) != 'http') {
                    imageUrl = `http://${ip}:11000` + imageUrl;
                }

                await Promise.all(promises);

                const sNameTag = 'control.state';
                const pStateOld = await this.getStateAsync(sNameTag);

                if (pState != pStateOld.val) {
                    const sStateTag = 'control.state';
                    await this.setStateAsync(sStateTag, { val: pState, ack: true });
                }

                if (pState == 'stream' || pState == 'play') {
                    for (i = 1; i < 4; i++) {
                        const sStateTag = `info.title${i}`;
                        const valOld = await this.getStateAsync(sStateTag);
                        if (valOld.val != title[i]) {
                            await this.setStateAsync(sStateTag, { val: title[i], ack: true });
                            this.log.info(`title${i} changed: ` + title[i]);
                        }
                    }

                    let sStateTag = 'info.secs';
                    await this.setStateAsync(sStateTag, { val: parseInt(varSecs), ack: true });

                    sStateTag = 'info.totlen';
                    await this.setStateAsync(sStateTag, { val: parseInt(varTotLen), ack: true });

                    sStateTag = 'info.str_secs';
                    await this.setStateAsync(sStateTag, { val: strSecs, ack: true });

                    sStateTag = 'info.str_totlen';
                    await this.setStateAsync(sStateTag, { val: strTotLen, ack: true });

                    sStateTag = 'info.image';
                    let valOld = await this.getStateAsync(sStateTag);

                    if (valOld.val != imageUrl) {
                        await this.setStateAsync(sStateTag, { val: imageUrl, ack: true });
                        this.log.info('Image changed: ' + imageUrl);
                    }

                    sStateTag = 'info.volume';
                    valOld = await this.getStateAsync(sStateTag);
                    if (valOld.val != varVolume) {
                        await this.setStateAsync(sStateTag, { val: parseInt(varVolume), ack: true });
                        sStateTag = 'control.volume';
                        await this.setStateAsync(sStateTag, { val: parseInt(varVolume), ack: true });
                        this.log.info('Volume changed: ' + varVolume);
                    }
                } else {
                    for (i = 1; i < 4; i++) {
                        const sStateTag = `info.title${i}`;
                        await this.setStateAsync(sStateTag, { val: '', ack: true });
                    }

                    let sStateTag = 'info.secs';
                    await this.setStateAsync(sStateTag, { val: 0, ack: true });

                    sStateTag = 'info.totlen';
                    await this.setStateAsync(sStateTag, { val: 0, ack: true });

                    sStateTag = 'info.image';
                    await this.setStateAsync(sStateTag, { val: '', ack: true });
                }
            } else {
                this.log.error('Could not retrieve status data, Status code ' + response.status);

                // Set the connection indicator to false on unsuccesful read
                this.setState('info.connection', false, true);
            }
        } catch (e) {
            this.log.error('Could not retrieve status data: ' + e);
            // Set the connection indicator to false on unsuccesful read
            this.setState('info.connection', false, true);
        }
        return true;
    }
}

// @ts-ignore
if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Bluesound(options);
    // @ts-ignore
} else {
    // otherwise start the instance directly
    new Bluesound();
}
