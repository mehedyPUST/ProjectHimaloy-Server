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
// ==================== VOTING APIS ============================
// ============================================================

router.post('/api/loans/requests/:id/voting/start', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { managerId } = req.body;
        const totalMembers = await db.userCollection.countDocuments({ isBlocked: false });

        const loanRequest = await db.loanRequestsCollection.findOne({ _id: new ObjectId(id) });

        const voting = {
            loan_request_id: id,
            manager_id: managerId,
            phase: 'initial',
            total_members: totalMembers,
            votes: [],
            approve_count: 0,
            deny_count: 0,
            status: 'open',
            created_at: new Date()
        };

        const result = await db.loanVotingsCollection.insertOne(voting);
        await db.loanRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: 'voting', updated_at: new Date() } }
        );

        await db.transactionHistoryCollection.updateOne(
            { type: 'loan_request', member_id: loanRequest?.member_id, status: 'pending' },
            { $set: { status: 'voting', updated_at: new Date() } }
        );

        const allMembers = await getAllMemberEmails();
        if (allMembers.length > 0 && loanRequest) {
            try {
                await emailService.sendVotingStarted(allMembers, {
                    loanRequestId: id,
                    amount: loanRequest.amount,
                    tenure: loanRequest.tenure,
                    reason: loanRequest.reason,
                });
            } catch (e) {
                console.error('Email error (voting started):', e.message);
            }
        }

        res.status(201).json({ success: true, message: 'Voting started', voting: { ...voting, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to start voting' });
    }
});

