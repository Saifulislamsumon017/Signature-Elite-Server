const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

app.use(
  cors({
    origin: ['http://localhost:5173'],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.json());
app.use(cookieParser());

// 🔐 JWT Middleware
const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send({ message: 'Unauthorized' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: 'Forbidden' });
    req.user = decoded;
    next();
  });
};

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@signatureelite.xxxx.mongodb.net/?retryWrites=true&w=majority`;
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@signatureelite.z7ote26.mongodb.net/?retryWrites=true&w=majority&appName=SignatureElite`;

const client = new MongoClient(uri, {
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    await client.connect();

    const db = client.db('signatureElite');
    const propertiesCollection = db.collection('properties');
    const wishlistCollection = db.collection('wishlists');
    const reviewsCollection = db.collection('reviews');

    // ✅ Issue JWT
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.send({ token });
    });

    // ✅ Get all verified properties
    app.get('/all-properties', async (req, res) => {
      const { search = '', sort = '' } = req.query;
      const query = { verificationStatus: 'verified' };

      if (search) query.location = { $regex: search, $options: 'i' };

      let sortOption = {};
      if (sort === 'asc') sortOption.minPrice = 1;
      if (sort === 'desc') sortOption.minPrice = -1;

      const properties = await propertiesCollection
        .find(query)
        .sort(sortOption)
        .toArray();
      res.send(properties);
    });

    // ✅ Get single property
    app.get('/property/:id', async (req, res) => {
      const id = req.params.id;
      const property = await propertiesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(property);
    });

    // ✅ Get Advertise Properties

    app.get('/advertised-properties', async (req, res) => {
      try {
        const advertisedProperties = await propertiesCollection
          .find({ advertised: true, verificationStatus: 'verified' })
          .toArray();
        res.send(advertisedProperties);
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ error: 'Failed to fetch advertised properties' });
      }
    });

    // ✅ Add to wishlist (protected, no duplicate)
    app.post('/wishlist', verifyJWT, async (req, res) => {
      const item = req.body;
      await wishlistCollection.updateOne(
        { userEmail: item.userEmail, propertyId: item.propertyId },
        { $set: item },
        { upsert: true }
      );
      res.send({ message: 'Added or updated in wishlist' });
    });

    // ✅ Get user's wishlist (protected)
    app.get('/wishlist', verifyJWT, async (req, res) => {
      const userEmail = req.query.userEmail;
      const items = await wishlistCollection.find({ userEmail }).toArray();
      res.send(items);
    });

    // ✅ DELETE from wishlist
    app.delete('/wishlist/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      await wishlistCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ message: 'Deleted from wishlist' });
    });

    // ✅ GET reviews
    app.get('/reviews', async (req, res) => {
      const propertyId = req.query.propertyId;

      let query = {};
      if (propertyId) {
        query.propertyId = propertyId;
      }

      const cursor = reviewsCollection.find(query).sort({ createdAt: -1 });

      if (!propertyId) {
        cursor.limit(3);
      }

      const reviews = await cursor.toArray();
      res.send(reviews);
    });

    // ✅ POST review
    app.post('/reviews', verifyJWT, async (req, res) => {
      const review = req.body;
      review.createdAt = new Date();
      await reviewsCollection.insertOne(review);
      res.send({ message: 'Review added' });
    });

    // ✅ GET latest reviews
    app.get('/latest-reviews', async (req, res) => {
      try {
        const latestReviews = await reviewsCollection
          .find({})
          .sort({ createdAt: -1 })
          .limit(3)
          .toArray();
        res.send(latestReviews);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch latest reviews' });
      }
    });

    console.log('Server ready ✅');
  } finally {
    // No client.close() so server stays running
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Welcome to Signature Elite API');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
