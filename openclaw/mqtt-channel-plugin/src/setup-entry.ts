import { defineSetupPluginEntry } from 'openclaw/plugin-sdk/core';
import { mqttChannelPlugin } from './channel.js';

export default defineSetupPluginEntry(mqttChannelPlugin);
