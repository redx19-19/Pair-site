const {
    EliteProTechId,
    removeFile,
    generateRandomCode
} = require('../ids');
const express = require('express');
const fs = require('fs');
const path = require('path');
let router = express.Router();
const pino = require("pino");
const {
    default: EliteProTechConnect,
    useMultiFileAuthState,
    delay,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

// Tag prepended to the base64 session string. Must match SESSION_ID_TAG in
// the Killnet XMD multi-session bot's .env (defaults to KILLNET-XMD there too).
const SESSION_ID_TAG = process.env.SESSION_ID_TAG || 'KILLNET-XMD';

const sessionDir = path.join(__dirname, "session");

router.get('/', async (req, res) => {
    const id = EliteProTechId();
    let num = req.query.number;
    let responseSent = false;
    let sessionCleanedUp = false;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try {
                await removeFile(path.join(sessionDir, id));
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError);
            }
            sessionCleanedUp = true;
        }
    }

    async function EliteProTech_SESSION_ID() {
        const { version } = await fetchLatestBaileysVersion();
        console.log(version);
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));
        let isPaired = false;
        try {
            let EliteProTech = EliteProTechConnect({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
                syncFullHistory: false,
                generateHighQualityLinkPreview: true,
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
                getMessage: async () => undefined,
                markOnlineOnConnect: true,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000
            });

            if (!EliteProTech.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');

                const randomCode = generateRandomCode();
                const code = await EliteProTech.requestPairingCode(num, randomCode);

                if (!responseSent && !res.headersSent) {
                    res.json({ code: code });
                    responseSent = true;
                }
            }

            EliteProTech.ev.on('creds.update', saveCreds);
            EliteProTech.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    isPaired = true;
                    try {
                         await EliteProTech.newsletterFollow("120363407986420869@newsletter");
                        await EliteProTech.groupAcceptInvite("FjJh6bwbwEs2pq3FCve6tM");
                    } catch (error) {
                        console.error("Newsletter/group error:", error);
                    }

                    await delay(50000);

                    let sessionData = null;
                    let attempts = 0;
                    const maxAttempts = 15;

                    while (attempts < maxAttempts && !sessionData) {
                        try {
                            const credsPath = path.join(sessionDir, id, "creds.json");
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                                if (data && data.length > 100) {
                                    sessionData = data;
                                    break;
                                }
                            }
                            await delay(8000);
                            attempts++;
                        } catch (readError) {
                            console.error("Read error:", readError);
                            await delay(2000);
                            attempts++;
                        }
                    }

                    if (!sessionData) {
                        await cleanUpSession();
                        return;
                    }

                    try {
                        await delay(5000);
                        let sessionSent = false;
                        let sendAttempts = 0;
                        const maxSendAttempts = 5;
                        let Sess = null;

                        while (sendAttempts < maxSendAttempts && !sessionSent) {
                            try {
                                // Same normalization pair.js does (parse then
                                // re-stringify to a compact one-line form) --
                                // only difference is this gets base64-encoded
                                // and tagged instead of sent as raw JSON text.
                                const sessionJson = JSON.parse(sessionData.toString());
                                const compact = JSON.stringify(sessionJson);
                                const formatted = `${SESSION_ID_TAG};;;${Buffer.from(compact).toString('base64')}`;

                                Sess = await EliteProTech.sendMessage(EliteProTech.user.id, {
                                    text: formatted
                                });
                                sessionSent = true;
                            } catch (sendError) {
                                console.error("Send error:", sendError);
                                sendAttempts++;
                                if (sendAttempts < maxSendAttempts) {
                                    await delay(3000);
                                }
                            }
                        }

                        if (!sessionSent) {
                            await cleanUpSession();
                            return;
                        }

                        await delay(3000);

                        let EliteProTech_TEXT = `✅ *SESSION ID OBTAINED SUCCESSFULLY!*  
📁 This is your *Killnet XMD multi-session ID*. Send it to the bot's master number as:
\`.connect ${SESSION_ID_TAG};;;<the string above>\`

🚫 *Do NOT share your session ID or creds.json with anyone.*

📢 *Stay Updated — Follow Our Channels:*

➊ *Telegram*  
https://t.me/diansybextech

➋ *Settings link/Web version*  
https://killnet-xmd.panel.diansybextech.site

🌐 *Explore more tools on our website:*  
https://diansybextech.site`;

                        try {
                            const EliteProTechMess = {
                                image: { url: 'https://files.catbox.moe/75my05.jpg' },
                                caption: EliteProTech_TEXT,
                                contextInfo: {
                                    mentionedJid: [EliteProTech.user.id],
                                    forwardingScore: 5,
                                    isForwarded: true,
                                    forwardedNewsletterMessageInfo: {
                                        newsletterJid: '120363407986420869@newsletter',
                                        newsletterName: "Killnet-xmd",
                                        serverMessageId: 143
                                    }
                                }
                            };
                            await EliteProTech.sendMessage(EliteProTech.user.id, EliteProTechMess, { quoted: Sess });
                        } catch (messageError) {
                            console.error("Message send error:", messageError);
                        }

                        await delay(2000);
                        await EliteProTech.ws.close();
                    } catch (sessionError) {
                        console.error("Session processing error:", sessionError);
                    } finally {
                        await cleanUpSession();
                    }

                } else if (
                    connection === "close" &&
                    !isPaired &&
                    lastDisconnect &&
                    lastDisconnect.error &&
                    lastDisconnect.error.output.statusCode != 401
                ) {
                    console.log("Reconnecting...");
                    await delay(5000);
                    EliteProTech_SESSION_ID();
                }
            });

        } catch (err) {
            console.error("Main error:", err);
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ code: "Service is Currently Unavailable" });
                responseSent = true;
            }
            await cleanUpSession();
        }
    }

    try {
        await EliteProTech_SESSION_ID();
    } catch (finalError) {
        console.error("Final error:", finalError);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ code: "Service Error" });
        }
    }
});

module.exports = router;
