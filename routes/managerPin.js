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
// ==================== MANAGER PIN APIS =======================
// ============================================================

router.patch('/api/manager/set-pin', async (req, res) => {
    try {
        await connectDB();
        const { managerId, pin } = req.body;

        if (!pin || pin.length !== 6) {
            return res.status(400).json({ success: false, message: 'PIN must be 6 digits' });
        }

        const hashedPin = await bcrypt.hash(pin, 10);

        await db.userCollection.updateOne(
            { _id: new ObjectId(managerId) },
            { $set: { managerPin: hashedPin, updatedAt: new Date() } }
        );

        res.json({ success: true, message: 'PIN set successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

router.patch('/api/manager/change-pin', async (req, res) => {
    try {
        await connectDB();
        const { managerId, oldPin, newPin } = req.body;

        const manager = await db.userCollection.findOne({ _id: new ObjectId(managerId) });
        if (!manager?.managerPin) {
            return res.status(400).json({ success: false, message: 'No PIN set' });
        }

        const isValid = await bcrypt.compare(oldPin, manager.managerPin);
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Wrong current PIN' });
        }

        const hashedPin = await bcrypt.hash(newPin, 10);
        await db.userCollection.updateOne(
            { _id: new ObjectId(managerId) },
            { $set: { managerPin: hashedPin, updatedAt: new Date() } }
        );

        res.json({ success: true, message: 'PIN changed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});


module.exports = router;
