require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

// ✅ Middleware
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ✅ JWT Middleware
const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send({ message: 'Unauthorized' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: 'Forbidden' });
    req.user = decoded;
    next();
  });
};

// ✅ MongoDB Connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@signatureelite.z7ote26.mongodb.net/?retryWrites=true&w=majority&appName=SignatureElite`;

const client = new MongoClient(uri, {
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    // await client.connect();
    // console.log('✅ Connected to MongoDB');

    const db = client.db('signatureElite');
    const usersCollection = db.collection('users');
    const propertiesCollection = db.collection('properties');
    const wishlistCollection = db.collection('wishlists');
    const reviewsCollection = db.collection('reviews');
    const offersCollection = db.collection('offers');

    // --- AUTH ---
    app.post('/jwt', async (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).send({ message: 'Email required' });

      // Find user in DB (or create default user role)
      const user = await usersCollection.findOne({ email });
      const role = user?.role || 'user';

      const token = jwt.sign({ email, role }, process.env.JWT_SECRET, {
        expiresIn: '7d',
      });
      res.send({ token });
    });
    // --- USER-ROLE ---

    // ✅ Get user role by email
    app.get('/users/role', verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: 'Email required' });

      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).send({ role: null });

      res.send({ role: user.role });
    });
    // ✅ Store new user
    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        // update last log in
        return res
          .status(200)
          .send({ message: 'User already exists', inserted: false });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // --- PROPERTIES ---
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

    app.get('/property/:id', async (req, res) => {
      const id = req.params.id;
      const property = await propertiesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(property);
    });

    app.get('/advertised-properties', async (req, res) => {
      const advertised = await propertiesCollection
        .find({ advertised: true, verificationStatus: 'verified' })
        .limit(4)
        .toArray();
      res.send(advertised);
    });

    //✅ GET my properties
    app.get('/properties/agent/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const properties = await propertiesCollection
        .find({ agentEmail: email })
        .toArray();
      res.send(properties);
    });

    // DELETE
    app.delete('/properties/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      await propertiesCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ message: 'Deleted successfully' });
    });

    // --- WISHLIST ---
    app.post('/wishlist', verifyJWT, async (req, res) => {
      const item = req.body;
      await wishlistCollection.updateOne(
        { userEmail: item.userEmail, propertyId: item.propertyId },
        { $set: item },
        { upsert: true }
      );
      res.send({ message: 'Added or updated in wishlist' });
    });

    app.get('/wishlist', verifyJWT, async (req, res) => {
      const userEmail = req.query.userEmail;
      const items = await wishlistCollection.find({ userEmail }).toArray();
      res.send(items);
    });

    app.delete('/wishlist/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      await wishlistCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ message: 'Deleted from wishlist' });
    });

    // --- REVIEWS ---
    app.get('/reviews', async (req, res) => {
      const { propertyId } = req.query;
      const query = propertyId ? { propertyId } : {};
      const cursor = reviewsCollection.find(query).sort({ createdAt: -1 });
      if (!propertyId) cursor.limit(3);
      const reviews = await cursor.toArray();
      res.send(reviews);
    });

    app.post('/reviews', verifyJWT, async (req, res) => {
      const review = req.body;
      review.createdAt = new Date();
      await reviewsCollection.insertOne(review);
      res.send({ message: 'Review added' });
    });

    // ✅ Get my reviews (only this user's)
    app.get('/my-reviews', verifyJWT, async (req, res) => {
      const userEmail = req.query.userEmail;
      if (!userEmail) {
        return res
          .status(400)
          .send({ error: 'userEmail query parameter required' });
      }

      const reviews = await reviewsCollection
        .find({ userEmail })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(reviews);
    });

    app.get('/latest-reviews', async (req, res) => {
      const latestReviews = await reviewsCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
      res.send(latestReviews);
    });

    // --- OFFERS ---

    app.post('/offers', verifyJWT, async (req, res) => {
      const offer = req.body;
      offer.status = 'pending';
      await offersCollection.insertOne(offer);
      res.send({ message: 'Offer saved' });
    });

    // ✅ Get all offers for a buyer (user)
    app.get('/offers', verifyJWT, async (req, res) => {
      const buyerEmail = req.query.buyerEmail;
      if (!buyerEmail) {
        return res
          .status(400)
          .send({ error: 'buyerEmail query parameter required' });
      }

      const results = await offersCollection.find({ buyerEmail }).toArray();

      res.send(results);
    });

    app.get('/offer/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const offer = await offersCollection.findOne({ _id: new ObjectId(id) });
      res.send(offer);
    });

    // ✅ Create Stripe Payment Intent
    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { amount } = req.body;
      if (!amount || amount < 1)
        return res.status(400).send({ error: 'Invalid amount' });

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: 'usd',
          payment_method_types: ['card'],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).send({ error: 'Payment intent creation failed' });
      }
    });

    // ✅ Mark offer as bought after payment
    app.patch('/offer/:id/pay', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const { transactionId } = req.body;

      if (!transactionId) {
        return res.status(400).send({ error: 'Transaction ID required' });
      }

      await offersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'bought', transactionId } }
      );

      res.send({ message: 'Payment recorded successfully' });
    });

    console.log('✅ Server ready');
  } finally {
    // No client.close() to keep server running
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Welcome to Signature Elite API');
});

app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
