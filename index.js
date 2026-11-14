const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const axios = require('axios');
const FormData = require('form-data');

// Render-এর Environment Variables থেকে সিক্রেট তথ্য রিড করবে
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// QR কোড ইমেজ এবং আপডেট মেসেজ টেলিগ্রামে পাঠানোর ফাংশন
async function sendQRToTelegram(qrString) {
    try {
        const buffer = await QRCode.toBuffer(qrString);
        const form = new FormData();
        form.append('chat_id', TELEGRAM_CHAT_ID);
        form.append('photo', buffer, { filename: 'qrcode.png' });
        form.append('caption', '🔄 **বট আপডেট হয়েছে!**\n\n📱 নতুন QR কোড চলে এসেছে, দ্রুত আপনার ফোন দিয়ে এটি স্ক্যান করুন।');

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, form, {
            headers: form.getHeaders()
        });
        console.log('✅ QR কোড ও আপডেট মেসেজ টেলিগ্রামে পাঠানো হয়েছে!');
    } catch (error) {
        console.error('❌ টেলিগ্রামে QR পাঠাতে সমস্যা হয়েছে:', error.response ? error.response.data : error.message);
    }
}

// যেকোনো ফাইল বা মিডিয়া টেলিগ্রামে পাঠানোর ফাংশন
async function sendToTelegram(buffer, fileName, caption) {
    try {
        const form = new FormData();
        form.append('chat_id', TELEGRAM_CHAT_ID);
        form.append('document', buffer, { filename: fileName });
        if (caption) {
            form.append('caption', caption);
        }

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
        console.log(`✅ ফাইল টেলিগ্রামে পাঠানো হয়েছে: ${fileName}`);
    } catch (error) {
        console.error('❌ টেলিগ্রামে ফাইল পাঠাতে সমস্যা হয়েছে:', error.response ? error.response.data : error.message);
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('নতুন QR কোড টেলিগ্রামে পাঠানো হচ্ছে...');
            await sendQRToTelegram(qr);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('কানেকশন বিচ্ছিন্ন হয়েছে, আবার চেষ্টা করা হচ্ছে...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('🚀 WhatsApp সফলভাবে কানেক্ট হয়েছে!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe || !msg.message) continue;

            let messageContent = msg.message;

            // ভিউ ওয়ান্স বা যেকোনো এনক্রিপ্টেড লেয়ার আনর্যাপ করার শক্তিশালী লজিক
            if (messageContent.ephemeralMessage) messageContent = messageContent.ephemeralMessage.message;
            if (messageContent.viewOnceMessage) messageContent = messageContent.viewOnceMessage.message;
            if (messageContent.viewOnceMessageV2) messageContent = messageContent.viewOnceMessageV2.message;
            if (messageContent.viewOnceMessageV2Extension) messageContent = messageContent.viewOnceMessageV2Extension.message;
            if (messageContent.documentWithCaptionMessage) messageContent = messageContent.documentWithCaptionMessage.message;
            
            if (messageContent.viewOnceMessage?.message) messageContent = messageContent.viewOnceMessage.message;
            if (messageContent.viewOnceMessageV2?.message) messageContent = messageContent.viewOnceMessageV2.message;

            // যেকোনো মিডিয়া বা ফাইলের ধরন সনাক্ত করা
            const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
            const messageType = mediaTypes.find(type => messageContent && messageContent[type]);

            if (messageType) {
                try {
                    const sender = msg.pushName || msg.key.remoteJid.split('@')[0];
                    const mediaObj = messageContent[messageType];
                    
                    let fileName = mediaObj.fileName;
                    if (!fileName) {
                        const mime = mediaObj.mimetype || 'application/octet-stream';
                        let ext = 'bin';
                        if (mime.includes('image')) ext = 'jpg';
                        else if (mime.includes('video')) ext = 'mp4';
                        else if (mime.includes('audio')) ext = 'mp3';
                        else if (mime.includes('pdf')) ext = 'pdf';
                        fileName = `WA_File_${Date.now()}.${ext}`;
                    }

                    const caption = `📩 **নতুন ফাইল বা মিডিয়া এসেছে**\n👤 প্রেরক: ${sender}\n📝 ক্যাপশন: ${mediaObj.caption || 'নেই'}`;

                    console.log(`📥 ফাইল ডাউনলোড হচ্ছে: ${fileName}...`);

                    const clonedMsg = { 
                        ...msg, 
                        message: { 
                            [messageType]: mediaObj 
                        } 
                    };

                    const buffer = await downloadMediaMessage(
                        clonedMsg,
                        'buffer',
                        {},
                        { logger: pino({ level: 'silent' }) }
                    );

                    if (buffer) {
                        await sendToTelegram(buffer, fileName, caption);
                    }

                } catch (err) {
                    console.error('ফাইল প্রসেস করতে সমস্যা হয়েছে:', err);
                }
            }
        }
    });
}

connectToWhatsApp();
