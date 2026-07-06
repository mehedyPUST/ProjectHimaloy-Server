// server/index.js (FULL BACKEND - Production Ready)
const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
require('./utils/cornJobs');
const emailService = require('./utils/emailService');

// ============================================================
// ==================== CORS MIDDLEWARE ========================
// ============================================================

app.use((req, res, next) => {
    const allowedOrigins = [
        'https://project-himaloy-client.vercel.app',
        'https://project-himaloy-server.vercel.app',
        'http://localhost:3000',
        'http://localhost:5000',
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
});

app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:5000',
        'https://project-himaloy-client.vercel.app',
        'https://project-himaloy-server.vercel.app',
        process.env.FRONTEND_URL,
        process.env.BETTER_AUTH_URL
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ============================================================
// ==================== HEALTH CHECK ==========================
// ============================================================

app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'ProjectHimaloy API is running!',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// ==================== DATABASE CONNECTION ===================
// ============================================================

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not defined');

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: false,
        deprecationErrors: true
    }
});

let db;
let userCollection;
let collectionsCollection;
let loansCollection;
let loanInstallmentsCollection;
let loanRequestsCollection;
let loanVotingsCollection;
let notificationsCollection;
let transactionHistoryCollection;
let managerCyclesCollection;
let managerAccountsCollection;
let meetingsCollection;
let appConfigCollection;

async function connectDB() {
    try {
        if (client && db) return;

        await client.connect();
        db = client.db(process.env.MONGODB_DB);

        userCollection = db.collection('user');
        collectionsCollection = db.collection('monthly_deposits');
        loansCollection = db.collection('loans');
        loanInstallmentsCollection = db.collection('loan_installments');
        loanRequestsCollection = db.collection('loan_requests');
        loanVotingsCollection = db.collection('loan_votings');
        notificationsCollection = db.collection('notifications');
        transactionHistoryCollection = db.collection('transaction_history');
        managerCyclesCollection = db.collection('manager_cycles');
        managerAccountsCollection = db.collection('manager_accounts');
        meetingsCollection = db.collection('meetings');
        appConfigCollection = db.collection('app_config');

        await client.db("admin").command({ ping: 1 });
        console.log('✅ MongoDB connected!');
    } catch (error) {
        console.error('❌ MongoDB error:', error);
        throw error;
    }
}

connectDB().catch(console.error);

// ============================================================
// ==================== HELPER FUNCTIONS =======================
// ============================================================

async function populateMemberNames(items, memberIdField = 'member_id') {
    const memberIds = items.map(item => item[memberIdField]).filter(Boolean);
    if (memberIds.length === 0) return items;

    const members = await userCollection.find({
        _id: {
            $in: memberIds.map(id => {
                try { return new ObjectId(id); } catch { return id; }
            })
        }
    }).toArray();

    const memberMap = {};
    members.forEach(m => { memberMap[m._id.toString()] = m; });

    return items.map(item => ({
        ...item,
        member_name: memberMap[item[memberIdField]]?.name || 'Unknown',
        member_email: memberMap[item[memberIdField]]?.email || '',
        member_phone: memberMap[item[memberIdField]]?.phone || '',
    }));
}

async function getManagerEmail() {
    const manager = await userCollection.findOne({ isManager: true });
    return manager?.email || null;
}

async function getAllMemberEmails() {
    const members = await userCollection.find({ isBlocked: false }).toArray();
    return members.filter(m => m.email).map(m => ({ email: m.email, name: m.name }));
}

async function getUserById(userId) {
    try {
        return await userCollection.findOne({ _id: new ObjectId(userId) });
    } catch {
        return null;
    }
}

function isAdminUser(user) {
    return user?.role === 'admin';
}

// ✅ Compute next installment due date for active loans
async function getNextInstallmentDate(loan) {
    if (!loan || loan.status !== 'active') return null;
    const dueDay = 10; // default 10th
    const startDate = new Date(loan.start_month + '-01');
    const nextMonth = new Date(startDate);
    nextMonth.setMonth(startDate.getMonth() + (loan.paid_installments || 0));
    const lastDayOfMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    const dueDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(dueDay, lastDayOfMonth));
    return dueDate.toISOString().split('T')[0];
}

