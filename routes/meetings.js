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
// ==================== MEETINGS APIS ==========================
// ============================================================

router.post('/api/meetings', async (req, res) => {
    try {
        await connectDB();
        const { managerId, type, title, date, time, location, agenda, loanRequestId } = req.body;

        const meeting = {
            manager_id: managerId,
            type,
            title,
            date,
            time,
            location,
            agenda,
            loan_request_id: loanRequestId || null,
            status: 'scheduled',
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await db.meetingsCollection.insertOne(meeting);

        const allMembers = await getAllMemberEmails();
        if (allMembers.length > 0) {
            try {
                await emailService.sendMeetingNotification(allMembers, {
                    title, date, time, location, agenda,
                    loanRequestId: loanRequestId || null,
                });
            } catch (e) {
                console.error('Email error:', e.message);
            }
        }

        res.status(201).json({ success: true, meeting: { ...meeting, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create meeting' });
    }
});

router.get('/api/meetings', async (req, res) => {
    try {
        await connectDB();
        const meetings = await db.meetingsCollection.find().sort({ date: 1 }).toArray();
        res.json({ success: true, meetings });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch meetings' });
    }
});

router.patch('/api/meetings/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        await db.meetingsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { ...req.body, updated_at: new Date() } });
        res.json({ success: true, message: 'Meeting updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update meeting' });
    }
});


module.exports = router;
