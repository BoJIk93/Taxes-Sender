const http = require('http');
const https = require('https');

function makeRequest(options, postData = null, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const protocol = options.protocol === 'http:' ? http : https;
        const startTime = Date.now();
        
        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const duration = Date.now() - startTime;
                try {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: data ? JSON.parse(data) : null,
                        raw: data,
                        duration: duration
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: null,
                        raw: data,
                        duration: duration
                    });
                }
            });
        });
        
        req.on('error', (err) => {
            reject(err);
        });
        
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error(`Timeout`));
        });
        
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

module.exports = { makeRequest, parseBody };