// ============================================================
// ==================== AVAILABLE FUND =========================
// ============================================================

async function getAvailableFund() {
    // Total confirmed deposits
    const depositAgg = await collectionsCollection.aggregate([
        { $match: { status: 'confirmed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).toArray();
    const totalDeposits = depositAgg[0]?.total || 0;

    // Total active loan outstanding (due_amount)
    const loanAgg = await loansCollection.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, total: { $sum: '$due_amount' } } }
    ]).toArray();
    const totalActiveLoans = loanAgg[0]?.total || 0;

    return totalDeposits - totalActiveLoans;
}

// ============================================================
// ==================== MANAGER PIN APIS =======================
// ============================================================

app.patch('/api/manager/set-pin', async (req, res) => {
    try {
        await connectDB();
        const { managerId, pin } = req.body;

        if (!pin || pin.length !== 6) {
            return res.status(400).json({ success: false, message: 'PIN must be 6 digits' });
        }

        const bcrypt = require('bcryptjs');
        const hashedPin = await bcrypt.hash(pin, 10);

        await userCollection.updateOne(
            { _id: new ObjectId(managerId) },
            { $set: { managerPin: hashedPin, updatedAt: new Date() } }
        );

        res.json({ success: true, message: 'PIN set successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

app.patch('/api/manager/change-pin', async (req, res) => {
    try {
        await connectDB();
        const { managerId, oldPin, newPin } = req.body;

        const manager = await userCollection.findOne({ _id: new ObjectId(managerId) });
        if (!manager?.managerPin) {
            return res.status(400).json({ success: false, message: 'No PIN set' });
        }

        const bcrypt = require('bcryptjs');
        const isValid = await bcrypt.compare(oldPin, manager.managerPin);
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Wrong current PIN' });
        }

        const hashedPin = await bcrypt.hash(newPin, 10);
        await userCollection.updateOne(
            { _id: new ObjectId(managerId) },
            { $set: { managerPin: hashedPin, updatedAt: new Date() } }
        );

        res.json({ success: true, message: 'PIN changed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

// ============================================================
// ==================== USER APIS =============================
// ============================================================

app.get('/api/users', async (req, res) => {
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

        const totalCount = await userCollection.countDocuments(query);
        const users = await userCollection.find(query).skip(skip).limit(parseInt(limit)).toArray();
        const safeUsers = users.map(({ password, ...user }) => user);

        res.json({ success: true, users: safeUsers, total: totalCount });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        let query = {};
        if (ObjectId.isValid(id)) query._id = new ObjectId(id);
        else query._id = id;

        const user = await userCollection.findOne(query);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const { password, ...safeUser } = user;
        res.json({ success: true, user: safeUser });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch user' });
    }
});

app.patch('/api/users/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { name, phone, dateOfBirth, image, role, isBlocked } = req.body;
        let query = {};
        if (ObjectId.isValid(id)) query._id = new ObjectId(id);
        else query._id = id;

        const updateData = { updatedAt: new Date() };
        if (name !== undefined) updateData.name = name;
        if (phone !== undefined) updateData.phone = phone;
        if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
        if (image !== undefined) updateData.image = image;
        if (role !== undefined) updateData.role = role;
        if (isBlocked !== undefined) updateData.isBlocked = isBlocked;

        const result = await userCollection.updateOne(query, { $set: updateData });
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, message: 'Updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update user' });
    }
});

// ============================================================
// ==================== ADMIN MANAGER APIS =====================
// ============================================================

app.patch('/api/admin/make-manager/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

        const user = await userCollection.findOne({ _id: new ObjectId(id) });
        if (isAdminUser(user)) {
            return res.status(400).json({ success: false, message: 'Admin cannot be manager' });
        }

        await userCollection.updateMany(
            { isManager: true },
            { $set: { isManager: false, role: 'member', updatedAt: new Date() } }
        );

        await userCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isManager: true, role: 'manager', updatedAt: new Date() } }
        );

        await managerCyclesCollection.updateMany(
            { active: true },
            { $set: { active: false, end_date: new Date().toISOString().split('T')[0], updatedAt: new Date() } }
        );

        const lastCycle = await managerCyclesCollection.findOne({}, { sort: { cycle_number: -1 } });
        const cycleNumber = (lastCycle?.cycle_number || 0) + 1;
        const startDate = new Date().toISOString().split('T')[0];
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 6);

        await managerCyclesCollection.insertOne({
            manager_id: id,
            cycle_number: cycleNumber,
            start_date: startDate,
            end_date: endDate.toISOString().split('T')[0],
            total_collection: 0,
            total_loans_disbursed: 0,
            total_savings_generated: 0,
            active: true,
            created_at: new Date()
        });

        res.json({ success: true, message: `${user?.name || 'Member'} is now the manager` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

app.patch('/api/admin/remove-manager/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

        await userCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isManager: false, role: 'member', updatedAt: new Date() } }
        );

        await managerCyclesCollection.updateMany(
            { active: true, manager_id: id },
            { $set: { active: false, end_date: new Date().toISOString().split('T')[0], updatedAt: new Date() } }
        );

        const user = await userCollection.findOne({ _id: new ObjectId(id) });
        res.json({ success: true, message: `${user?.name || 'Member'} removed from manager role` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

// ============================================================
// ==================== DEPOSIT APIS ==========================
// ============================================================

app.post('/api/deposits/pay', async (req, res) => {
    try {
        await connectDB();
        const { memberId, month, year, date, paidThrough, transactionId, amount, note } = req.body;

        if (!memberId || !month || !year || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const member = await getUserById(memberId);
        if (isAdminUser(member)) {
            return res.status(403).json({ success: false, message: 'Admin cannot make deposits' });
        }

        const depositMonth = `${year}-${month}`;

        const deposit = {
            member_id: memberId,
            month: depositMonth,
            date: date || new Date().toISOString().split('T')[0],
            paid_through: paidThrough,
            transaction_id: paidThrough === 'hand-cash' ? '-' : (transactionId || '-'),
            amount: parseInt(amount),
            note: note || '',
            status: 'pending',
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await collectionsCollection.insertOne(deposit);

        await transactionHistoryCollection.insertOne({
            type: 'deposit',
            member_id: memberId,
            amount: parseInt(amount),
            month: depositMonth,
            date: date || new Date().toISOString().split('T')[0],
            method: paidThrough,
            txn_id: deposit.transaction_id,
            status: 'pending',
            created_at: new Date()
        });

        const managerEmail = await getManagerEmail();
        if (managerEmail) {
            try {
                await emailService.sendDepositRequestToManager(managerEmail, {
                    memberName: member?.name || 'Member',
                    month: depositMonth,
                    amount: parseInt(amount),
                    method: paidThrough,
                    txnId: deposit.transaction_id,
                    date: new Date(),
                    note: note || '',
                });
            } catch (e) {
                console.error('Email error:', e.message);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Deposit request submitted',
            deposit: { ...deposit, _id: result.insertedId }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to submit deposit' });
    }
});

app.get('/api/deposits/my', async (req, res) => {
    try {
        await connectDB();
        const { memberId } = req.query;
        const deposits = await collectionsCollection.find({ member_id: memberId }).sort({ created_at: -1 }).toArray();
        res.json({ success: true, deposits });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch deposits' });
    }
});

app.get('/api/deposits', async (req, res) => {
    try {
        await connectDB();
        const { status, month } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        if (month) query.month = month;

        const deposits = await collectionsCollection.find(query).sort({ created_at: -1 }).toArray();
        const depositsWithMembers = await populateMemberNames(deposits);
        res.json({ success: true, deposits: depositsWithMembers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch deposits' });
    }
});

app.patch('/api/deposits/:id/confirm', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { managerId, pin, status: reqStatus, rejectReason } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid ID' });
        }

        const manager = await userCollection.findOne({ _id: new ObjectId(managerId) });
        if (!manager) return res.status(404).json({ success: false, message: 'Manager not found' });
        if (!manager.isManager) return res.status(403).json({ success: false, message: 'Not authorized' });

        if (!manager.managerPin) {
            return res.status(400).json({ success: false, message: 'Please set your Manager PIN first' });
        }

        const bcrypt = require('bcryptjs');
        const isValidPin = await bcrypt.compare(pin, manager.managerPin);
        if (!isValidPin) {
            return res.status(401).json({ success: false, message: 'Wrong PIN' });
        }

        const newStatus = reqStatus || 'confirmed';

        const updateData = {
            status: newStatus,
            confirmed_by: managerId,
            confirmed_at: new Date(),
            updated_at: new Date()
        };

        if (newStatus === 'rejected' && rejectReason) {
            updateData.reject_reason = rejectReason;
        }

        await collectionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });

        // Update transaction history
        const deposit = await collectionsCollection.findOne({ _id: new ObjectId(id) });
        if (deposit) {
            await transactionHistoryCollection.updateOne(
                {
                    member_id: deposit.member_id,
                    month: deposit.month,
                    type: 'deposit',
                    status: 'pending'
                },
                {
                    $set: {
                        status: newStatus,
                        confirmed_by: managerId,
                        updated_at: new Date()
                    }
                }
            );
        }

        res.json({ success: true, message: `Deposit ${newStatus}` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to confirm deposit' });
    }
});

app.get('/api/deposits/due', async (req, res) => {
    try {
        await connectDB();
        const currentMonth = new Date().toISOString().slice(0, 7);
        // ✅ শুধু মেম্বার (অ্যাডমিন নয়) এবং যারা ব্লকড নয়
        const members = await userCollection.find({
            isBlocked: false,
            role: { $ne: 'admin' }   // ← অ্যাডমিন বাদ
        }).toArray();
        const paidMembers = await collectionsCollection.find({ month: currentMonth, status: 'confirmed' }).toArray();
        const paidMemberIds = paidMembers.map(p => p.member_id);
        const dueMembers = members.filter(m => !paidMemberIds.includes(m._id.toString()));

        res.json({
            success: true,
            dueMembers: dueMembers.map(m => ({
                _id: m._id, name: m.name, email: m.email, phone: m.phone, month: currentMonth
            })),
            totalDue: dueMembers.length
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch due members' });
    }
});

// ============================================================
// ==================== LOAN APIS =============================
// ============================================================

app.post('/api/loans/request', async (req, res) => {
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

        const activeLoan = await loansCollection.findOne({ member_id: memberId, status: 'active' });
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

        const result = await loanRequestsCollection.insertOne(loanRequest);

        await transactionHistoryCollection.insertOne({
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

app.get('/api/loans/my', async (req, res) => {
    try {
        await connectDB();
        const { memberId } = req.query;

        // Active loan
        const activeLoan = await loansCollection.findOne({ member_id: memberId, status: 'active' });
        if (activeLoan) {
            activeLoan.next_installment_date = await getNextInstallmentDate(activeLoan);
        }

        // Pending requests
        const pendingRequests = await loanRequestsCollection.find({
            member_id: memberId,
            status: { $in: ['pending', 'voting', 'meeting'] }
        }).sort({ created_at: -1 }).toArray();

        // Completed loans
        const completedLoans = await loansCollection.find({
            member_id: memberId,
            status: { $in: ['completed', 'settled_early'] }
        }).sort({ completed_at: -1 }).toArray();

        // Rejected loan requests
        const rejectedRequests = await loanRequestsCollection.find({
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

app.get('/api/loans/requests', async (req, res) => {
    try {
        await connectDB();
        const { status } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        const requests = await loanRequestsCollection.find(query).sort({ created_at: -1 }).toArray();
        const requestsWithNames = await populateMemberNames(requests);
        res.json({ success: true, requests: requestsWithNames });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch loan requests' });
    }
});

app.get('/api/loans/active', async (req, res) => {
    try {
        await connectDB();
        const loans = await loansCollection.find({ status: 'active' }).toArray();
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
app.post('/api/loans/pay-installment', async (req, res) => {
    try {
        await connectDB();
        const { memberId, loanId, date, paidThrough, transactionId, amount, note } = req.body;

        if (!memberId || !loanId || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const loan = await loansCollection.findOne({ _id: new ObjectId(loanId), member_id: memberId, status: 'active' });
        if (!loan) return res.status(404).json({ success: false, message: 'Active loan not found' });

        const installmentNo = (loan.paid_installments || 0) + 1;

        await loanInstallmentsCollection.insertOne({
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

        await transactionHistoryCollection.insertOne({
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

// ============================================================
// ==================== VOTING APIS ============================
// ============================================================

app.post('/api/loans/requests/:id/voting/start', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { managerId } = req.body;
        const totalMembers = await userCollection.countDocuments({ isBlocked: false });

        const loanRequest = await loanRequestsCollection.findOne({ _id: new ObjectId(id) });

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

        const result = await loanVotingsCollection.insertOne(voting);
        await loanRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: 'voting', updated_at: new Date() } }
        );

        await transactionHistoryCollection.updateOne(
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

app.post('/api/votings/create', async (req, res) => {
    try {
        await connectDB();
        const { managerId, title, description, type } = req.body;
        const totalMembers = await userCollection.countDocuments({ isBlocked: false });

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

        const result = await loanVotingsCollection.insertOne(voting);
        res.status(201).json({ success: true, message: 'Voting created', voting: { ...voting, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create voting' });
    }
});

app.get('/api/votings', async (req, res) => {
    try {
        await connectDB();
        const votings = await loanVotingsCollection.find().sort({ created_at: -1 }).toArray();

        for (let voting of votings) {
            if (voting.loan_request_id) {
                try {
                    const loanReq = await loanRequestsCollection.findOne({ _id: new ObjectId(voting.loan_request_id) });
                    if (loanReq) {
                        voting.applicant_id = loanReq.member_id;
                    }
                } catch (e) { /* ignore */ }
            }
        }

        const allMemberIds = [];
        votings.forEach(v => v.votes.forEach(vote => allMemberIds.push(vote.member_id)));

        const members = await userCollection.find({
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

app.post('/api/loans/requests/:id/vote', async (req, res) => {
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
        if (ObjectId.isValid(id)) voting = await loanVotingsCollection.findOne({ _id: new ObjectId(id), status: 'open' });
        if (!voting) voting = await loanVotingsCollection.findOne({ loan_request_id: id, status: 'open' });
        if (!voting) return res.status(404).json({ success: false, message: 'No active voting found' });

        if (voting.loan_request_id) {
            const loanReq = await loanRequestsCollection.findOne({ _id: new ObjectId(voting.loan_request_id) });
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

        await loanVotingsCollection.updateOne(
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
app.patch('/api/votings/:id/close', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { managerId, action, reason, pin } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid voting ID' });
        }

        // Validate manager
        const manager = await userCollection.findOne({ _id: new ObjectId(managerId) });
        if (!manager || !manager.isManager) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        if (!manager.managerPin) {
            return res.status(400).json({ success: false, message: 'Please set your Manager PIN first' });
        }

        const bcrypt = require('bcryptjs');
        const isValidPin = await bcrypt.compare(pin, manager.managerPin);
        if (!isValidPin) {
            return res.status(401).json({ success: false, message: 'Invalid PIN' });
        }

        const voting = await loanVotingsCollection.findOne({ _id: new ObjectId(id) });
        if (!voting) return res.status(404).json({ success: false, message: 'Voting not found' });
        if (voting.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Voting already closed' });
        }

        // Determine result
        const isApproved = (action === 'approve');
        const result = isApproved ? 'approved' : 'rejected';

        // --- Handle Loan Request if this voting is for a loan ---
        if (voting.loan_request_id) {
            const loanRequest = await loanRequestsCollection.findOne({ _id: new ObjectId(voting.loan_request_id) });
            if (loanRequest) {
                if (isApproved) {
                    // Double-check available fund before creating loan
                    const availableFund = await getAvailableFund();
                    if (loanRequest.amount > availableFund) {
                        // Insufficient fund → reject automatically
                        await loanRequestsCollection.updateOne(
                            { _id: new ObjectId(voting.loan_request_id) },
                            { $set: { status: 'rejected', rejection_reason: 'Insufficient fund at the time of approval', updated_at: new Date() } }
                        );
                        await loanVotingsCollection.updateOne(
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

                    await loansCollection.insertOne(loan);
                    await loanRequestsCollection.updateOne(
                        { _id: new ObjectId(voting.loan_request_id) },
                        { $set: { status: 'approved', updated_at: new Date() } }
                    );

                    // Update transaction history
                    await transactionHistoryCollection.updateOne(
                        { type: 'loan_request', member_id: loanRequest.member_id, status: 'voting' },
                        { $set: { status: 'approved', updated_at: new Date() } }
                    );
                    await transactionHistoryCollection.insertOne({
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
                    await loanRequestsCollection.updateOne(
                        { _id: new ObjectId(voting.loan_request_id) },
                        {
                            $set: {
                                status: 'rejected',
                                rejection_reason: reason || 'No reason provided',
                                updated_at: new Date()
                            }
                        }
                    );
                    await transactionHistoryCollection.updateOne(
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
        await loanVotingsCollection.updateOne(
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

// ============================================================
// ==================== INSTALLMENT MANAGEMENT =================
// ============================================================

app.get('/api/loans/installments', async (req, res) => {
    try {
        await connectDB();
        const { status, loanId } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        if (loanId && ObjectId.isValid(loanId)) {
            query.loan_id = loanId;
        } else if (loanId) {
            return res.json({ success: true, installments: [] });
        }

        const installments = await loanInstallmentsCollection.find(query).sort({ created_at: -1 }).toArray();
        const populated = await populateMemberNames(installments);
        res.json({ success: true, installments: populated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch installments' });
    }
});

app.patch('/api/loans/installments/:id/confirm', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { managerId, pin, status: reqStatus, rejectReason } = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

        const manager = await userCollection.findOne({ _id: new ObjectId(managerId) });
        if (!manager || !manager.isManager) return res.status(403).json({ success: false, message: 'Not authorized' });
        if (!manager.managerPin) return res.status(400).json({ success: false, message: 'Please set your Manager PIN first' });

        const bcrypt = require('bcryptjs');
        const isValidPin = await bcrypt.compare(pin, manager.managerPin);
        if (!isValidPin) return res.status(401).json({ success: false, message: 'Wrong PIN' });

        const newStatus = reqStatus || 'confirmed';
        const updateData = {
            status: newStatus,
            confirmed_by: managerId,
            confirmed_at: new Date(),
            updated_at: new Date()
        };
        if (newStatus === 'rejected' && rejectReason) {
            updateData.reject_reason = rejectReason;
        }

        await loanInstallmentsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });

        const inst = await loanInstallmentsCollection.findOne({ _id: new ObjectId(id) });
        if (!inst) return res.status(404).json({ success: false, message: 'Installment not found' });

        if (newStatus === 'confirmed') {
            const loan = await loansCollection.findOne({ _id: new ObjectId(inst.loan_id) });
            if (loan) {
                const excess = Math.max(0, (inst.amount || 0) - (loan.installment_amount || 0));
                const newPaid = (loan.paid_installments || 0) + 1;
                let newDue = (loan.due_amount || loan.amount) - (loan.installment_amount || 0) - excess;
                if (newDue < 0) newDue = 0;

                const totalInstallments = loan.total_installments || 0;
                const earlySettlementMonths = 3;

                const isPrincipalPaid = newDue <= 0;
                const isEarly = isPrincipalPaid && (newPaid <= earlySettlementMonths);
                const isAllInstallmentsPaid = newPaid >= totalInstallments;

                let newLoanStatus = 'active';
                if (isEarly) {
                    newLoanStatus = 'settled_early';
                } else if (isAllInstallmentsPaid) {
                    newLoanStatus = 'completed';
                }

                await loansCollection.updateOne(
                    { _id: new ObjectId(inst.loan_id) },
                    {
                        $set: {
                            paid_installments: newPaid,
                            due_amount: newDue,
                            status: newLoanStatus,
                            completed_at: (newLoanStatus === 'completed' || newLoanStatus === 'settled_early') ? new Date() : null,
                            updated_at: new Date()
                        }
                    }
                );

                if (newLoanStatus === 'completed') {
                    await userCollection.updateOne(
                        { _id: new ObjectId(loan.member_id) },
                        { $inc: { savings_balance: loan.savings_amount || 0, total_savings: loan.savings_amount || 0 } }
                    );
                }
            }
        }

        const member = await getUserById(inst.member_id);
        if (member?.email) {
            try {
                await emailService.sendInstallmentStatusUpdate(member.email, {
                    status: newStatus,
                    installmentNo: inst.installment_no,
                    amount: inst.amount,
                    loanId: inst.loan_id,
                    date: inst.date || new Date(inst.created_at).toLocaleDateString(),
                    reason: newStatus === 'rejected' ? rejectReason : null,
                });
            } catch (e) {
                console.error('Email error (installment update):', e.message);
            }
        }

        res.json({ success: true, message: `Installment ${newStatus}` });
    } catch (error) {
        console.error('Confirm installment error:', error);
        res.status(500).json({ success: false, message: 'Failed to confirm installment' });
    }
});

// ============================================================
// ==================== MEETINGS APIS ==========================
// ============================================================

app.post('/api/meetings', async (req, res) => {
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

        const result = await meetingsCollection.insertOne(meeting);

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

app.get('/api/meetings', async (req, res) => {
    try {
        await connectDB();
        const meetings = await meetingsCollection.find().sort({ date: 1 }).toArray();
        res.json({ success: true, meetings });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch meetings' });
    }
});

app.patch('/api/meetings/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        await meetingsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { ...req.body, updated_at: new Date() } });
        res.json({ success: true, message: 'Meeting updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update meeting' });
    }
});

// ============================================================
// ==================== TRANSACTIONS ===========================
// ============================================================

app.get('/api/transactions/my', async (req, res) => {
    try {
        await connectDB();
        const { memberId } = req.query;
        const transactions = await transactionHistoryCollection.find({ member_id: memberId }).sort({ created_at: -1 }).toArray();
        res.json({ success: true, transactions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
    }
});

app.get('/api/transactions', async (req, res) => {
    try {
        await connectDB();
        const { type } = req.query;
        let query = {};
        if (type && type !== 'all') query.type = type;
        const transactions = await transactionHistoryCollection.find(query).sort({ created_at: -1 }).toArray();
        const transactionsWithNames = await populateMemberNames(transactions);
        res.json({ success: true, transactions: transactionsWithNames });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
    }
});

// ============================================================
// ==================== NOTIFICATIONS ==========================
// ============================================================

app.get('/api/notifications', async (req, res) => {
    try {
        await connectDB();
        const { userId } = req.query;
        const notifications = await notificationsCollection.find({ user_id: userId }).sort({ created_at: -1 }).limit(20).toArray();
        res.json({ success: true, notifications });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
});

app.get('/api/notifications/unread-count', async (req, res) => {
    try {
        await connectDB();
        const { userId } = req.query;
        const count = await notificationsCollection.countDocuments({ user_id: userId, is_read: false });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to count' });
    }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        await notificationsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { is_read: true } });
        res.json({ success: true, message: 'Marked as read' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

// ============================================================
// ==================== MANAGER CYCLES =========================
// ============================================================

app.get('/api/manager-cycles/current', async (req, res) => {
    try {
        await connectDB();
        const cycle = await managerCyclesCollection.findOne({ active: true });
        if (cycle) {
            const manager = await userCollection.findOne({ _id: new ObjectId(cycle.manager_id) });
            cycle.manager_name = manager?.name || 'Unknown';
        }
        res.json({ success: true, cycle });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch cycle' });
    }
});

app.get('/api/manager-cycles', async (req, res) => {
    try {
        await connectDB();
        const cycles = await managerCyclesCollection.find().sort({ created_at: -1 }).toArray();
        for (let cycle of cycles) {
            try {
                const manager = await userCollection.findOne({ _id: new ObjectId(cycle.manager_id) });
                cycle.manager_name = manager?.name || 'Unknown';
            } catch { }
        }
        res.json({ success: true, cycles });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch cycles' });
    }
});

// ============================================================
// ==================== DASHBOARD APIS ========================
// ============================================================

app.get('/api/dashboard/member', async (req, res) => {
    try {
        await connectDB();
        const { memberId } = req.query;
        if (!memberId) return res.status(400).json({ success: false, message: 'memberId required' });

        const depositAgg = await collectionsCollection.aggregate([
            { $match: { member_id: memberId, status: 'confirmed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).toArray();
        const totalDeposit = depositAgg[0]?.total || 0;

        const lastDeposit = await collectionsCollection.findOne(
            { member_id: memberId, status: 'confirmed' },
            { sort: { created_at: -1 } }
        );

        const currentMonth = new Date().toISOString().slice(0, 7);
        const currentMonthDeposit = await collectionsCollection.findOne({ member_id: memberId, month: currentMonth });
        const activeLoan = await loansCollection.findOne({ member_id: memberId, status: 'active' });
        if (activeLoan) {
            activeLoan.next_installment_date = await getNextInstallmentDate(activeLoan);
        }
        const recentTransactions = await transactionHistoryCollection.find({ member_id: memberId }).sort({ created_at: -1 }).limit(5).toArray();

        res.json({
            success: true,
            dashboard: {
                totalDeposit,
                lastDeposit: lastDeposit ? {
                    amount: lastDeposit.amount,
                    date: lastDeposit.date || new Date(lastDeposit.created_at).toISOString().split('T')[0],
                    month: lastDeposit.month,
                } : null,
                currentMonth: {
                    month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
                    amount: currentMonthDeposit?.amount || 200,
                    status: currentMonthDeposit?.status || 'due',
                    dueDate: '10th',
                },
                activeLoan,
                savings: 0,
                recentTransactions,
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
    }
});

app.get('/api/dashboard/manager', async (req, res) => {
    try {
        await connectDB();
        const currentMonth = new Date().toISOString().slice(0, 7);

        const totalMembers = await userCollection.countDocuments({ isBlocked: false, role: { $ne: 'admin' } });
        const activeLoans = await loansCollection.countDocuments({ status: 'active' });
        const pendingConfirmations = await collectionsCollection.countDocuments({ status: 'pending', month: currentMonth });
        const pendingLoanRequests = await loanRequestsCollection.countDocuments({ status: 'pending' });

        const monthCollection = await collectionsCollection.aggregate([
            { $match: { month: currentMonth, status: 'confirmed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).toArray();

        const recentActivities = await transactionHistoryCollection.find().sort({ created_at: -1 }).limit(10).toArray();
        const activitiesWithNames = await populateMemberNames(recentActivities);

        res.json({
            success: true,
            dashboard: {
                totalMembers,
                activeLoans,
                pendingConfirmations,
                pendingLoanRequests,
                totalCollectionThisMonth: monthCollection[0]?.total || 0,
                expectedCollection: totalMembers * 200,
                collectionRate: totalMembers > 0 ? Math.round(((monthCollection[0]?.total || 0) / (totalMembers * 200)) * 100) : 0,
                fundBalance: monthCollection[0]?.total || 0,
                dueMembers: 0,
                recentActivities: activitiesWithNames,
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
    }
});

app.get('/api/dashboard/admin', async (req, res) => {
    try {
        await connectDB();
        const totalMembers = await userCollection.countDocuments();
        const activeLoans = await loansCollection.countDocuments({ status: 'active' });
        const fundAgg = await collectionsCollection.aggregate([
            { $match: { status: 'confirmed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).toArray();
        const recentActivities = await transactionHistoryCollection.find().sort({ created_at: -1 }).limit(10).toArray();
        const activitiesWithNames = await populateMemberNames(recentActivities);

        res.json({
            success: true,
            dashboard: {
                totalMembers,
                activeLoans,
                totalFundBalance: fundAgg[0]?.total || 0,
                recentActivities: activitiesWithNames,
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
    }
});

// ============================================================
// ==================== AVAILABLE FUND API =====================
// ============================================================
app.get('/api/fund/available', async (req, res) => {
    try {
        await connectDB();
        const available = await getAvailableFund();
        res.json({ success: true, availableFund: available });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch available fund' });
    }
});

// ============================================================
// ==================== APP CONFIG =============================
// ============================================================

app.get('/api/admin/settings', async (req, res) => {
    try {
        await connectDB();
        const config = await appConfigCollection.findOne({ key: 'settings' });
        res.json({ success: true, settings: config?.value || {} });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch settings' });
    }
});

app.put('/api/admin/settings', async (req, res) => {
    try {
        await connectDB();
        const { settings } = req.body;
        await appConfigCollection.updateOne(
            { key: 'settings' },
            { $set: { value: settings, updated_at: new Date() } },
            { upsert: true }
        );
        res.json({ success: true, message: 'Settings saved' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});

// ============================================================
// ==================== EXPORT & START ========================
// ============================================================

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, async () => {
        console.log(`🚀 ProjectHimaloy server running on port ${PORT}`);
        try { await connectDB(); } catch (error) { console.error('Failed to connect to MongoDB:', error); }
    });
}