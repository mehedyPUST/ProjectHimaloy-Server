const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not defined');

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: false,
        deprecationErrors: true
    }
});

/** @type {import('mongodb').Db | null} */
let db = null;

// Mutable collection refs — assigned in connectDB so require() consumers always see live values
const state = {
    userCollection: null,
    collectionsCollection: null,
    loansCollection: null,
    loanInstallmentsCollection: null,
    loanRequestsCollection: null,
    loanVotingsCollection: null,
    notificationsCollection: null,
    transactionHistoryCollection: null,
    managerCyclesCollection: null,
    managerAccountsCollection: null,
    meetingsCollection: null,
    appConfigCollection: null,
    savingsWithdrawalsCollection: null,
    communityPostsCollection: null,
    communityCommentsCollection: null,
    messagesCollection: null,
    conversationsCollection: null,
};

async function connectDB() {
    try {
        if (db) return state;

        await client.connect();
        db = client.db(process.env.MONGODB_DB);

        state.userCollection = db.collection('user');
        state.collectionsCollection = db.collection('monthly_deposits');
        state.loansCollection = db.collection('loans');
        state.loanInstallmentsCollection = db.collection('loan_installments');
        state.loanRequestsCollection = db.collection('loan_requests');
        state.loanVotingsCollection = db.collection('loan_votings');
        state.notificationsCollection = db.collection('notifications');
        state.transactionHistoryCollection = db.collection('transaction_history');
        state.managerCyclesCollection = db.collection('manager_cycles');
        state.managerAccountsCollection = db.collection('manager_accounts');
        state.meetingsCollection = db.collection('meetings');
        state.appConfigCollection = db.collection('app_config');
        state.savingsWithdrawalsCollection = db.collection('savings_withdrawals');
        state.communityPostsCollection = db.collection('community_posts');
        state.communityCommentsCollection = db.collection('community_comments');
        state.messagesCollection = db.collection('messages');
        state.conversationsCollection = db.collection('conversations');

        await client.db('admin').command({ ping: 1 });
        console.log('✅ MongoDB connected!');
        return state;
    } catch (error) {
        console.error('❌ MongoDB error:', error);
        throw error;
    }
}

function getDb() {
    if (!db) throw new Error('Database not connected. Call connectDB() first.');
    return db;
}

module.exports = {
    client,
    connectDB,
    getDb,
    // Live refs via state object (same object identity after require)
    state,
    // Direct property access for convenience — these are getters on the exports object
    get userCollection() { return state.userCollection; },
    get collectionsCollection() { return state.collectionsCollection; },
    get loansCollection() { return state.loansCollection; },
    get loanInstallmentsCollection() { return state.loanInstallmentsCollection; },
    get loanRequestsCollection() { return state.loanRequestsCollection; },
    get loanVotingsCollection() { return state.loanVotingsCollection; },
    get notificationsCollection() { return state.notificationsCollection; },
    get transactionHistoryCollection() { return state.transactionHistoryCollection; },
    get managerCyclesCollection() { return state.managerCyclesCollection; },
    get managerAccountsCollection() { return state.managerAccountsCollection; },
    get meetingsCollection() { return state.meetingsCollection; },
    get appConfigCollection() { return state.appConfigCollection; },
    get savingsWithdrawalsCollection() { return state.savingsWithdrawalsCollection; },
    get communityPostsCollection() { return state.communityPostsCollection; },
    get communityCommentsCollection() { return state.communityCommentsCollection; },
    get messagesCollection() { return state.messagesCollection; },
    get conversationsCollection() { return state.conversationsCollection; },
};
