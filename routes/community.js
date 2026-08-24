const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const db = require('../config/db');
const { connectDB } = db;
const { getUserById } = require('../utils/helpers');

// List posts (newest first)
router.get('/api/community/posts', async (req, res) => {
    try {
        await connectDB();
        const { limit = 30, skip = 0 } = req.query;
        const posts = await db.communityPostsCollection
            .find({})
            .sort({ created_at: -1 })
            .skip(parseInt(skip, 10))
            .limit(parseInt(limit, 10))
            .toArray();

        const enriched = await Promise.all(
            posts.map(async (p) => {
                const author = await getUserById(p.author_id);
                const comments = await db.communityCommentsCollection
                    .find({ post_id: p._id.toString() })
                    .sort({ created_at: 1 })
                    .toArray();
                const commentsWithAuthor = await Promise.all(
                    comments.map(async (c) => {
                        const ca = await getUserById(c.author_id);
                        return {
                            ...c,
                            author_name: ca?.name || 'Member',
                            author_image: ca?.image || null,
                        };
                    })
                );
                return {
                    ...p,
                    author_name: author?.name || 'Member',
                    author_image: author?.image || null,
                    comments: commentsWithAuthor,
                    reaction_counts: p.reactions || {},
                };
            })
        );

        res.json({ success: true, posts: enriched });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to load posts' });
    }
});

// Create post
router.post('/api/community/posts', async (req, res) => {
    try {
        await connectDB();
        const { authorId, content } = req.body;
        if (!authorId || !content?.trim()) {
            return res.status(400).json({ success: false, message: 'authorId and content required' });
        }
        const author = await getUserById(authorId);
        if (!author || author.isBlocked) {
            return res.status(403).json({ success: false, message: 'Not allowed' });
        }

        const post = {
            author_id: authorId,
            content: content.trim().slice(0, 2000),
            reactions: {}, // { like: [userId], love: [...], ... }
            created_at: new Date(),
            updated_at: new Date(),
        };
        const result = await db.communityPostsCollection.insertOne(post);
        res.json({
            success: true,
            post: {
                ...post,
                _id: result.insertedId,
                author_name: author.name,
                author_image: author.image,
                comments: [],
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create post' });
    }
});

// React to post
router.post('/api/community/posts/:id/react', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { userId, reaction } = req.body; // reaction: like | love | clap | insightful
        if (!ObjectId.isValid(id) || !userId || !reaction) {
            return res.status(400).json({ success: false, message: 'Invalid request' });
        }
        const allowed = ['like', 'love', 'clap', 'insightful'];
        if (!allowed.includes(reaction)) {
            return res.status(400).json({ success: false, message: 'Invalid reaction' });
        }

        const post = await db.communityPostsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

        const reactions = { ...(post.reactions || {}) };
        // Remove user from all reaction lists first (toggle / switch)
        for (const key of Object.keys(reactions)) {
            reactions[key] = (reactions[key] || []).filter((uid) => uid !== userId);
            if (reactions[key].length === 0) delete reactions[key];
        }
        // If they already had this reaction only, toggling off is done; if not, add
        const hadThis =
            (post.reactions?.[reaction] || []).includes(userId);
        if (!hadThis) {
            reactions[reaction] = [...(reactions[reaction] || []), userId];
        }

        await db.communityPostsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { reactions, updated_at: new Date() } }
        );

        res.json({ success: true, reactions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to react' });
    }
});

// Comment
router.post('/api/community/posts/:id/comments', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { authorId, content } = req.body;
        if (!ObjectId.isValid(id) || !authorId || !content?.trim()) {
            return res.status(400).json({ success: false, message: 'Invalid request' });
        }
        const author = await getUserById(authorId);
        if (!author || author.isBlocked) {
            return res.status(403).json({ success: false, message: 'Not allowed' });
        }

        const comment = {
            post_id: id,
            author_id: authorId,
            content: content.trim().slice(0, 1000),
            created_at: new Date(),
        };
        const result = await db.communityCommentsCollection.insertOne(comment);
        res.json({
            success: true,
            comment: {
                ...comment,
                _id: result.insertedId,
                author_name: author.name,
                author_image: author.image,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to comment' });
    }
});

// Delete own post
router.delete('/api/community/posts/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { userId } = req.body;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
        const post = await db.communityPostsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).json({ success: false, message: 'Not found' });
        if (post.author_id !== userId) {
            const user = await getUserById(userId);
            if (user?.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Not allowed' });
            }
        }
        await db.communityPostsCollection.deleteOne({ _id: new ObjectId(id) });
        await db.communityCommentsCollection.deleteMany({ post_id: id });
        res.json({ success: true, message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete' });
    }
});

module.exports = router;
