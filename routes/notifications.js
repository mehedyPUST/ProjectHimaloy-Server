const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { connectDB } = db;
const {
    populateMemberNames,
    getManagerEmail,
    getAllMemberEmails,
    getUserById,
    isAdminUser,
    getNextInstallmentDate,
    getAvailableFund,
} = require('../utils/helpers');
const emailService = require('../utils/emailService');

// ============================================================
// ==================== NOTIFICATIONS ==========================
// ============================================================

router.get('/api/notifications', async (req, res) => {
    try {
        await connectDB();
        const { userId } = req.query;
        const notifications = await db.notificationsCollection.find({ user_id: userId }).sort({ created_at: -1 }).limit(20).toArray();
        res.json({ success: true, notifications });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
});

router.get('/api/notifications/unread-count', async (req, res) => {
    try {
        await connectDB();
        const { userId } = req.query;
        const count = await db.notificationsCollection.countDocuments({ user_id: userId, is_read: false });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to count' });
    }
});

router.patch('/api/notifications/:id/read', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        await db.notificationsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { is_read: true } });
        res.json({ success: true, message: 'Marked as read' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});


module.exports = router;