router.post('/api/votings/create', async (req, res) => {
    try {
        await connectDB();
        const { managerId, title, description, type } = req.body;
        const totalMembers = await db.userCollection.countDocuments({ isBlocked: false });

        const voting = {
            manager_id: managerId,
            title,
            description,
            type: type || 'general',
            total_members: totalMembers,
            votes: [],
            approve_count: 0,
            deny_count: 0,
            status: 'open',
            created_at: new Date()
        };

        const result = await db.loanVotingsCollection.insertOne(voting);
        res.status(201).json({ success: true, message: 'Voting created', voting: { ...voting, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create voting' });
    }
});

router.get('/api/votings', async (req, res) => {
    try {
        await connectDB();
        const votings = await db.loanVotingsCollection.find().sort({ created_at: -1 }).toArray();

        for (let voting of votings) {
            if (voting.loan_request_id) {
                try {
                    const loanReq = await db.loanRequestsCollection.findOne({ _id: new ObjectId(voting.loan_request_id) });
                    if (loanReq) {
                        voting.applicant_id = loanReq.member_id;
                    }
                } catch (e) { /* ignore */ }
            }
        }

        const allMemberIds = [];
        votings.forEach(v => v.votes.forEach(vote => allMemberIds.push(vote.member_id)));

        const members = await db.userCollection.find({
            _id: { $in: allMemberIds.map(id => { try { return new ObjectId(id); } catch { return id; } }) }
        }).toArray();

        const memberMap = {};
        members.forEach(m => { memberMap[m._id.toString()] = m; });

        const votingsWithNames = votings.map(v => ({
            ...v,
            votes: v.votes.map(vote => ({
                ...vote,
                member_name: memberMap[vote.member_id]?.name || 'Unknown'
            }))
        }));

        res.json({ success: true, votings: votingsWithNames });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch votings' });
    }
});

router.post('/api/loans/requests/:id/vote', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { memberId, vote, reason } = req.body;

        if (!vote || !['approve', 'deny'].includes(vote)) {
            return res.status(400).json({ success: false, message: 'Invalid vote' });
        }

        const member = await getUserById(memberId);
        if (isAdminUser(member)) {
            return res.status(403).json({ success: false, message: 'Admin cannot vote' });
        }

        let voting = null;
        if (ObjectId.isValid(id)) voting = await db.loanVotingsCollection.findOne({ _id: new ObjectId(id), status: 'open' });
        if (!voting) voting = await db.loanVotingsCollection.findOne({ loan_request_id: id, status: 'open' });
        if (!voting) return res.status(404).json({ success: false, message: 'No active voting found' });

        if (voting.loan_request_id) {
            const loanReq = await db.loanRequestsCollection.findOne({ _id: new ObjectId(voting.loan_request_id) });
            if (loanReq && loanReq.member_id === memberId) {
                return res.status(400).json({ success: false, message: 'You cannot vote on your own loan request' });
            }
        }

        const alreadyVoted = voting.votes.find(v => v.member_id === memberId);
        if (alreadyVoted) return res.status(400).json({ success: false, message: 'Already voted' });

        const newVote = {
            member_id: memberId,
            vote,
            reason: reason || null,
            voted_at: new Date(),
            phase: voting.phase
        };

        await db.loanVotingsCollection.updateOne(
            { _id: voting._id },
            {
                $push: { votes: newVote },
                $set: {
                    approve_count: voting.approve_count + (vote === 'approve' ? 1 : 0),
                    deny_count: voting.deny_count + (vote === 'deny' ? 1 : 0)
                }
            }
        );

        res.json({ success: true, message: 'Vote cast successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to cast vote' });
    }
});

// ============================================================
// ==================== CLOSE VOTING (with PIN & action) =====
// ============================================================
router.patch('/api/votings/:id/close', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { managerId, action, reason, pin } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid voting ID' });
        }

        // Validate manager
        const manager = await getUserById(managerId);
        if (!manager || !manager.isManager) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        if (!manager.managerPin) {
            return res.status(400).json({ success: false, message: 'Please set your Manager PIN first' });
        }

        const isValidPin = await bcrypt.compare(pin, manager.managerPin);
        if (!isValidPin) {
            return res.status(401).json({ success: false, message: 'Invalid PIN' });
        }

        const voting = await db.loanVotingsCollection.findOne({ _id: new ObjectId(id) });
        if (!voting) return res.status(404).json({ success: false, message: 'Voting not found' });
        if (voting.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Voting already closed' });
        }

        // Determine result
        const isApproved = (action === 'approve');
        const result = isApproved ? 'approved' : 'rejected';

        // --- Handle Loan Request if this voting is for a loan ---
        if (voting.loan_request_id) {
            const loanRequest = await db.loanRequestsCollection.findOne({ _id: new ObjectId(voting.loan_request_id) });
            if (loanRequest) {
                if (isApproved) {
                    // Double-check available fund before creating loan
                    const availableFund = await getAvailableFund();
                    if (loanRequest.amount > availableFund) {
                        // Insufficient fund → reject automatically
                        await db.loanRequestsCollection.updateOne(
                            { _id: new ObjectId(voting.loan_request_id) },
                            { $set: { status: 'rejected', rejection_reason: 'Insufficient fund at the time of approval', updated_at: new Date() } }
                        );
                        await db.loanVotingsCollection.updateOne(
                            { _id: new ObjectId(id) },
                            { $set: { status: 'closed', result: 'rejected', closed_at: new Date(), updated_at: new Date() } }
                        );
                        const member = await getUserById(loanRequest.member_id);
                        if (member?.email) {
                            try {
                                await emailService.sendLoanRejectedToMember(member.email, {
                                    loanId: voting.loan_request_id,
                                    amount: loanRequest.amount,
                                    reason: 'Insufficient fund at the time of approval',
                                });
                            } catch (e) { console.error('Email error:', e.message); }
                        }
                        return res.json({ success: true, message: 'Voting closed: rejected due to insufficient fund' });
                    }

                    // Otherwise, create the loan
                    const principalInstallments = loanRequest.tenure;
                    const extraInstallments = loanRequest.tenure === 5 ? 1 : 2;
                    const installmentAmount = Math.ceil(loanRequest.amount / principalInstallments);
                    const loan = {
                        loan_request_id: voting.loan_request_id,
                        member_id: loanRequest.member_id,
                        manager_id: voting.manager_id || managerId,
                        amount: loanRequest.amount,
                        tenure: loanRequest.tenure,
                        total_installments: principalInstallments + extraInstallments,
                        principal_installments: principalInstallments,
                        extra_installments: extraInstallments,
                        installment_amount: installmentAmount,
                        savings_amount: installmentAmount * extraInstallments,
                        paid_installments: 0,
                        due_amount: loanRequest.amount,
                        status: 'active',
                        start_month: new Date().toISOString().slice(0, 7),
                        created_at: new Date(),
                        updated_at: new Date()
                    };

                    await db.loansCollection.insertOne(loan);
                    await db.loanRequestsCollection.updateOne(
                        { _id: new ObjectId(voting.loan_request_id) },
                        { $set: { status: 'approved', updated_at: new Date() } }
                    );

                    // Update transaction history
                    await db.transactionHistoryCollection.updateOne(
                        { type: 'loan_request', member_id: loanRequest.member_id, status: 'voting' },
                        { $set: { status: 'approved', updated_at: new Date() } }
                    );
                    await db.transactionHistoryCollection.insertOne({
                        type: 'loan_disbursement',
                        member_id: loanRequest.member_id,
                        amount: loanRequest.amount,
                        status: 'completed',
                        created_at: new Date()
                    });

                    // Send approval email
                    const member = await getUserById(loanRequest.member_id);
                    if (member?.email) {
                        try {
                            await emailService.sendLoanApprovedToMember(member.email, {
                                loanId: voting.loan_request_id,
                                amount: loanRequest.amount,
                                tenure: loanRequest.tenure,
                                totalInstallments: loan.total_installments,
                                installmentAmount: installmentAmount,
                                savingsAmount: loan.savings_amount,
                            });
                        } catch (e) {
                            console.error('Email error (loan approved):', e.message);
                        }
                    }
                } else {
                    // Reject Loan
                    await db.loanRequestsCollection.updateOne(
                        { _id: new ObjectId(voting.loan_request_id) },
                        {
                            $set: {
                                status: 'rejected',
                                rejection_reason: reason || 'No reason provided',
                                updated_at: new Date()
                            }
                        }
                    );
                    await db.transactionHistoryCollection.updateOne(
                        { type: 'loan_request', member_id: loanRequest.member_id, status: 'voting' },
                        { $set: { status: 'rejected', updated_at: new Date() } }
                    );

                    // Send rejection email
                    const member = await getUserById(loanRequest.member_id);
                    if (member?.email) {
                        try {
                            await emailService.sendLoanRejectedToMember(member.email, {
                                loanId: voting.loan_request_id,
                                amount: loanRequest.amount,
                                reason: reason || 'No reason provided',
                            });
                        } catch (e) {
                            console.error('Email error (loan rejected):', e.message);
                        }
                    }
                }
            }
        }

        // Update voting status (if not already updated due to fund check)
        await db.loanVotingsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    status: 'closed',
                    result: result,
                    closed_at: new Date(),
                    closed_by: managerId,
                    rejection_reason: isApproved ? null : (reason || null),
                    updated_at: new Date()
                }
            }
        );

        res.json({
            success: true,
            message: `Voting closed: ${result}`,
            result: result
        });
    } catch (error) {
        console.error('Close voting error:', error);
        res.status(500).json({ success: false, message: 'Failed to close voting' });
    }
});


module.exports = router;
