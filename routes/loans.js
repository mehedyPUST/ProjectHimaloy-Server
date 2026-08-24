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
// ==================== LOAN APIS =============================
// ============================================================

router.post('/api/loans/request', async (req, res) => {
    try {
        await connectDB();
        const { memberId, amount, tenure, reason } = req.body;

        if (!memberId || !amount || !tenure || !reason) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const member = await getUserById(memberId);
        if (isAdminUser(member)) {
            return res.status(403).json({ success: false, message: 'Admin cannot apply for loans' });
        }

        const activeLoan = await db.loansCollection.findOne({ member_id: memberId, status: 'active' });
        if (activeLoan) {
            return res.status(400).json({ success: false, message: 'You already have an active loan' });
        }

        // ✅ Check available fund
        const availableFund = await getAvailableFund();
        if (amount > availableFund) {
            return res.status(400).json({
                success: false,
                message: `Insufficient fund. Available: ৳${availableFund.toLocaleString()}, Requested: ৳${amount.toLocaleString()}`
            });
        }

        const loanRequest = {
            member_id: memberId,
            amount: parseInt(amount),
            tenure: parseInt(tenure),
            reason,
            status: 'pending',
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await db.loanRequestsCollection.insertOne(loanRequest);

        await db.transactionHistoryCollection.insertOne({
            type: 'loan_request',
            member_id: memberId,
            amount: parseInt(amount),
            status: 'pending',
            created_at: new Date()
        });

        const managerEmail = await getManagerEmail();
        if (managerEmail) {
            try {
                await emailService.sendLoanRequestToManager(managerEmail, {
                    memberName: member?.name || 'Member',
                    amount: parseInt(amount),
                    tenure: parseInt(tenure),
                    reason: reason,
                    date: new Date(),
                });
            } catch (e) {
                console.error('Email error:', e.message);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Loan request submitted',
            loanRequest: { ...loanRequest, _id: result.insertedId }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to submit loan request' });
    }
});

router.get('/api/loans/my', async (req, res) => {
    try {
        await connectDB();
        const { memberId } = req.query;

        // Active loan
        const activeLoan = await db.loansCollection.findOne({ member_id: memberId, status: 'active' });
        if (activeLoan) {
            activeLoan.next_installment_date = await getNextInstallmentDate(activeLoan);
        }

        // Pending requests
        const pendingRequests = await db.loanRequestsCollection.find({
            member_id: memberId,
            status: { $in: ['pending', 'voting', 'meeting'] }
        }).sort({ created_at: -1 }).toArray();

        // Completed loans
        const completedLoans = await db.loansCollection.find({
            member_id: memberId,
            status: { $in: ['completed', 'settled_early'] }
        }).sort({ completed_at: -1 }).toArray();

        // Rejected loan requests
        const rejectedRequests = await db.loanRequestsCollection.find({
            member_id: memberId,
            status: 'rejected'
        }).sort({ updated_at: -1 }).toArray();

        // Combine history
        const loanHistory = [
            ...completedLoans.map(loan => ({ ...loan, _type: 'loan' })),
            ...rejectedRequests.map(req => ({ ...req, _type: 'request' }))
        ];

        res.json({
            success: true,
            active: activeLoan,
            pending: pendingRequests,
            history: loanHistory
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch loans' });
    }
});

router.get('/api/loans/requests', async (req, res) => {
    try {
        await connectDB();
        const { status } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        const requests = await db.loanRequestsCollection.find(query).sort({ created_at: -1 }).toArray();
        const requestsWithNames = await populateMemberNames(requests);
        res.json({ success: true, requests: requestsWithNames });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch loan requests' });
    }
});

router.get('/api/loans/active', async (req, res) => {
    try {
        await connectDB();
        const loans = await db.loansCollection.find({ status: 'active' }).toArray();
        for (let loan of loans) {
            loan.next_installment_date = await getNextInstallmentDate(loan);
        }
        const loansWithNames = await populateMemberNames(loans);
        res.json({ success: true, loans: loansWithNames });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch active loans' });
    }
});

// Installment payment by member
router.post('/api/loans/pay-installment', async (req, res) => {
    try {
        await connectDB();
        const { memberId, loanId, date, paidThrough, transactionId, amount, note } = req.body;

        if (!memberId || !loanId || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const loan = await db.loansCollection.findOne({ _id: new ObjectId(loanId), member_id: memberId, status: 'active' });
        if (!loan) return res.status(404).json({ success: false, message: 'Active loan not found' });

        const installmentNo = (loan.paid_installments || 0) + 1;

        await db.loanInstallmentsCollection.insertOne({
            loan_id: loanId,
            member_id: memberId,
            installment_no: installmentNo,
            month: new Date().toISOString().slice(0, 7),
            amount: parseInt(amount),
            paid_through: paidThrough,
            transaction_id: paidThrough === 'hand-cash' ? '-' : (transactionId || '-'),
            note: note || '',
            status: 'pending',
            date: date || new Date().toISOString().split('T')[0],
            created_at: new Date()
        });

        await db.transactionHistoryCollection.insertOne({
            type: 'loan_installment',
            member_id: memberId,
            loan_id: loanId,
            installment_no: installmentNo,
            amount: parseInt(amount),
            method: paidThrough,
            txn_id: paidThrough === 'hand-cash' ? '-' : (transactionId || '-'),
            status: 'pending',
            created_at: new Date()
        });

        res.status(201).json({ success: true, message: 'Installment submitted for review' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to submit installment' });
    }
});


module.exports = router;
