const { EliteProTechId, removeFile, generateRandomCode } = require('../ids');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
    default: EliteProTechConnect,
    useMultiFileAuthState,
    delay,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');

const router = express.Router();
const sessionDir = path.join(__dirname, 'session');
const pendingSessions = new Map();
const SESSION_TTL = 10 * 60 * 1000;

function cleanupPending(id) {
    const item = pendingSessions.get(id);
    if (item?.timer) clearTimeout(item.timer);
    pendingSessions.delete(id);
}

function setPending(id, value) {
    cleanupPending(id);
    value.timer = setTimeout(() => cleanupPending(id), SESSION_TTL);
    pendingSessions.set(id, value);
}

router.get('/', async (req, res) => {
    const number = String(req.query.number || '').replace(/[^0-9]/g, '');
    const statusId = String(req.query.status || '');

    // Same route is also used by the browser to poll for the final Base64 session ID.
    if (statusId) {
        const pending = pendingSessions.get(statusId);
        if (!pending) return res.json({ status: 'expired' });
        if (pending.error) return res.json({ status: 'error', error: pending.error });
        if (pending.sessionId) {
            const sessionId = pending.sessionId;
            cleanupPending(statusId);
            return res.json({ status: 'ready', sessionId });
        }
        return res.json({ status: 'waiting' });
    }

    if (!number) return res.status(400).json({ error: 'Phone number is required' });

    const id = EliteProTechId();
    let responseSent = false;
    let sessionCleanedUp = false;
    let isPaired = false;

    setPending(id, { status: 'starting' });

    async function cleanUpSession() {
        if (sessionCleanedUp) return;
        sessionCleanedUp = true;
        try {
            await removeFile(path.join(sessionDir, id));
        } catch (error) {
            console.error('Session cleanup error:', error);
        }
    }

    async function pair() {
        const { version } = await fetchLatestBaileysVersion();
        console.log('Baileys version:', version);

        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));
        const sock = EliteProTechConnect({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'fatal' }).child({ level: 'fatal' })
                )
            },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
            browser: Browsers.macOS('Safari'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
            getMessage: async () => undefined,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState?.creds?.registered && !state.creds.registered) {
            await delay(1500);
            const randomCode = generateRandomCode();
            const code = await sock.requestPairingCode(number, randomCode);

            setPending(id, { status: 'pairing', code });
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                return res.json({ code, id });
            }
        }

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'open') {
                isPaired = true;
                try {
                    // Preserve the existing post-connect flow from the normal pair route.
                    await sock.groupAcceptInvite('FjJh6bwbwEs2pq3FCve6tM');
                } catch (error) {
                    console.error('Newsletter/group error:', error);
                }

                // Preserve the existing wait before reading creds.json.
                await delay(50000);

                let sessionData = null;
                let attempts = 0;
                const maxAttempts = 15;

                while (attempts < maxAttempts && !sessionData) {
                    try {
                        const credsPath = path.join(sessionDir, id, 'creds.json');
                        if (fs.existsSync(credsPath)) {
                            const data = fs.readFileSync(credsPath);
                            if (data && data.length > 100) {
                                sessionData = data;
                                break;
                            }
                        }
                        await delay(8000);
                        attempts++;
                    } catch (error) {
                        console.error('Read error:', error);
                        await delay(2000);
                        attempts++;
                    }
                }

                if (!sessionData) {
                    setPending(id, { status: 'error', error: 'Could not read creds.json' });
                    await cleanUpSession();
                    return;
                }

                try {
                    // This is the ONLY intended output change: creds.json -> Base64 session ID.
                    const credsJson = JSON.parse(sessionData.toString());
                    const base64 = Buffer.from(JSON.stringify(credsJson)).toString('base64');
                    const sessionId = `KILLNET-XMD;;;${base64}`;

                    setPending(id, { status: 'ready', sessionId });
                    await delay(2000);
                    await sock.ws.close();
                } catch (error) {
                    console.error('Session processing error:', error);
                    setPending(id, { status: 'error', error: 'Failed to create session ID' });
                } finally {
                    await cleanUpSession();
                }
            } else if (
                connection === 'close' &&
                !isPaired &&
                lastDisconnect?.error?.output?.statusCode != 401
            ) {
                console.log('Reconnecting...');
                await delay(5000);
                try {
                    await pair();
                } catch (error) {
                    console.error('Reconnect error:', error);
                    setPending(id, { status: 'error', error: 'Pairing connection failed' });
                    await cleanUpSession();
                }
            }
        });
    }

    try {
        await pair();
    } catch (error) {
        console.error('Main error:', error);
        setPending(id, { status: 'error', error: 'Service is currently unavailable' });
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ error: 'Service is Currently Unavailable' });
        }
    }
});

module.exports = router;
