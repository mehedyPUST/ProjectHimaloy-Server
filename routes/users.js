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
// ==================== USER APIS =============================
// ============================================================

router.get('/api/users', async (req, res) => {
    try {
        await connectDB();
        const { page = 1, limit = 50, search, role, status } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        let query = {};

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }
        if (role) query.role = role;
        if (status === 'active') query.isBlocked = false;
        if (status === 'blocked') query.isBlocked = true;

        const totalCount = await db.userCollection.countDocuments(query);
        const users = await db.userCollection.find(query).skip(skip).limit(parseInt(limit)).toArray();
        const safeUsers = users.map(({ password, ...user }) => user);

        res.json({ success: true, users: safeUsers, total: totalCount });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

router.get('/api/users/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const user = await getUserById(id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const { password, managerPin, ...safeUser } = user;
        // expose whether PIN is set without revealing hash
        if (managerPin) safeUser.managerPin = true;
        res.json({ success: true, user: safeUser });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch user' });
    }
});

router.patch('/api/users/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { name, phone, dateOfBirth, image, role, isBlocked } = req.body;
        const existing = await getUserById(id);
        if (!existing) return res.status(404).json({ success: false, message: 'User not found' });

        const updateData = { updatedAt: new Date() };
        if (name !== undefined) updateData.name = name;
        if (phone !== undefined) updateData.phone = phone;
        if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
        if (image !== undefined) updateData.image = image;
        if (role !== undefined) updateData.role = role;
        if (isBlocked !== undefined) updateData.isBlocked = isBlocked;

        await db.userCollection.updateOne({ _id: existing._id }, { $set: updateData });
        res.json({ success: true, message: 'Updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update user' });
    }
});


module.exports = router;
