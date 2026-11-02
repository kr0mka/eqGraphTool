import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const paths = ['../assets/js/graphtool.js'];
function client(fetch) {
    const sections = paths.map(path => {
        const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
        return source.slice(source.indexOf('        const BRIDGE_URLS ='),
                            source.indexOf('        const tmConnect =', source.indexOf('        const BRIDGE_URLS =')));
    });
    for (const section of sections.slice(1)) assert.equal(sections[0], section);
    const context = vm.createContext({fetch, AbortController, setTimeout, clearTimeout});
    return vm.runInContext(`(function() {${sections[0]}; return {connectBridge, bridgeRequest}; })()`, context);
}
const response = (data, ok = true) => ({ok, status: ok ? 200 : 504, json: async () => data});

test('legacy bridge stays on 8765', async () => {
    const requests = [];
    const c = client(async url => {
        requests.push(url);
        return response(url.endsWith('/status') ? {status: 'ok', port: 8765} : {channels: []});
    });
    await c.connectBridge();
    assert.deepEqual(requests, ['http://127.0.0.1:8765/api/status', 'http://127.0.0.1:8765/api/channels']);
});

test('reserved primary discovers fallback; reads and writes use it', async () => {
    const requests = [];
    const c = client(async (url, init) => {
        requests.push([url, init.method || 'GET']);
        if (url.includes(':8765')) throw new Error('port blocked');
        return response(url.endsWith('/status') ? {status: 'ok', service: 'totalmix-osc-bridge'} : {channels: []});
    });
    await c.connectBridge();
    await c.bridgeRequest('/api/channel/1/eq');
    await c.bridgeRequest('/api/channel/1/eq', {method: 'POST', body: '{}'});
    assert.deepEqual(requests.slice(-2), [
        ['http://127.0.0.1:18765/api/channel/1/eq', 'GET'],
        ['http://127.0.0.1:18765/api/channel/1/eq', 'POST']
    ]);
});

test('unrelated service on fallback is rejected', async () => {
    const c = client(async url => {
        if (url.includes(':8765')) throw new Error('blocked');
        return response({status: 'ok', port: 18765});
    });
    await assert.rejects(c.connectBridge(), /unavailable/);
});

test('failed EQ writes report the bridge error and are never retried', async () => {
    let writes = 0;
    const c = client(async (url, init) => {
        if (init.method === 'POST') {
            writes++;
            return response({error: 'selection not confirmed'}, false);
        }
        return response(url.endsWith('/status') ? {status: 'ok', port: 8765} : {channels: []});
    });
    await c.connectBridge();
    await assert.rejects(c.bridgeRequest('/api/channel/1/eq', {method: 'POST'}), /selection not confirmed/);
    assert.equal(writes, 1);
});

test('disconnected client refuses EQ operations', async () => {
    const c = client(() => { throw new Error('must not fetch'); });
    await assert.rejects(c.bridgeRequest('/api/channel/1/eq', {method: 'POST'}), /Connect/);
});
