const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const db = require('../config/db');
const { connectDB } = db;
const { getUserById } = require('../utils/helpers');

function pairKey(a, b) {
    return [a, b].sort().join(':');
}

// List conversations for a user
router.get('/api/messages/conversations', async (req, res) => {
    try {
        await connectDB();
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

        const convos = await db.conversationsCollection
            .find({ participants: userId })
            .sort({ updated_at: -1 })
            .toArray();

        const enriched = await Promise.all(
            convos.map(async (c) => {
                const otherId = c.participants.find((p) => p !== userId);
                const other = await getUserById(otherId);
                const unread = await db.messagesCollection.countDocuments({
                    conversation_id: c._id.toString(),
                    sender_id: { $ne: userId },
                    read_by: { $nin: [userId] },
                });
                return {
                    _id: c._id,
                    other: other
                        ? {
                              _id: other._id.toString(),
                              name: other.name,
                              image: other.image,
                          }
                        : { _id: otherId, name: 'Member', image: null },
                    last_message: c.last_message || null,
                    updated_at: c.updated_at,
                    unread,
                };
            })
        );

        res.json({ success: true, conversations: enriched });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to load conversations' });
    }
});

// Get or create conversation + messages
router.get('/api/messages/thread', async (req, res) => {
    try {
        await connectDB();
        const { userId, otherId } = req.query;
        if (!userId || !otherId) {
            return res.status(400).json({ success: false, message: 'userId and otherId required' });
        }

        const key = pairKey(userId, otherId);
        let convo = await db.conversationsCollection.findOne({ pair_key: key });
        if (!convo) {
            const doc = {
                pair_key: key,
                participants: [userId, otherId],
                last_message: null,
                created_at: new Date(),
                updated_at: new Date(),
            };
            const r = await db.conversationsCollection.insertOne(doc);
            convo = { ...doc, _id: r.insertedId };
        }

        const messages = await db.messagesCollection
            .find({ conversation_id: convo._id.toString() })
            .sort({ created_at: 1 })
            .limit(200)
            .toArray();

        // mark as read
        await db.messagesCollection.updateMany(
            {
                conversation_id: convo._id.toString(),
                sender_id: { $ne: userId },
                read_by: { $nin: [userId] },
            },
            { $addToSet: { read_by: userId } }
        );

        const other = await getUserById(otherId);

        res.json({
            success: true,
            conversationId: convo._id.toString(),
            other: other
                ? { _id: other._id.toString(), name: other.name, image: other.image }
                : { _id: otherId, name: 'Member' },
            messages,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to load thread' });
    }
});

// Send message
router.post('/api/messages/send', async (req, res) => {
    try {
        await connectDB();
        const { senderId, receiverId, content } = req.body;
        if (!senderId || !receiverId || !content?.trim()) {
            return res.status(400).json({ success: false, message: 'Missing fields' });
        }
        if (senderId === receiverId) {
            return res.status(400).json({ success: false, message: 'Cannot message yourself' });
        }

        const sender = await getUserById(senderId);
        if (!sender || sender.isBlocked) {
            return res.status(403).json({ success: false, message: 'Not allowed' });
        }

        const key = pairKey(senderId, receiverId);
        let convo = await db.conversationsCollection.findOne({ pair_key: key });
        if (!convo) {
            const doc = {
                pair_key: key,
                participants: [senderId, receiverId],
                last_message: null,
                created_at: new Date(),
                updated_at: new Date(),
            };
            const r = await db.conversationsCollection.insertOne(doc);
            convo = { ...doc, _id: r.insertedId };
        }

        const message = {
            conversation_id: convo._id.toString(),
            sender_id: senderId,
            receiver_id: receiverId,
            content: content.trim().slice(0, 2000),
            read_by: [senderId],
            created_at: new Date(),
        };
        const result = await db.messagesCollection.insertOne(message);

        await db.conversationsCollection.updateOne(
            { _id: convo._id },
            {
                $set: {
                    last_message: {
                        content: message.content,
                        sender_id: senderId,
                        created_at: message.created_at,
                    },
                    updated_at: new Date(),
                },
            }
        );

        res.json({
            success: true,
            message: { ...message, _id: result.insertedId },
            conversationId: convo._id.toString(),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to send' });
    }
});

module.exports = router;
